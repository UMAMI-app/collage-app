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

  // On iOS/iPadOS Safari, a plain <a download> link just drops the file into
  // "Files > Downloads" - it does NOT reach the Photos app. Routing through
  // the native share sheet (Web Share API, file variant) lets the user pick
  // "画像を保存" / "Save Image", which saves straight into Photos. No browser
  // API can write to Photos without this user-facing step (silent writes
  // aren't permitted for privacy/security reasons).
  if (navigator.canShare && navigator.share) {
    try {
      const file = new File([blob], filename, { type: "image/jpeg" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Collage" });
        return filename;
      }
    } catch (err) {
      if (err && err.name === "AbortError") return filename; // user cancelled the share sheet
      // otherwise fall through to the download fallback below
    }
  }

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
