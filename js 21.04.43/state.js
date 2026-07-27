// state.js
// Central app state, undo/redo history, autosave, and the in-memory image
// registry. Photo pixel data lives in IndexedDB (see db.js); the JSON state
// only ever stores lightweight "imgId" references to it, which keeps
// localStorage autosave and undo/redo snapshots cheap.

import * as db from "./db.js";

const AUTOSAVE_KEY = "collage-app:autosave:v1";
const HISTORY_LIMIT = 60;

let uidCounter = 1;
export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${(uidCounter++).toString(36)}`;
}

export function defaultShadow() {
  return {
    enabled: false,
    color: "#000000",
    distance: 4,
    blur: 6,
    angle: 45,
    opacity: 60,
  };
}

export function defaultTextObj(canvasW, canvasH, orientation = "horizontal") {
  return {
    id: uid("text"),
    content: orientation === "vertical" ? "縦書き" : "テキスト",
    font: "'Hiragino Sans', 'Noto Sans JP', sans-serif",
    size: 48,
    color: "#ffffff",
    weight: 400,
    italic: false,
    align: "center",
    orientation, // 'horizontal' | 'vertical'
    rotation: 0, // no longer user-editable; kept at 0
    opacity: 100,
    lineHeight: 1.2,
    letterSpacing: 0,
    x: canvasW / 2,
    y: canvasH / 2,
    shadow: defaultShadow(),
  };
}

export function defaultPhotoSlotData() {
  return null; // empty slot
}

export function createDefaultState(count, ratioId) {
  return {
    photoCount: count,
    ratioId,
    bgColor: "#ffffff",
    spacing: 8,
    cornerRadius: 0,
    layoutVariant: 0, // 0 = standard grid; 1 = alternate (only meaningful for counts 2/6/8)
    photos: Array.from({ length: count }, defaultPhotoSlotData),
    texts: [],
    selection: null, // { type: 'photo', index } | { type: 'text', id } | null
  };
}

/* ---------------- Image registry (not part of history) ---------------- */

class ImageRegistry {
  constructor() {
    this.cache = new Map(); // imgId -> { img, url, naturalW, naturalH }
  }

  async addFromFile(file) {
    const id = uid("img");
    const url = URL.createObjectURL(file);
    const img = await loadHTMLImage(url);
    this.cache.set(id, { img, url, naturalW: img.naturalWidth, naturalH: img.naturalHeight });
    // fire and forget persistence
    db.putImage(id, file).catch((e) => console.warn("image persist failed", e));
    return { id, naturalW: img.naturalWidth, naturalH: img.naturalHeight };
  }

  async ensureLoaded(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const blob = await db.getImage(id);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    const img = await loadHTMLImage(url);
    const entry = { img, url, naturalW: img.naturalWidth, naturalH: img.naturalHeight };
    this.cache.set(id, entry);
    return entry;
  }

  get(id) {
    return this.cache.get(id) || null;
  }
}

function loadHTMLImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export const imageRegistry = new ImageRegistry();

/* ---------------- App state container ---------------- */

export class AppState {
  constructor(initial) {
    this.data = initial;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    this._autosaveTimer = null;
    this._pendingSnapshotBeforeChange = null;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    for (const fn of this.listeners) fn(this.data);
    this._scheduleAutosave();
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.data));
  }

  /** Call before mutating state as part of a user-visible edit, so it can be undone. */
  beginChange() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo() {
    if (!this.canUndo()) return;
    this.redoStack.push(this.snapshot());
    this.data = this.undoStack.pop();
    this.notify();
  }

  redo() {
    if (!this.canRedo()) return;
    this.undoStack.push(this.snapshot());
    this.data = this.redoStack.pop();
    this.notify();
  }

  _scheduleAutosave() {
    clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(() => this._autosave(), 500);
  }

  _autosave() {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.warn("autosave failed", e);
    }
  }

  static loadAutosave() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  static clearAutosave() {
    localStorage.removeItem(AUTOSAVE_KEY);
  }
}

/* ---------------- Layout resize helpers ---------------- */

export function resizePhotoSlots(state, newCount) {
  const cur = state.data.photos;
  const next = Array.from({ length: newCount }, (_, i) => cur[i] || null);
  state.data.photos = next;
  state.data.photoCount = newCount;
  if (state.data.selection && state.data.selection.type === "photo" && state.data.selection.index >= newCount) {
    state.data.selection = null;
  }
}
