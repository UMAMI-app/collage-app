// main.js
// App bootstrap: start screen -> editor screen, wires state + render + gestures + ui.

import { AppState, createDefaultState, imageRegistry } from "./state.js";
import { canvasPixelSize } from "./layout.js";
import { renderCanvas } from "./render.js";
import { attachGestures } from "./gestures.js";
import { initStartScreen, initEditor, requestPhotoForSlot, openTextEditor, assignFilesToSlots } from "./ui.js";

const startScreen = document.getElementById("startScreen");
const editorScreen = document.getElementById("editorScreen");
const canvas = document.getElementById("mainCanvas");
const ctx = canvas.getContext("2d");

let state = null;

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
  renderCanvas(ctx, state.data, w, h, { forExport: false });
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

async function startFresh(count, ratioId) {
  state = new AppState(createDefaultState(count, ratioId));
  goToEditor();
  bootEditor();
}

async function resumeFromAutosave() {
  const data = AppState.loadAutosave();
  if (!data) return startFresh(4, "1:1");
  await hydrateImagesForState(data);
  state = new AppState(data);
  goToEditor();
  bootEditor();
}

function bootEditor() {
  requestRender();

  attachGestures(canvas, ctx, state, {
    getCanvasSize: () => ({ w: canvas.width, h: canvas.height }),
    onRequestRender: requestRender,
    onSelectionChange: () => { state.notify(); },
    onOpenTextEditor: (t) => openTextEditor(t, state, requestRender),
    onEmptyCellTap: (index) => requestPhotoForSlot(index),
  });

  initEditor(state, {
    requestRender,
    getCanvasSize: () => ({ w: canvas.width, h: canvas.height }),
  });

  window.addEventListener("resize", requestRender);
}

const hasAutosave = !!AppState.loadAutosave();
initStartScreen({
  hasAutosave,
  onStart: (count, ratioId) => startFresh(count, ratioId),
  onResume: () => resumeFromAutosave(),
});
