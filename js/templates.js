// templates.js
// Named, reusable style presets. Per spec, a template captures layout/canvas
// size, background, spacing, corner radius, and text position/design/shadow
// — but NOT the actual photos.

import { uid } from "./state.js";

const KEY = "collage-app:templates:v1";

/** Built-in templates, always listed first and not deletable. They only
 *  switch the A/B/C... corner-label style; everything else is left alone. */
export const BUILTIN_TEMPLATES = [
  { id: "builtin-label-circle", name: "ラベル A/B/C・白丸", builtin: true, labelStyle: "circle" },
  { id: "builtin-label-shadow", name: "ラベル A/B/C・ドロップシャドウ", builtin: true, labelStyle: "shadow" },
  { id: "builtin-label-none", name: "ラベルなし", builtin: true, labelStyle: null },
];

export function listTemplates() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function persist(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function saveTemplate(name, data) {
  const list = listTemplates();
  const tpl = {
    id: uid("tpl"),
    name: name || `テンプレート ${list.length + 1}`,
    createdAt: Date.now(),
    photoCount: data.photoCount,
    ratioId: data.ratioId,
    bgColor: data.bgColor,
    spacing: data.spacing,
    cornerRadius: data.cornerRadius,
    layoutVariant: data.layoutVariant || 0,
    labelStyle: data.labelStyle || null,
    texts: JSON.parse(JSON.stringify(data.texts)),
  };
  list.push(tpl);
  persist(list);
  return tpl;
}

export function deleteTemplate(id) {
  const list = listTemplates().filter((t) => t.id !== id);
  persist(list);
}

/** Apply a template's style fields onto a live state object (photos are left untouched). */
export function applyTemplateToState(state, tpl) {
  state.beginChange();
  const d = state.data;
  if (tpl.builtin) {
    d.labelStyle = tpl.labelStyle || null;
    state.notify();
    return;
  }
  d.labelStyle = tpl.labelStyle || null;
  d.ratioId = tpl.ratioId;
  d.bgColor = tpl.bgColor;
  d.spacing = tpl.spacing;
  d.cornerRadius = tpl.cornerRadius;
  d.layoutVariant = tpl.layoutVariant || 0;
  d.texts = JSON.parse(JSON.stringify(tpl.texts)).map((t) => ({ ...t, id: t.id + "_" + Math.random().toString(36).slice(2, 7) }));
  if (tpl.photoCount !== d.photoCount) {
    const cur = d.photos;
    d.photos = Array.from({ length: tpl.photoCount }, (_, i) => cur[i] || null);
    d.photoCount = tpl.photoCount;
  }
  d.selection = null;
  state.notify();
}
