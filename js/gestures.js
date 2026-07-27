// gestures.js
// Pointer-event based gesture engine for the canvas:
//  photo:  tap = select, long-press+drag = reorder(swap slots),
//          1-finger drag = pan image inside its cell,
//          2-finger pinch = scale, 2-finger twist = rotate.
//  text:   tap = select, double-tap = edit in place, 1-finger drag = move,
//          2-finger pinch = scale font size.
//  empty cell: tap = request a photo for that slot.

import { getCellRects, textLocalBounds } from "./render.js";

const LONG_PRESS_MS = 480;
const MOVE_CANCEL_PX = 10;
const TAP_MAX_MOVE_PX = 8;
const DOUBLE_TAP_MS = 400;

function angleDeg(dx, dy) {
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}
function dist(dx, dy) {
  return Math.hypot(dx, dy);
}

export function attachGestures(canvas, ctx, state, callbacks) {
  const {
    getCanvasSize, // () => {w,h}
    onRequestRender, // () => void
    onSelectionChange, // (selection) => void
    onTextDoubleTap, // (textObj) => void - double-tap: edit in place
    onEmptyCellTap, // (index) => void
    onLiftChange = () => {}, // (index|null) => void - photo "picked up" for reorder
  } = callbacks;

  const pointers = new Map(); // pointerId -> {x,y}
  let gesture = null; // active single/double pointer gesture info
  let lastTextTap = { id: null, time: 0 }; // for double-tap detection on text

  function toCanvasXY(evt) {
    const rect = canvas.getBoundingClientRect();
    const { w, h } = getCanvasSize();
    return {
      x: ((evt.clientX - rect.left) / rect.width) * w,
      y: ((evt.clientY - rect.top) / rect.height) * h,
    };
  }

  function hitTest(x, y) {
    const s = state.data;
    // texts, topmost first
    for (let i = s.texts.length - 1; i >= 0; i--) {
      const t = s.texts[i];
      const { w, h } = textLocalBounds(ctx, t);
      const pad = 10;
      if (Math.abs(x - t.x) <= w / 2 + pad && Math.abs(y - t.y) <= h / 2 + pad) {
        return { type: "text", id: t.id, index: i };
      }
    }
    // photo cells
    const { w: cw, h: ch } = getCanvasSize();
    const cells = getCellRects(s, cw, ch);
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
        return s.photos[i] ? { type: "photo", index: i } : { type: "empty", index: i };
      }
    }
    return null;
  }

  function cellCenter(index) {
    const { w, h } = getCanvasSize();
    const cells = getCellRects(state.data, w, h);
    const c = cells[index];
    return c ? { x: c.x + c.w / 2, y: c.y + c.h / 2, w: c.w, h: c.h } : null;
  }

  function startGestureFromHit(hit, startPt) {
    if (!hit) {
      gesture = { kind: "none" };
      return;
    }
    if (hit.type === "empty") {
      gesture = { kind: "empty-tap", index: hit.index, startPt, moved: false, t0: performance.now() };
      return;
    }
    if (hit.type === "photo") {
      const p = state.data.photos[hit.index];
      gesture = {
        kind: "photo",
        index: hit.index,
        startPt,
        moved: false,
        changeBegun: false,
        t0: performance.now(),
        longPressFired: false,
        longPressTimer: setTimeout(() => {
          if (gesture && gesture.kind === "photo" && !gesture.moved) {
            gesture.longPressFired = true;
            gesture.hoverIndex = hit.index;
            state.data.selection = { type: "photo", index: hit.index };
            onSelectionChange(state.data.selection);
            onLiftChange(hit.index);
            onRequestRender();
          }
        }, LONG_PRESS_MS),
        base: { offsetX: p.offsetX || 0, offsetY: p.offsetY || 0, scale: p.scale || 1, rotation: p.rotation || 0 },
      };
      return;
    }
    if (hit.type === "text") {
      gesture = {
        kind: "text",
        id: hit.id,
        startPt,
        moved: false,
        changeBegun: false,
        t0: performance.now(),
        base: null, // filled from live object
      };
      const t = state.data.texts.find((x) => x.id === hit.id);
      gesture.base = { x: t.x, y: t.y, size: t.size };
    }
  }

  function ensureChangeBegun(g) {
    if (!g.changeBegun) {
      state.beginChange();
      g.changeBegun = true;
    }
  }

  function onPointerDown(evt) {
    canvas.setPointerCapture(evt.pointerId);
    const pt = toCanvasXY(evt);
    pointers.set(evt.pointerId, pt);

    if (pointers.size === 1) {
      const hit = hitTest(pt.x, pt.y);
      startGestureFromHit(hit, pt);
    } else if (pointers.size === 2 && gesture && (gesture.kind === "photo" || gesture.kind === "text")) {
      if (gesture.longPressTimer) clearTimeout(gesture.longPressTimer);
      const pts = [...pointers.values()];
      const d0 = dist(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const a0 = angleDeg(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      gesture.pinch = { d0, a0 };
      ensureChangeBegun(gesture);
    }
  }

  function onPointerMove(evt) {
    if (!pointers.has(evt.pointerId)) return;
    const pt = toCanvasXY(evt);
    pointers.set(evt.pointerId, pt);
    if (!gesture) return;

    if (pointers.size >= 2 && gesture.pinch && (gesture.kind === "photo" || gesture.kind === "text")) {
      const pts = [...pointers.values()];
      const d1 = dist(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const a1 = angleDeg(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const scaleRatio = gesture.pinch.d0 > 0 ? d1 / gesture.pinch.d0 : 1;
      const rotDelta = a1 - gesture.pinch.a0;

      if (gesture.kind === "photo") {
        const p = state.data.photos[gesture.index];
        if (p) {
          p.scale = clamp(gesture.base.scale * scaleRatio, 0.2, 8);
          p.rotation = snapToRightAngle(norm360(gesture.base.rotation + rotDelta));
        }
      } else {
        // Text has no rotation control - pinch only scales font size.
        const t = state.data.texts.find((x) => x.id === gesture.id);
        if (t) {
          t.size = Math.round(clamp(gesture.base.size * scaleRatio, 8, 400));
        }
      }
      onRequestRender();
      return;
    }

    if (pointers.size !== 1) return;

    if (gesture.kind === "empty-tap") {
      if (dist(pt.x - gesture.startPt.x, pt.y - gesture.startPt.y) > TAP_MAX_MOVE_PX) gesture.moved = true;
      return;
    }

    if (gesture.kind === "photo") {
      const movedDist = dist(pt.x - gesture.startPt.x, pt.y - gesture.startPt.y);
      if (movedDist > MOVE_CANCEL_PX && !gesture.longPressFired) {
        clearTimeout(gesture.longPressTimer);
      }
      if (gesture.longPressFired) {
        // reorder mode: track hover cell
        const hit = hitTest(pt.x, pt.y);
        gesture.hoverIndex = hit && (hit.type === "photo" || hit.type === "empty") ? hit.index : gesture.hoverIndex;
        onRequestRender();
        return;
      }
      if (movedDist > TAP_MAX_MOVE_PX) {
        gesture.moved = true;
        ensureChangeBegun(gesture);
        const p = state.data.photos[gesture.index];
        if (p) {
          p.offsetX = gesture.base.offsetX + (pt.x - gesture.startPt.x);
          p.offsetY = gesture.base.offsetY + (pt.y - gesture.startPt.y);
        }
        onRequestRender();
      }
      return;
    }

    if (gesture.kind === "text") {
      const movedDist = dist(pt.x - gesture.startPt.x, pt.y - gesture.startPt.y);
      if (movedDist > TAP_MAX_MOVE_PX) {
        gesture.moved = true;
        ensureChangeBegun(gesture);
        const t = state.data.texts.find((x) => x.id === gesture.id);
        if (t) {
          t.x = gesture.base.x + (pt.x - gesture.startPt.x);
          t.y = gesture.base.y + (pt.y - gesture.startPt.y);
        }
        onRequestRender();
      }
    }
  }

  function onPointerUp(evt) {
    if (!pointers.has(evt.pointerId)) return;
    pointers.delete(evt.pointerId);
    try { canvas.releasePointerCapture(evt.pointerId); } catch (e) {}

    if (!gesture) return;

    if (pointers.size === 1) {
      // dropped from pinch (2->1): rebase remaining pointer as a fresh drag origin
      const remaining = [...pointers.values()][0];
      if (gesture.kind === "photo") {
        const p = state.data.photos[gesture.index];
        gesture.startPt = remaining;
        gesture.base = { offsetX: p?.offsetX || 0, offsetY: p?.offsetY || 0, scale: p?.scale || 1, rotation: p?.rotation || 0 };
        gesture.pinch = null;
      } else if (gesture.kind === "text") {
        const t = state.data.texts.find((x) => x.id === gesture.id);
        gesture.startPt = remaining;
        gesture.base = { x: t?.x || 0, y: t?.y || 0, size: t?.size || 48 };
        gesture.pinch = null;
      }
      return;
    }

    if (pointers.size === 0) {
      finishGesture(gesture);
      gesture = null;
    }
  }

  function finishGesture(g) {
    if (g.kind === "empty-tap" && !g.moved) {
      onEmptyCellTap(g.index);
      return;
    }

    if (g.kind === "photo") {
      clearTimeout(g.longPressTimer);
      if (g.longPressFired) {
        onLiftChange(null);
        if (g.hoverIndex != null && g.hoverIndex !== g.index) {
          state.beginChange();
          const arr = state.data.photos;
          [arr[g.index], arr[g.hoverIndex]] = [arr[g.hoverIndex], arr[g.index]];
          state.notify();
        }
        onRequestRender();
        return;
      }
      if (!g.moved) {
        state.data.selection = { type: "photo", index: g.index };
        onSelectionChange(state.data.selection);
        onRequestRender();
        return;
      }
      state.notify();
      return;
    }

    if (g.kind === "text") {
      if (!g.moved) {
        state.data.selection = { type: "text", id: g.id };
        onSelectionChange(state.data.selection);

        const now = performance.now();
        if (lastTextTap.id === g.id && now - lastTextTap.time < DOUBLE_TAP_MS) {
          lastTextTap = { id: null, time: 0 };
          const t = state.data.texts.find((x) => x.id === g.id);
          onTextDoubleTap(t);
        } else {
          lastTextTap = { id: g.id, time: now };
        }
        onRequestRender();
        return;
      }
      state.notify();
      return;
    }

    if (g.kind === "none") {
      state.data.selection = null;
      onSelectionChange(null);
      onRequestRender();
    }
  }

  function onPointerCancel(evt) {
    pointers.delete(evt.pointerId);
    if (gesture && gesture.kind === "photo" && gesture.longPressFired) {
      clearTimeout(gesture.longPressTimer);
      onLiftChange(null);
    }
    gesture = null;
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerCancel);
  };
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

const SNAP_THRESHOLD_DEG = 6;
/** Snaps to the nearest multiple of 90 deg (i.e. upright/on-its-side) when
 *  close enough, so manually rotating a photo can land it perfectly level. */
export function snapToRightAngle(deg) {
  const nearest = Math.round(deg / 90) * 90;
  const diff = Math.min(Math.abs(deg - nearest), 360 - Math.abs(deg - nearest));
  return diff <= SNAP_THRESHOLD_DEG ? norm360(nearest) : deg;
}
function norm360(deg) { let d = deg % 360; if (d < 0) d += 360; return d; }
