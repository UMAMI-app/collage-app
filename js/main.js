// main.js
// App bootstrap: boots straight into the editor (default 4 photos / 1:1),
// silently resuming from autosave if one exists. Wires state + render +
// gestures + ui.

import { AppState, createDefaultState, imageRegistry, uid } from "./state.js";
import { canvasPixelSize } from "./layout.js";
import { renderCanvas, textLocalBounds, getCellRects } from "./render.js";
import { attachGestures } from "./gestures.js";
import { initEditor, requestPhotoForSlot, switchToTab } from "./ui.js";

const inlineTextEditArea = document.getElementById("inlineTextEditArea");
const photoActionBar = document.getElementById("photoActionBar");
const textActionBar = document.getElementById("textActionBar");

const DEFAULT_PHOTO_COUNT = 1;
const DEFAULT_RATIO_ID = "1:1";

const startScreen = document.getElementById("startScreen");
const editorScreen = document.getElementById("editorScreen");
const canvas = document.getElementById("mainCanvas");
const ctx = canvas.getContext("2d");

let state = null;
let liftedPhotoIndex = null;
let editingTextId = null;
let photoManipulating = false; // true while pinch/drag/reorder is actively changing the selected photo
let textActionBarId = null; // id of the text currently showing the long-press 複製/削除 bar
let photoActionBarIndex = null; // index of the photo currently showing the long-press 90°/削除 bar

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
  renderCanvas(ctx, state.data, w, h, { forExport: false, liftedIndex: liftedPhotoIndex, editingTextId });
  updatePhotoActionBar();
  updateTextActionBar();
}

/** Positions the floating delete/rotate action bar over the currently
 *  selected photo cell (CSS pixels, converted from canvas pixel space),
 *  and hides it whenever a photo isn't selected. */
function updatePhotoActionBar() {
  const sel = state.data.selection;
  if (
    photoManipulating ||
    !sel ||
    sel.type !== "photo" ||
    sel.index !== photoActionBarIndex ||
    !state.data.photos[sel.index]
  ) {
    photoActionBar.hidden = true;
    return;
  }
  const cells = getCellRects(state.data, canvas.width, canvas.height);
  const cell = cells[sel.index];
  if (!cell) {
    photoActionBar.hidden = true;
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const wrapRect = canvas.parentElement.getBoundingClientRect();
  const scaleX = rect.width / canvas.width;
  const scaleY = rect.height / canvas.height;
  const canvasOffsetLeft = rect.left - wrapRect.left;
  const canvasOffsetTop = rect.top - wrapRect.top;

  const cx = canvasOffsetLeft + (cell.x + cell.w / 2) * scaleX;
  const topY = canvasOffsetTop + cell.y * scaleY;

  photoActionBar.style.left = `${cx}px`;
  photoActionBar.style.top = `${Math.max(4, topY + 8)}px`;
  photoActionBar.style.transform = "translateX(-50%)";
  photoActionBar.hidden = false;
}

/** Positions the floating 複製/削除 bar above a long-pressed text object;
 *  hidden whenever no text has been long-pressed (or it was since removed). */
function updateTextActionBar() {
  if (!textActionBarId) {
    textActionBar.hidden = true;
    return;
  }
  const t = state.data.texts.find((x) => x.id === textActionBarId);
  if (!t) {
    textActionBarId = null;
    textActionBar.hidden = true;
    return;
  }

  const { h } = textLocalBounds(ctx, t);
  const rect = canvas.getBoundingClientRect();
  const wrapRect = canvas.parentElement.getBoundingClientRect();
  const scaleX = rect.width / canvas.width;
  const scaleY = rect.height / canvas.height;
  const canvasOffsetLeft = rect.left - wrapRect.left;
  const canvasOffsetTop = rect.top - wrapRect.top;

  const cx = canvasOffsetLeft + t.x * scaleX;
  const topY = canvasOffsetTop + (t.y - h / 2) * scaleY;

  textActionBar.style.left = `${cx}px`;
  textActionBar.style.top = `${Math.max(4, topY - 48)}px`;
  textActionBar.style.transform = "translateX(-50%)";
  textActionBar.hidden = false;
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

  // Hide the canvas-drawn copy of this text object while the overlay
  // textarea is showing it, otherwise the two overlap and look like a
  // doubled/drop-shadowed duplicate of the text.
  editingTextId = textObj.id;
  requestRender();

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
    editingTextId = null;
    requestRender();
  };

  // iOS Safari only pops the keyboard for a focus() call made synchronously
  // within the user-gesture call stack (the tap/click handler); deferring it
  // to requestAnimationFrame breaks that chain and the keyboard silently
  // fails to appear. So focus/select happen immediately, not next frame.
  area.focus();
  area.select();
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
    onSelectionChange: (sel) => {
      state.notify();
      // Selecting a text object shows its properties inside the テキスト tab,
      // so jump there automatically (mirrors the old 選択中 tab's role).
      // Selecting a photo does the same for the 回転 tab's slider.
      if (sel && sel.type === "text") switchToTab("panel-text");
      if (sel && sel.type === "photo") switchToTab("panel-rotate");
      // The long-press action bars only belong to the object they were
      // raised for; any other selection change (or none) dismisses them.
      if (!(sel && sel.type === "text" && sel.id === textActionBarId)) {
        textActionBarId = null;
      }
      if (!(sel && sel.type === "photo" && sel.index === photoActionBarIndex)) {
        photoActionBarIndex = null;
      }
    },
    onTextDoubleTap: (t) => openInlineTextEditor(t),
    onEmptyCellTap: (index) => requestPhotoForSlot(index),
    onLiftChange: (index) => { liftedPhotoIndex = index; requestRender(); },
    onPhotoManipulating: (active) => { photoManipulating = active; requestRender(); },
    onTextLongPress: (textId) => { textActionBarId = textId; requestRender(); },
    onPhotoLongPress: (index) => { photoActionBarIndex = index; requestRender(); },
  });

  initEditor(state, {
    requestRender,
    getCanvasSize: () => ({ w: canvas.width, h: canvas.height }),
    openInlineTextEditor,
  });

  document.getElementById("photoRotateBtn").addEventListener("click", () => {
    const sel = state.data.selection;
    if (!sel || sel.type !== "photo") return;
    const p = state.data.photos[sel.index];
    if (!p) return;
    state.beginChange();
    p.rotation = ((p.rotation || 0) + 90) % 360;
    state.notify();
    requestRender();
  });

  document.getElementById("photoDeleteBtn").addEventListener("click", () => {
    const sel = state.data.selection;
    if (!sel || sel.type !== "photo") return;
    state.beginChange();
    state.data.photos[sel.index] = null;
    state.data.selection = null;
    photoActionBarIndex = null;
    state.notify();
    requestRender();
  });

  document.getElementById("textDuplicateBtn").addEventListener("click", () => {
    const t = state.data.texts.find((x) => x.id === textActionBarId);
    if (!t) return;
    state.beginChange();
    const copy = { ...t, id: uid("text"), shadow: { ...t.shadow }, x: t.x + 24, y: t.y + 24 };
    state.data.texts.push(copy);
    state.data.selection = { type: "text", id: copy.id };
    textActionBarId = null;
    state.notify();
    switchToTab("panel-text");
    requestRender();
  });

  document.getElementById("textActionDeleteBtn").addEventListener("click", () => {
    const id = textActionBarId;
    if (!id) return;
    state.beginChange();
    state.data.texts = state.data.texts.filter((x) => x.id !== id);
    if (state.data.selection && state.data.selection.type === "text" && state.data.selection.id === id) {
      state.data.selection = null;
    }
    textActionBarId = null;
    state.notify();
    requestRender();
  });

  window.addEventListener("resize", requestRender);

  // Canvas text can paint before a webfont (Noto Sans/Serif JP) finishes
  // downloading, silently falling back to a system font for that first
  // frame - re-render once fonts are actually ready so weights render correctly.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => requestRender());
  }
}

if (AppState.loadAutosave()) {
  resumeFromAutosave();
} else {
  startFresh(DEFAULT_PHOTO_COUNT, DEFAULT_RATIO_ID);
}
