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

function drawPhotoInCell(ctx, cell, photo, cornerRadius, bgColor) {
  const entry = photo ? imageRegistry.get(photo.imgId) : null;

  ctx.save();
  roundedRectPath(ctx, cell.x, cell.y, cell.w, cell.h, cornerRadius);
  ctx.clip();

  if (entry) {
    const baseScale = coverBaseScale(cell.w, cell.h, entry.naturalW, entry.naturalH);
    const totalScale = baseScale * (photo.scale || 1);
    ctx.translate(cell.x + cell.w / 2 + (photo.offsetX || 0), cell.y + cell.h / 2 + (photo.offsetY || 0));
    ctx.rotate(((photo.rotation || 0) * Math.PI) / 180);
    ctx.scale(totalScale, totalScale);
    ctx.drawImage(entry.img, -entry.naturalW / 2, -entry.naturalH / 2, entry.naturalW, entry.naturalH);
  } else {
    // Empty slot: blend into the canvas background (no gray/dashed/plus
    // placeholder) so it looks intentional both on-screen and in exports.
    ctx.fillStyle = bgColor;
    ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
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
  ctx.strokeStyle = "#4f8cff";
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

    drawPhotoInCell(ctx, cell, photo, state.cornerRadius, state.bgColor);

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
