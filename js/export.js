// export.js
// Renders the composition at a high, fixed export resolution and downloads
// it as a single JPEG (per spec: JPEG only, quality fixed high).

import { exportPixelSize } from "./layout.js";
import { renderCanvas } from "./render.js";

const EXPORT_LONG_SIDE = 2048;
const JPEG_QUALITY = 0.95;

export async function exportJPEG(state) {
  const { w, h } = exportPixelSize(state.data.ratioId, EXPORT_LONG_SIDE);
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const ctx = off.getContext("2d");
  renderCanvas(ctx, state.data, w, h, { forExport: true });

  const blob = await new Promise((resolve) => off.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  const ts = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const filename = `collage_${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.jpg`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return filename;
}
