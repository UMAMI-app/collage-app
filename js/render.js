// render.js
// Pure(ish) canvas drawing. Given a 2d context, the app state, and the
// canvas pixel size, draws the full composition: background, photo cells
// (clipped/rounded), and text layers (with drop shadow).
// Also exposes geometry helpers shared with gestures.js for hit-testing.

import { computeLayout, roundedRectPath } from "./layout.js";
import { imageRegistry } from "./state.js";

export function getCellRects(state, canvasW, canvasH) {
  return computeLayout(state.photoCount, canvasW, canvasH, state.spacing, state.layoutVariant || 0);
}

export function coverBaseScale(cellW, cellH, naturalW, naturalH) {
  return Math.max(cellW / naturalW, cellH / naturalH);
}

/** Minimum image scale (applied to the image's natural pixel size) needed so
 *  that, once rotated by rotationDeg around its own center - which may be
 *  panned away from the cell's center by offsetX/offsetY - the image still
 *  fully covers the cell rect with no background showing at the corners.
 *  At rotation 0 this reduces exactly to coverBaseScale(). Works for any pan
 *  offset: rather than assuming a centered image, it transforms the cell's 4
 *  corners into the image's own (unrotated) local space and sizes the image
 *  to contain the farthest-reaching corner on each axis. Exported so the
 *  drag-clamp in gestures.js can find out the *actual* scale currently on
 *  screen (which may already be auto-boosted above the user's own pinch
 *  scale by rotation) instead of clamping against a stale, smaller value. */
export function minCoverScaleForRotation(cellW, cellH, naturalW, naturalH, offsetX, offsetY, rotationDeg) {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const cx = cellW / 2 + offsetX;
  const cy = cellH / 2 + offsetY;
  const corners = [
    [-cx, -cy],
    [cellW - cx, -cy],
    [-cx, cellH - cy],
    [cellW - cx, cellH - cy],
  ];
  let maxLx = 0, maxLy = 0;
  for (const [vx, vy] of corners) {
    const lx = vx * cos + vy * sin;
    const ly = -vx * sin + vy * cos;
    maxLx = Math.max(maxLx, Math.abs(lx));
    maxLy = Math.max(maxLy, Math.abs(ly));
  }
  return Math.max((2 * maxLx) / naturalW, (2 * maxLy) / naturalH);
}

/** Clamps a candidate pan offset so a 1-finger drag simply stops dead at the
 *  edge (like Instagram/most crop tools) instead of the image auto-zooming
 *  to keep covering the cell (which is what minCoverScaleForRotation would
 *  otherwise force at render time). Given the image's current total scale
 *  and rotation, this finds the safe range of offsets that still leaves the
 *  cell fully covered, and returns the offset clamped into that range.
 *
 *  Works at any rotation by clamping in the image's own "de-rotated" space
 *  (where the safe region is a plain axis-aligned box) and rotating the
 *  clamped result back - the rotation-0 case is just the plain min/max
 *  pan clamp used by most photo editors. */
export function clampPanOffset(offsetX, offsetY, cellW, cellH, naturalW, naturalH, totalScale, rotationDeg) {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);

  // De-rotate the candidate offset: o' = R(-theta) * offset
  const ox = offsetX * cos + offsetY * sin;
  const oy = -offsetX * sin + offsetY * cos;

  const hiw = (naturalW * totalScale) / 2;
  const hih = (naturalH * totalScale) / 2;
  const hw = cellW / 2, hh = cellH / 2;
  // Half-extents of the cell's own bounding box once de-rotated into the
  // image's local space (same quantity minCoverScaleForRotation computes
  // for the centered/offset-0 case).
  const ex = hw * Math.abs(cos) + hh * Math.abs(sin);
  const ey = hw * Math.abs(sin) + hh * Math.abs(cos);
  const maxOx = Math.max(0, hiw - ex);
  const maxOy = Math.max(0, hih - ey);

  const cox = Math.max(-maxOx, Math.min(maxOx, ox));
  const coy = Math.max(-maxOy, Math.min(maxOy, oy));

  // Rotate the clamped offset back: offset = R(theta) * o'_clamped
  return {
    x: cox * cos - coy * sin,
    y: cox * sin + coy * cos,
  };
}

/** Build the canvas font string for a text object (numeric weight, e.g. "700"). */
function fontString(t) {
  const parts = [];
  if (t.italic) parts.push("italic");
  parts.push(String(t.weight || 400));
  parts.push(`${t.size}px`);
  parts.push(t.font);
  return parts.join(" ");
}

function measureLineWidth(ctx, line, letterSpacing) {
  if (line.length === 0) return 0;
  let w = 0;
  for (const ch of line) w += ctx.measureText(ch).width + letterSpacing;
  return w - letterSpacing;
}

/** Returns a local-space bounding box {w,h} for a text object. Text has no
 *  rotation (removed by design), so this box is also its screen-space box. */
export function textLocalBounds(ctx, t) {
  ctx.save();
  ctx.font = fontString(t);
  const lines = (t.content || "").split("\n");
  let w, h;
  if (t.orientation === "vertical") {
    const colPitch = t.size * t.lineHeight;
    const charPitch = t.size + t.letterSpacing;
    const maxCharsInCol = lines.reduce((m, l) => Math.max(m, l.length), 1);
    w = lines.length * colPitch;
    h = maxCharsInCol * charPitch;
  } else {
    let maxW = 0;
    for (const line of lines) maxW = Math.max(maxW, measureLineWidth(ctx, line, t.letterSpacing));
    w = maxW;
    h = lines.length * t.size * t.lineHeight;
  }
  ctx.restore();
  return { w, h, lines };
}

function drawHorizontalText(ctx, t, lines) {
  ctx.textAlign = "left"; // manual per-character advance below needs a fixed start edge
  let maxW = 0;
  for (const line of lines) maxW = Math.max(maxW, measureLineWidth(ctx, line, t.letterSpacing));
  const startY = -((lines.length - 1) * t.size * t.lineHeight) / 2;

  lines.forEach((line, i) => {
    const lineW = measureLineWidth(ctx, line, t.letterSpacing);
    let startX;
    if (t.align === "left") startX = -maxW / 2;
    else if (t.align === "right") startX = maxW / 2 - lineW;
    else startX = -lineW / 2;

    let cx = startX;
    const y = startY + i * t.size * t.lineHeight;
    for (const ch of line) {
      ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width + t.letterSpacing;
    }
  });
}

/** Vertical (tategaki) layout: each \n-separated line becomes one column of
 *  characters running top-to-bottom; columns run right-to-left. */
function drawVerticalText(ctx, t, lines) {
  ctx.textAlign = "center"; // each character is centered within its column
  const colPitch = t.size * t.lineHeight;
  const charPitch = t.size + t.letterSpacing;
  const totalW = lines.length * colPitch;
  const startX = totalW / 2 - colPitch / 2;

  lines.forEach((line, colIndex) => {
    const x = startX - colIndex * colPitch;
    const startY = -((line.length - 1) * charPitch) / 2;
    [...line].forEach((ch, i) => {
      ctx.fillText(ch, x, startY + i * charPitch);
    });
  });
}

function drawTextObject(ctx, t) {
  if (!t.content) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, t.opacity / 100));
  ctx.translate(t.x, t.y);
  ctx.font = fontString(t);
  ctx.textBaseline = "middle";

  if (t.shadow && t.shadow.enabled) {
    const rad = (t.shadow.angle * Math.PI) / 180;
    ctx.shadowOffsetX = Math.cos(rad) * t.shadow.distance;
    ctx.shadowOffsetY = Math.sin(rad) * t.shadow.distance;
    ctx.shadowBlur = t.shadow.blur;
    ctx.shadowColor = hexToRgba(t.shadow.color, t.shadow.opacity / 100);
  }

  ctx.fillStyle = t.color;

  const lines = (t.content || "").split("\n");
  if (t.orientation === "vertical") {
    drawVerticalText(ctx, t, lines);
  } else {
    drawHorizontalText(ctx, t, lines);
  }

  ctx.restore();
}

function hexToRgba(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "#000000");
  if (!m) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawPhotoInCell(ctx, cell, photo, cornerRadius, bgColor, forExport) {
  const entry = photo ? imageRegistry.get(photo.imgId) : null;

  ctx.save();
  roundedRectPath(ctx, cell.x, cell.y, cell.w, cell.h, cornerRadius);
  ctx.clip();

  if (entry) {
    const rotation = photo.rotation || 0;
    const offsetX = photo.offsetX || 0;
    const offsetY = photo.offsetY || 0;
    const baseScale = coverBaseScale(cell.w, cell.h, entry.naturalW, entry.naturalH);
    const userTotalScale = baseScale * (photo.scale || 1);
    // At any rotation angle other than 0, simply keeping the same on-screen
    // scale the user picked at 0° can leave the cell's corners uncovered
    // (the image no longer reaches them once it's tilted). Boost the scale
    // up to whatever this rotation + pan actually requires to stay gapless,
    // but never *shrink* below the user's own manual zoom.
    const minRotatedScale = minCoverScaleForRotation(cell.w, cell.h, entry.naturalW, entry.naturalH, offsetX, offsetY, rotation);
    const totalScale = Math.max(userTotalScale, minRotatedScale);
    ctx.translate(cell.x + cell.w / 2 + offsetX, cell.y + cell.h / 2 + offsetY);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(totalScale, totalScale);
    ctx.drawImage(entry.img, -entry.naturalW / 2, -entry.naturalH / 2, entry.naturalW, entry.naturalH);
  } else if (forExport) {
    // Empty slot in the exported image: blend into the background cleanly,
    // no editor-only placeholder decoration.
    ctx.fillStyle = bgColor;
    ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
  } else {
    // Empty slot in the editor: light gray + centered "+" so it's clear
    // the cell is tappable to add a photo. Uses flat opaque colors rather
    // than a translucent overlay - a translucent gray blends into whatever
    // bgColor is picked (nearly invisible against a black background), so
    // this needs to look the same regardless of the chosen background.
    ctx.fillStyle = "#dcdcdc";
    ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
    ctx.fillStyle = "#8a8a8a";
    ctx.font = `${Math.max(20, Math.min(cell.w, cell.h) * 0.25)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("+", cell.x + cell.w / 2, cell.y + cell.h / 2);
  }
  ctx.restore();
}

function drawSelectionOutline(ctx, rect, rotation = 0) {
  ctx.save();
  if (rotation) {
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-(rect.x + rect.w / 2), -(rect.y + rect.h / 2));
  }
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#000000";
  ctx.strokeRect(rect.x - 3, rect.y - 3, rect.w + 6, rect.h + 6);
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Main draw entry point.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state (state.data)
 * @param {number} canvasW
 * @param {number} canvasH
 * @param {object} opts { forExport?: boolean, liftedIndex?: number|null, editingTextId?: string|null }
 */
export function renderCanvas(ctx, state, canvasW, canvasH, opts = {}) {
  const forExport = !!opts.forExport;
  const liftedIndex = opts.liftedIndex ?? null;
  const editingTextId = opts.editingTextId ?? null;
  ctx.clearRect(0, 0, canvasW, canvasH);
  ctx.fillStyle = state.bgColor;
  ctx.fillRect(0, 0, canvasW, canvasH);

  const cells = getCellRects(state, canvasW, canvasH);

  cells.forEach((cell, i) => {
    const photo = state.photos[i];
    const lifted = !forExport && i === liftedIndex;

    if (lifted) {
      ctx.save();
      const cx = cell.x + cell.w / 2, cy = cell.y + cell.h / 2;
      ctx.translate(cx, cy);
      ctx.scale(1.08, 1.08);
      ctx.translate(-cx, -cy);
      // Cast a drop shadow behind the lifted cell (drawn via a near-transparent
      // fill of the same rounded shape, so only the shadow itself is visible).
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 10;
      ctx.fillStyle = "rgba(0,0,0,0.001)";
      roundedRectPath(ctx, cell.x, cell.y, cell.w, cell.h, state.cornerRadius);
      ctx.fill();
      ctx.restore();
    }

    drawPhotoInCell(ctx, cell, photo, state.cornerRadius, state.bgColor, forExport);

    if (lifted) ctx.restore();
  });

  for (const t of state.texts) {
    if (!forExport && editingTextId && t.id === editingTextId) continue;
    drawTextObject(ctx, t);
  }

  if (!forExport && state.selection) {
    if (state.selection.type === "photo") {
      const cell = cells[state.selection.index];
      if (cell) drawSelectionOutline(ctx, cell, 0);
    } else if (state.selection.type === "text") {
      const t = state.texts.find((x) => x.id === state.selection.id);
      if (t) {
        const { w, h } = textLocalBounds(ctx, t);
        drawSelectionOutline(ctx, { x: t.x - w / 2, y: t.y - h / 2, w, h }, 0);
      }
    }
  }

  return cells;
}
