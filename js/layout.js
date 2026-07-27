// layout.js
// Given a photo count (1-10), canvas pixel size, and spacing,
// returns an array of cell rects { x, y, w, h } in canvas pixel space,
// one per photo slot, in slot order.
//
// Rules (per spec):
//  - 1 photo: fills the whole canvas.
//  - even count: N/2 rows x 2 columns, all cells equal size.
//  - odd count: (N-1)/2 rows of 2 columns, plus one final full-width row
//    for the last photo (rendered as a wide single cell).

export const ASPECT_RATIOS = [
  { id: "1:1", label: "正方形 1:1", w: 1, h: 1 },
  { id: "4:5", label: "縦長 4:5", w: 4, h: 5 },
  { id: "5:4", label: "横長 5:4", w: 5, h: 4 },
  { id: "3:4", label: "縦長 3:4", w: 3, h: 4 },
  { id: "4:3", label: "横長 4:3", w: 4, h: 3 },
  { id: "2:3", label: "縦長 2:3", w: 2, h: 3 },
  { id: "3:2", label: "横長 3:2", w: 3, h: 2 },
  { id: "9:16", label: "ストーリー 9:16", w: 9, h: 16 },
];

const BASE_LONG_SIDE = 1400; // on-screen working resolution (long side, px)

export function canvasPixelSize(ratioId) {
  const r = ASPECT_RATIOS.find((r) => r.id === ratioId) || ASPECT_RATIOS[0];
  let w, h;
  if (r.w >= r.h) {
    w = BASE_LONG_SIDE;
    h = Math.round((BASE_LONG_SIDE * r.h) / r.w);
  } else {
    h = BASE_LONG_SIDE;
    w = Math.round((BASE_LONG_SIDE * r.w) / r.h);
  }
  return { w, h };
}

export function exportPixelSize(ratioId, longSide = 2048) {
  const r = ASPECT_RATIOS.find((r) => r.id === ratioId) || ASPECT_RATIOS[0];
  let w, h;
  if (r.w >= r.h) {
    w = longSide;
    h = Math.round((longSide * r.h) / r.w);
  } else {
    h = longSide;
    w = Math.round((longSide * r.w) / r.h);
  }
  return { w, h };
}

// Alternate ("variant 1") arrangements, offered only for these counts.
// Expressed as a uniform rows x cols grid.
export const ALT_LAYOUTS = {
  2: { rows: 2, cols: 1 }, // stacked top/bottom instead of side by side
  6: { rows: 2, cols: 3 }, // wide 3-across instead of tall 2-across
  8: { rows: 2, cols: 4 }, // wide 4-across instead of tall 2-across
  10: { rows: 2, cols: 5 }, // wide 5-across instead of tall 2-across
};

function computeUniformGrid(rows, cols, canvasW, canvasH, spacing, count) {
  const rowH = (canvasH - spacing * (rows + 1)) / rows;
  const colW = (canvasW - spacing * (cols + 1)) / cols;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = spacing + c * (colW + spacing);
      const y = spacing + r * (rowH + spacing);
      cells.push({ x, y, w: colW, h: rowH });
    }
  }
  return cells.slice(0, count);
}

/**
 * Compute cell rects for a given photo count.
 * @param {number} count 1..10
 * @param {number} canvasW
 * @param {number} canvasH
 * @param {number} spacing px, used both as outer margin and inter-cell gap
 * @param {number} variant 0 = standard, 1 = alternate (only for counts in ALT_LAYOUTS)
 * @returns {Array<{x:number,y:number,w:number,h:number}>}
 */
export function computeLayout(count, canvasW, canvasH, spacing, variant = 0) {
  count = Math.max(1, Math.min(10, count));

  if (count === 1) {
    return [{ x: 0, y: 0, w: canvasW, h: canvasH }];
  }

  if (variant === 1 && ALT_LAYOUTS[count]) {
    const { rows, cols } = ALT_LAYOUTS[count];
    return computeUniformGrid(rows, cols, canvasW, canvasH, spacing, count);
  }

  const isOdd = count % 2 === 1;
  const gridPhotoCount = isOdd ? count - 1 : count;
  const gridRows = gridPhotoCount / 2;
  const totalRows = isOdd ? gridRows + 1 : gridRows;

  const rowH = (canvasH - spacing * (totalRows + 1)) / totalRows;
  const colW = (canvasW - spacing * 3) / 2;
  const fullW = canvasW - spacing * 2;

  const cells = [];
  let slot = 0;

  for (let r = 0; r < gridRows; r++) {
    const y = spacing + r * (rowH + spacing);
    // left cell
    const x0 = spacing;
    cells.push({ x: x0, y, w: colW, h: rowH });
    slot++;
    // right cell
    const x1 = spacing + colW + spacing;
    cells.push({ x: x1, y, w: colW, h: rowH });
    slot++;
  }

  if (isOdd) {
    const y = spacing + gridRows * (rowH + spacing);
    cells.push({ x: spacing, y, w: fullW, h: rowH });
    slot++;
  }

  return cells.slice(0, count);
}

export function roundedRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
