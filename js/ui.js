// ui.js
// DOM wiring: start screen pickers, bottom-sheet panels, property controls,
// text editor overlay, and the template modal. Talks to the AppState /
// image registry / templates modules; does not own canvas drawing itself
// (that's render.js, driven from main.js).

import { ASPECT_RATIOS, ALT_LAYOUTS } from "./layout.js";
import { imageRegistry, defaultTextObj, resizePhotoSlots } from "./state.js";
import { listTemplates, saveTemplate, deleteTemplate, applyTemplateToState } from "./templates.js";
import { exportJPEG } from "./export.js";

const $ = (id) => document.getElementById(id);

/* ---------------- Start screen ---------------- */

export function initStartScreen({ hasAutosave, onStart, onResume }) {
  const countPicker = $("countPicker");
  const ratioPicker = $("ratioPicker");
  let selectedCount = 4;
  let selectedRatio = "1:1";

  for (let n = 1; n <= 10; n++) {
    const chip = document.createElement("button");
    chip.className = "chip" + (n === selectedCount ? " active" : "");
    chip.textContent = `${n}枚`;
    chip.addEventListener("click", () => {
      selectedCount = n;
      [...countPicker.children].forEach((c) => c.classList.toggle("active", c === chip));
    });
    countPicker.appendChild(chip);
  }

  ASPECT_RATIOS.forEach((r) => {
    const chip = document.createElement("button");
    chip.className = "chip" + (r.id === selectedRatio ? " active" : "");
    chip.textContent = r.label;
    chip.addEventListener("click", () => {
      selectedRatio = r.id;
      [...ratioPicker.children].forEach((c) => c.classList.toggle("active", c === chip));
    });
    ratioPicker.appendChild(chip);
  });

  $("startBtn").addEventListener("click", () => onStart(selectedCount, selectedRatio));

  if (hasAutosave) {
    $("resumeBtn").hidden = false;
    $("resumeBtn").addEventListener("click", onResume);
  }
}

/* ---------------- History helper for continuous controls ---------------- */

function wireContinuousStart(el, state) {
  let began = false;
  ["pointerdown", "mousedown", "touchstart"].forEach((evt) =>
    el.addEventListener(evt, () => {
      if (!began) { state.beginChange(); began = true; }
    }, { passive: true })
  );
  ["change", "pointerup", "mouseup", "touchend"].forEach((evt) =>
    el.addEventListener(evt, () => { began = false; })
  );
}

/* ---------------- Editor screen ---------------- */

export function initEditor(state, deps) {
  const { requestRender, getCanvasSize, openInlineTextEditor } = deps;

  wireTabs();
  wireLayoutPanel(state, requestRender);
  wirePhotoPanel(state, requestRender, getCanvasSize);
  wireTextPanel(state, requestRender, getCanvasSize, openInlineTextEditor);
  wireTextProps(state, requestRender);
  wireTopbar(state, requestRender);
  wireTemplateModal(state, requestRender);
  wireModalBackdropClose();

  state.onChange(() => {
    syncAllFromState(state);
    updateUndoRedoButtons(state);
    requestRender();
  });
  syncAllFromState(state);
  updateUndoRedoButtons(state);
  requestRender();
}

function wireTabs() {
  const tabs = [...document.querySelectorAll(".tab-btn")];
  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabs.forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      $(btn.dataset.panel).classList.add("active");
    });
  });
}

export function switchToTab(panelId) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.panel === panelId));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === panelId));
}

/* ---- Layout panel ---- */

function wireLayoutPanel(state, requestRender) {
  const countPicker = $("countPickerEditor");
  for (let n = 1; n <= 10; n++) {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = `${n}`;
    chip.addEventListener("click", () => {
      if (state.data.photoCount === n) return;
      state.beginChange();
      resizePhotoSlots(state, n);
      state.data.layoutVariant = 0;
      state.notify();
      requestRender();
    });
    countPicker.appendChild(chip);
  }

  const ratioPicker = $("ratioPickerEditor");
  ASPECT_RATIOS.forEach((r) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = r.label;
    chip.addEventListener("click", () => {
      if (state.data.ratioId === r.id) return;
      state.beginChange();
      state.data.ratioId = r.id;
      state.notify();
      requestRender();
    });
    ratioPicker.appendChild(chip);
  });

  document.querySelectorAll(".swatch").forEach((sw) => {
    sw.addEventListener("click", () => {
      state.beginChange();
      state.data.bgColor = sw.dataset.bg;
      state.notify();
      requestRender();
    });
  });

  const bgColorPicker = $("bgColorPicker");
  wireContinuousStart(bgColorPicker, state);
  bgColorPicker.addEventListener("input", () => {
    state.data.bgColor = bgColorPicker.value;
    state.notify();
    requestRender();
  });

  const spacingSlider = $("spacingSlider");
  wireContinuousStart(spacingSlider, state);
  spacingSlider.addEventListener("input", () => {
    state.data.spacing = Number(spacingSlider.value);
    $("spacingVal").textContent = spacingSlider.value;
    state.notify();
    requestRender();
  });

  const radiusSlider = $("radiusSlider");
  wireContinuousStart(radiusSlider, state);
  radiusSlider.addEventListener("input", () => {
    state.data.cornerRadius = Number(radiusSlider.value);
    $("radiusVal").textContent = radiusSlider.value;
    state.notify();
    requestRender();
  });

}

/* ---- Layout variant picker (alternate arrangements for 2/6/8 photos) ---- */

// Preview shape for the "standard" option, matched to computeLayout()'s
// own grid rules for these specific counts.
const STANDARD_LAYOUT_PREVIEW = {
  2: { rows: 1, cols: 2 },
  6: { rows: 3, cols: 2 },
  8: { rows: 4, cols: 2 },
  10: { rows: 5, cols: 2 },
};

function buildMiniGridIcon(rows, cols) {
  const el = document.createElement("div");
  el.className = "mini-grid-icon";
  el.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  el.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  for (let i = 0; i < rows * cols; i++) {
    const cell = document.createElement("div");
    cell.className = "mini-grid-cell";
    el.appendChild(cell);
  }
  return el;
}

function renderLayoutVariantPicker(state, requestRender) {
  const row = $("layoutVariantRow");
  const picker = $("layoutVariantPicker");
  const count = state.data.photoCount;
  const alt = ALT_LAYOUTS[count];

  if (!alt) {
    row.hidden = true;
    return;
  }
  row.hidden = false;

  const std = STANDARD_LAYOUT_PREVIEW[count];
  picker.innerHTML = "";

  [{ variant: 0, ...std }, { variant: 1, ...alt }].forEach(({ variant, rows, cols }) => {
    const btn = document.createElement("button");
    btn.className = "variant-btn" + ((state.data.layoutVariant || 0) === variant ? " active" : "");
    btn.appendChild(buildMiniGridIcon(rows, cols));
    btn.addEventListener("click", () => {
      if ((state.data.layoutVariant || 0) === variant) return;
      state.beginChange();
      state.data.layoutVariant = variant;
      state.notify();
      requestRender();
    });
    picker.appendChild(btn);
  });
}

/* ---- Photo panel ---- */

let pendingSlotTarget = null;

function wirePhotoPanel(state, requestRender, getCanvasSize) {
  const fileInput = $("fileInput");

  fileInput.addEventListener("change", async () => {
    const files = [...fileInput.files];
    fileInput.value = "";
    await assignFilesToSlots(state, files, pendingSlotTarget, requestRender);
    pendingSlotTarget = null;
  });

  const wrap = document.querySelector(".canvas-wrap");
  wrap.addEventListener("dragover", (e) => e.preventDefault());
  wrap.addEventListener("drop", async (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) await assignFilesToSlots(state, files, null, requestRender);
  });
}

export async function assignFilesToSlots(state, files, targetIndex, requestRender) {
  if (!files.length) return;
  state.beginChange();
  let fi = 0;
  if (targetIndex != null) {
    const { id, naturalW, naturalH } = await imageRegistry.addFromFile(files[0]);
    state.data.photos[targetIndex] = { imgId: id, offsetX: 0, offsetY: 0, scale: 1, rotation: 0, naturalW, naturalH };
    fi = 1;
  }
  for (let i = 0; i < state.data.photos.length && fi < files.length; i++) {
    if (state.data.photos[i]) continue;
    const { id, naturalW, naturalH } = await imageRegistry.addFromFile(files[fi]);
    state.data.photos[i] = { imgId: id, offsetX: 0, offsetY: 0, scale: 1, rotation: 0, naturalW, naturalH };
    fi++;
  }
  state.notify();
  requestRender();
}

export function requestPhotoForSlot(index) {
  pendingSlotTarget = index;
  $("fileInput").click();
}

/* ---- Text panel ---- */

function wireTextPanel(state, requestRender, getCanvasSize, openInlineTextEditor) {
  const addText = (orientation) => {
    state.beginChange();
    const { w, h } = getCanvasSize();
    const t = defaultTextObj(w, h, orientation);
    state.data.texts.push(t);
    state.data.selection = { type: "text", id: t.id };
    state.notify();
    requestRender();
    switchToTab("panel-text");
    openInlineTextEditor(t);
  };
  $("addTextBtnH").addEventListener("click", () => addText("horizontal"));
  $("addTextBtnV").addEventListener("click", () => addText("vertical"));
}

/* ---- Text properties (shown inside the テキスト tab when a text is selected) ---- */

function wireTextProps(state, requestRender) {
  const textFont = $("textFont");
  textFont.addEventListener("change", () => {
    const t = currentText(state);
    if (!t) return;
    state.beginChange();
    t.font = textFont.value;
    state.notify();
    requestRender();
  });

  const textSizeSlider = $("textSizeSlider");
  wireContinuousStart(textSizeSlider, state);
  textSizeSlider.addEventListener("input", () => {
    const t = currentText(state); if (!t) return;
    t.size = Number(textSizeSlider.value);
    $("textSizeVal").textContent = textSizeSlider.value;
    state.notify(); requestRender();
  });

  const textColorPicker = $("textColorPicker");
  wireContinuousStart(textColorPicker, state);
  textColorPicker.addEventListener("input", () => {
    const t = currentText(state); if (!t) return;
    t.color = textColorPicker.value;
    state.notify(); requestRender();
  });

  const textWeightSlider = $("textWeightSlider");
  wireContinuousStart(textWeightSlider, state);
  textWeightSlider.addEventListener("input", () => {
    const t = currentText(state); if (!t) return;
    t.weight = Number(textWeightSlider.value);
    $("textWeightVal").textContent = textWeightSlider.value;
    state.notify(); requestRender();
  });

  $("italicBtn").addEventListener("click", () => toggleTextFlag(state, requestRender, "italic", $("italicBtn")));

  [["alignLeft", "left"], ["alignCenter", "center"], ["alignRight", "right"]].forEach(([id, val]) => {
    $(id).addEventListener("click", () => {
      const t = currentText(state); if (!t) return;
      state.beginChange();
      t.align = val;
      state.notify(); requestRender();
    });
  });

  const textOpacitySlider = $("textOpacitySlider");
  wireContinuousStart(textOpacitySlider, state);
  textOpacitySlider.addEventListener("input", () => {
    const t = currentText(state); if (!t) return;
    t.opacity = Number(textOpacitySlider.value);
    $("textOpacityVal").textContent = textOpacitySlider.value;
    state.notify(); requestRender();
  });

  const textLineHeightSlider = $("textLineHeightSlider");
  wireContinuousStart(textLineHeightSlider, state);
  textLineHeightSlider.addEventListener("input", () => {
    const t = currentText(state); if (!t) return;
    t.lineHeight = Number(textLineHeightSlider.value);
    $("textLineHeightVal").textContent = textLineHeightSlider.value;
    state.notify(); requestRender();
  });

  const textLetterSpacingSlider = $("textLetterSpacingSlider");
  wireContinuousStart(textLetterSpacingSlider, state);
  textLetterSpacingSlider.addEventListener("input", () => {
    const t = currentText(state); if (!t) return;
    t.letterSpacing = Number(textLetterSpacingSlider.value);
    $("textLetterSpacingVal").textContent = textLetterSpacingSlider.value;
    state.notify(); requestRender();
  });

  $("shadowToggle").addEventListener("change", (e) => {
    const t = currentText(state); if (!t) return;
    state.beginChange();
    t.shadow.enabled = e.target.checked;
    state.notify(); requestRender();
  });

  const shadowColorPicker = $("shadowColorPicker");
  wireContinuousStart(shadowColorPicker, state);
  shadowColorPicker.addEventListener("input", () => {
    const t = currentText(state); if (!t) return;
    t.shadow.color = shadowColorPicker.value;
    state.notify(); requestRender();
  });

  const shadowDistSlider = $("shadowDistSlider");
  wireContinuousStart(shadowDistSlider, state);
  shadowDistSlider.addEventListener("input", () => {
    const t = currentText(state); if (!t) return;
    t.shadow.distance = Number(shadowDistSlider.value);
    $("shadowDistVal").textContent = shadowDistSlider.value;
    state.notify(); requestRender();
  });

  const shadowBlurSlider = $("shadowBlurSlider");
  wireContinuousStart(shadowBlurSlider, state);
  shadowBlurSlider.addEventListener("input", () => {
    const t = currentText(state); if (!t) return;
    t.shadow.blur = Number(shadowBlurSlider.value);
    $("shadowBlurVal").textContent = shadowBlurSlider.value;
    state.notify(); requestRender();
  });

  const shadowAngleSlider = $("shadowAngleSlider");
  wireContinuousStart(shadowAngleSlider, state);
  shadowAngleSlider.addEventListener("input", () => {
    const t = currentText(state); if (!t) return;
    t.shadow.angle = Number(shadowAngleSlider.value);
    $("shadowAngleVal").textContent = shadowAngleSlider.value;
    state.notify(); requestRender();
  });

  const shadowOpacitySlider = $("shadowOpacitySlider");
  wireContinuousStart(shadowOpacitySlider, state);
  shadowOpacitySlider.addEventListener("input", () => {
    const t = currentText(state); if (!t) return;
    t.shadow.opacity = Number(shadowOpacitySlider.value);
    $("shadowOpacityVal").textContent = shadowOpacitySlider.value;
    state.notify(); requestRender();
  });

  $("deleteTextBtn").addEventListener("click", () => {
    const t = currentText(state); if (!t) return;
    state.beginChange();
    state.data.texts = state.data.texts.filter((x) => x.id !== t.id);
    state.data.selection = null;
    state.notify(); requestRender();
  });
}

function toggleTextFlag(state, requestRender, key, btn) {
  const t = currentText(state); if (!t) return;
  state.beginChange();
  t[key] = !t[key];
  state.notify(); requestRender();
}

function currentText(state) {
  const s = state.data.selection;
  if (!s || s.type !== "text") return null;
  return state.data.texts.find((t) => t.id === s.id) || null;
}

/* ---- Topbar (undo/redo/export) ---- */

function wireTopbar(state, requestRender) {
  $("undoBtn").addEventListener("click", () => { state.undo(); requestRender(); });
  $("redoBtn").addEventListener("click", () => { state.redo(); requestRender(); });
  $("exportBtn").addEventListener("click", async () => {
    const btn = $("exportBtn");
    const original = btn.textContent;
    btn.textContent = "書き出し中…";
    btn.disabled = true;
    try {
      await exportJPEG(state);
    } finally {
      btn.textContent = original;
      btn.disabled = false;
    }
  });
}

export function updateUndoRedoButtons(state) {
  $("undoBtn").disabled = !state.canUndo();
  $("redoBtn").disabled = !state.canRedo();
}

/* ---- Template modal ---- */

function wireTemplateModal(state, requestRender) {
  const closeModal = () => { $("templateModal").hidden = true; };

  $("templateBtn").addEventListener("click", () => {
    renderTemplateList(state, requestRender);
    $("templateModal").hidden = false;
  });
  $("closeTemplateModal").addEventListener("click", closeModal);
  $("templateModalClose").addEventListener("click", closeModal);
  $("saveTemplateBtn").addEventListener("click", () => {
    const name = $("templateNameInput").value.trim();
    saveTemplate(name, state.data);
    $("templateNameInput").value = "";
    renderTemplateList(state, requestRender);
  });
}

/** Safety net: tapping the dimmed backdrop of any .modal closes it, and Escape closes
 *  whichever modal is currently open. Covers the template modal and the text editor. */
function wireModalBackdropClose() {
  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.hidden = true;
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".modal").forEach((modal) => {
      if (!modal.hidden) modal.hidden = true;
    });
  });
}

function renderTemplateList(state, requestRender) {
  const list = $("templateList");
  list.innerHTML = "";
  const templates = listTemplates();
  if (!templates.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "保存済みのテンプレートはありません";
    list.appendChild(empty);
    return;
  }
  templates.forEach((tpl) => {
    const row = document.createElement("div");
    row.className = "template-row";
    const span = document.createElement("span");
    span.textContent = tpl.name;
    row.appendChild(span);

    const applyBtn = document.createElement("button");
    applyBtn.textContent = "適用";
    applyBtn.addEventListener("click", () => {
      applyTemplateToState(state, tpl);
      requestRender();
      $("templateModal").hidden = true;
    });
    row.appendChild(applyBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "danger";
    delBtn.textContent = "削除";
    delBtn.addEventListener("click", () => {
      deleteTemplate(tpl.id);
      renderTemplateList(state, requestRender);
    });
    row.appendChild(delBtn);

    list.appendChild(row);
  });
}

/* ---------------- Full sync (after undo/redo/template apply/init) ---------------- */

export function syncAllFromState(state) {
  const d = state.data;

  document.querySelectorAll("#countPickerEditor .chip").forEach((c, i) => c.classList.toggle("active", i + 1 === d.photoCount));
  document.querySelectorAll("#ratioPickerEditor .chip").forEach((c, i) => c.classList.toggle("active", ASPECT_RATIOS[i].id === d.ratioId));

  $("bgColorPicker").value = /^#/.test(d.bgColor) ? d.bgColor : "#ffffff";
  $("spacingSlider").value = d.spacing; $("spacingVal").textContent = d.spacing;
  $("radiusSlider").value = d.cornerRadius; $("radiusVal").textContent = d.cornerRadius;
  renderLayoutVariantPicker(state, () => {});

  const sel = d.selection;
  const textSelected = !!(sel && sel.type === "text");
  $("textAddRow").hidden = textSelected;
  $("textProps").hidden = !textSelected;

  if (sel && sel.type === "text") {
    const t = d.texts.find((x) => x.id === sel.id);
    if (t) {
      $("textFont").value = t.font;
      $("textSizeSlider").value = t.size; $("textSizeVal").textContent = t.size;
      $("textColorPicker").value = t.color;
      $("textWeightSlider").value = t.weight || 400; $("textWeightVal").textContent = t.weight || 400;
      $("italicBtn").classList.toggle("active", t.italic);
      $("alignLeft").classList.toggle("active", t.align === "left");
      $("alignCenter").classList.toggle("active", t.align === "center");
      $("alignRight").classList.toggle("active", t.align === "right");
      $("textOpacitySlider").value = t.opacity; $("textOpacityVal").textContent = t.opacity;
      $("textLineHeightSlider").value = t.lineHeight; $("textLineHeightVal").textContent = t.lineHeight;
      $("textLetterSpacingSlider").value = t.letterSpacing; $("textLetterSpacingVal").textContent = t.letterSpacing;
      $("shadowToggle").checked = t.shadow.enabled;
      $("shadowProps").hidden = !t.shadow.enabled;
      $("shadowColorPicker").value = t.shadow.color;
      $("shadowDistSlider").value = t.shadow.distance; $("shadowDistVal").textContent = t.shadow.distance;
      $("shadowBlurSlider").value = t.shadow.blur; $("shadowBlurVal").textContent = t.shadow.blur;
      $("shadowAngleSlider").value = t.shadow.angle; $("shadowAngleVal").textContent = t.shadow.angle;
      $("shadowOpacitySlider").value = t.shadow.opacity; $("shadowOpacityVal").textContent = t.shadow.opacity;
    }
  }
}
