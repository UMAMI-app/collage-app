// main.js
// App bootstrap: boots straight into the editor (default 4 photos / 1:1),
// silently resuming from autosave if one exists. Wires state + render +
// gestures + ui.

import { AppState, createDefaultState, imageRegistry } from "./state.js";
import { canvasPixelSize } from "./layout.js";
import { renderCanvas, textLocalBounds } from "./render.js";
import { attachGestures } from "./gestures.js";
import { initEditor, requestPhotoForSlot } from "./ui.js";

const inlineTextEditArea = document.getElementById("inlineTextEditArea");

const DEFAULT_PHOTO_COUNT = 4;
const DEFAULT_RATIO_ID = "1:1";

const startScreen = document.getElementById("startScreen");
const editorScreen = document.getElementById("editorScreen");
const canvas = document.getElementById("mainCanvas");
const ctx = canvas.getContext("2d");

let state = null;
let liftedPhotoIndex = null;

/** Force every modal/overlay closed. Mobile Safari can restore a page from its
 *  back-forward cache with whatever DOM state it had when you navigated away
 *  (e.g. a modal left open), which looks like "it opens every time" even
 *  though it's really the same never-closed session being resurrected. */
function forceAllModalsClosed() {
  document.querySelectorAll(".modal").forEach((m) => { m.hidden = true; });
}
forceAllModalsClosed();
window.addEventListener("pageshow", (e) => {
  if (e.persisted) forceAllModalsClosed();
});

function syncCanvasPixelSize() {
  const { w, h } = canvasPixelSize(state.data.ratioId);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h };
}

function requestRender() {
  if (!state) return;
  const { w, h } = syncCanvasPixelSize();
  renderCanvas(ctx, state.data, w, h, { forExport: false, liftedIndex: liftedPhotoIndex });
}

/** Double-tap-to-edit: positions a borderless textarea directly over the
 *  text object (in CSS pixels, converted from canvas pixel space) so typing
 *  feels like editing in place rather than opening a separate popup. */
function openInlineTextEditor(textObj) {
  const area = inlineTextEditArea;
  const rect = canvas.getBoundingClientRect();
  const wrapRect = canvas.parentElement.getBoundingClientRect();
  const scaleX = rect.width / canvas.width;
  const scaleY = rect.height / canvas.height;
  const { w, h } = textLocalBounds(ctx, textObj);

  const canvasOffsetLeft = rect.left - wrapRect.left;
  const canvasOffsetTop = rect.top - wrapRect.top;
  const cssW = Math.max(30, w * scaleX);
  const cssH = Math.max(24, h * scaleY);

  area.style.left = `${canvasOffsetLeft + textObj.x * scaleX - cssW / 2}px`;
  area.style.top = `${canvasOffsetTop + textObj.y * scaleY - cssH / 2}px`;
  area.style.width = `${cssW}px`;
  area.style.height = `${cssH}px`;
  area.style.fontSize = `${textObj.size * scaleY}px`;
  area.style.lineHeight = String(textObj.lineHeight);
  area.style.color = textObj.color;
  area.style.fontWeight = String(textObj.weight || 400);
  area.style.fontStyle = textObj.italic ? "italic" : "normal";
  area.style.fontFamily = textObj.font;
  area.style.writingMode = textObj.orientation === "vertical" ? "vertical-rl" : "horizontal-tb";
  area.style.textAlign = textObj.orientation === "vertical" ? "center" : (textObj.align || "center");

  area.hidden = false;
  area.value = textObj.content;

  let began = false;
  const commit = () => {
    if (!began) { state.beginChange(); began = true; }
    textObj.content = area.value;
    state.notify();
    requestRender();
  };
  area.oninput = commit;
  area.onblur = () => {
    area.hidden = true;
    area.oninput = null;
    area.onblur = null;
  };

  requestAnimationFrame(() => {
    area.focus();
    area.select();
  });
}

async function hydrateImagesForState(data) {
  const ids = new Set();
  for (const p of data.photos) if (p && p.imgId) ids.add(p.imgId);
  await Promise.all([...ids].map((id) => imageRegistry.ensureLoaded(id)));
}

function goToEditor() {
  startScreen.hidden = true;
  editorScreen.hidden = false;
}

function startFresh(count, ratioId) {
  state = new AppState(createDefaultState(count, ratioId));
  goToEditor();
  bootEditor();
}

/** Boots the editor immediately (no blank/loading screen), then hydrates
 *  any autosaved photos in the background and re-renders once ready. */
async function resumeFromAutosave() {
  const data = AppState.loadAutosave();
  if (!data) return startFresh(DEFAULT_PHOTO_COUNT, DEFAULT_RATIO_ID);
  state = new AppState(data);
  goToEditor();
  bootEditor();
  await hydrateImagesForState(data);
  requestRender();
}

function bootEditor() {
  requestRender();

  attachGestures(canvas, ctx, state, {
    getCanvasSize: () => ({ w: canvas.width, h: canvas.height }),
    onRequestRender: requestRender,
    onSelectionChange: () => { state.notify(); },
    onTextDoubleTap: (t) => openInlineTextEditor(t),
    onEmptyCellTap: (index) => requestPhotoForSlot(index),
    onLiftChange: (index) => { liftedPhotoIndex = index; requestRender(); },
  });

  initEditor(state, {
    requestRender,
    getCanvasSize: () => ({ w: canvas.width, h: canvas.height }),
    openInlineTextEditor,
  });

  window.addEventListener("resize", requestRender);
}

if (AppState.loadAutosave()) {
  resumeFromAutosave();
} else {
  startFresh(DEFAULT_PHOTO_COUNT, DEFAULT_RATIO_ID);
}
