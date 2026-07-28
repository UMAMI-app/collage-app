// export.js
// Renders the composition at a high, fixed export resolution and downloads
// it as a single JPEG (per spec: JPEG only, quality fixed high).

import { exportPixelSize, canvasPixelSize } from "./layout.js";
import { renderCanvas } from "./render.js";

const EXPORT_LONG_SIDE = 2048;
const JPEG_QUALITY = 0.95;

// state.data is authored entirely in the editor's working resolution
// (canvasPixelSize, long side 1400px). A handful of its fields are absolute
// pixel values measured in that space - spacing/cornerRadius (layout),
// photo offsetX/offsetY (pan position), and text x/y/size/letterSpacing +
// shadow distance/blur. Exporting re-renders at a different, higher
// resolution (EXPORT_LONG_SIDE, 2048px), so those absolute values must be
// scaled up by the same ratio or every position/size drifts from what the
// editor preview showed. Everything else (scale, rotation, weight, opacity,
// lineHeight, angle - all unitless/relative) is copied through unchanged.
function buildExportData(data, scale) {
  return {
    ...data,
    spacing: data.spacing * scale,
    cornerRadius: data.cornerRadius * scale,
    photos: data.photos.map((p) =>
      p
        ? { ...p, offsetX: (p.offsetX || 0) * scale, offsetY: (p.offsetY || 0) * scale }
        : p
    ),
    texts: data.texts.map((t) => ({
      ...t,
      x: t.x * scale,
      y: t.y * scale,
      size: t.size * scale,
      letterSpacing: t.letterSpacing * scale,
      shadow: t.shadow
        ? { ...t.shadow, distance: t.shadow.distance * scale, blur: t.shadow.blur * scale }
        : t.shadow,
    })),
  };
}

export async function exportJPEG(state) {
  const { w, h } = exportPixelSize(state.data.ratioId, EXPORT_LONG_SIDE);
  const { w: editW } = canvasPixelSize(state.data.ratioId);
  const scale = w / editW;
  const exportData = buildExportData(state.data, scale);
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const ctx = off.getContext("2d");
  renderCanvas(ctx, exportData, w, h, { forExport: true });

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
