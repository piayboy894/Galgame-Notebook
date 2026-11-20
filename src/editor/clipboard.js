import { $, ROW_MIME, currentStage, esc, inspectName, libraryVisible, state } from "./context.js";
import { collectInvestigationCards, pasteInvestigationCards } from "./investigation-editor.js";
import { collectRows, pasteRows, rowsAreEditable, rowText } from "./row-operations.js";
import { currentRows, toast } from "./session.js";

const CARD_MIME = "application/x-xuxian-investigation-cards+json";

// A shortcut within the editor can use the structured content it copied even on
// WebViews that never dispatch a paste event for a focused button. After
// leaving the window, require a typed system payload to establish ownership.
let ownsClipboard = false;
let localOnlyPayload = null;
let pendingPaste = null;
let pastedOnKeyUp = false;

function writeClipboard(payload, event) {
  const data = event.clipboardData;
  if (!data) return false;
  try {
    data.setData("text/plain", payload.text);
  } catch {
    return false;
  }
  event.preventDefault();
  const serialized = JSON.stringify(payload);
  // HTML survives clipboard bridges which strip private MIME types.
  const marker = payload.cards ? "data-xuxian-clipboard" : "data-xuxian-rows";
  const html = "<pre " + marker + '="' + encodeURIComponent(serialized) +
    '">' + esc(payload.text) + '</pre>';
  for (const [type, value] of [[payload.cards ? CARD_MIME : ROW_MIME, serialized], ["text/html", html]]) {
    try {
      data.setData(type, value);
    } catch {
      // Each clipboard format is optional and independent of the others.
    }
  }
  return true;
}

export function hasCopiedRows() {
  return Boolean(state.clipboard?.rows);
}

export function copyClipboard(bundle, event) {
  const text = bundle.cards
    ? bundle.cards.map(inspectName).join("\n")
    : rowText(bundle.rows, bundle.characters, bundle.locations);
  const payload = { ...bundle, text };
  state.clipboard = payload;
  ownsClipboard = true;
  let written = false;
  if (event) written = writeClipboard(payload, event);
  else {
    // Run the same synchronous clipboard write from buttons and shortcuts.
    // Even if the OS declines it, the explicitly copied content remain available.
    const onCopy = (ev) => {
      ev.stopImmediatePropagation();
      written = writeClipboard(payload, ev);
    };
    document.addEventListener("copy", onCopy, true);
    try {
      document.execCommand("copy");
    } catch {
      // The async text API can still work if the WebView disables execCommand.
    } finally {
      document.removeEventListener("copy", onCopy, true);
    }
  }
  localOnlyPayload = written ? null : payload;
  if (!written) {
    navigator.clipboard?.writeText?.(payload.text).catch(() => {});
  }
  toast(payload.cards ? `已复制 ${payload.cards.length} 张卡片` : `已复制 ${payload.rows.length} 行`);
}

function clipboardTarget(target) {
  if (
    state.view.type !== "stage" || state.syncBusy || state.composition ||
    libraryVisible() || $("#modal-root").firstChild ||
    $(".update-overlay:not([hidden])") ||
    !(target === document.body || target.closest?.("#view"))
  ) return null;
  const editable = rowsAreEditable(target) &&
    !target.matches(".investigation-script-select,.investigation-stage-picker");
  if (editable && !target.matches('textarea[data-row-field="text"],textarea[data-branch-field="text"]'))
    return null;
  if (editable && target.selectionStart !== target.selectionEnd) return null;
  const element = target.closest("[data-branch-row],[data-row]");
  const id = element?.dataset.branchRow || element?.dataset.row;
  const ids = id && (editable || !state.selectedRowIds.has(id))
    ? new Set([id])
    : state.selectedRowIds;
  const canvas = currentStage()?.kind === "investigation" && !editable &&
    !target.closest(".investigation-writing,#selection-toolbar");
  return { ids, editable, id, canvas };
}

function copySource(target) {
  if (!target) return null;
  // Copying a row requires a row selection. A caret alone is ordinary editing.
  if (target.editable && !state.selectedRowIds.has(target.id)) return null;
  if (target.canvas && state.selectedInvestigationCardIds.size) {
    const cards = collectInvestigationCards();
    if (cards) return cards;
  }
  return state.selectedRowIds.size ? collectRows(state.selectedRowIds) : null;
}

export function handleClipboardShortcut(event, key) {
  const target = clipboardTarget(event.target);
  if (key === "c") {
    const bundle = copySource(target);
    if (bundle) {
      event.preventDefault();
      copyClipboard(bundle);
    } else forgetClipboard();
  } else if (canPaste(state.clipboard, target) && ownsClipboard) {
    if (localOnlyPayload) {
      // Neither the existence nor the contents of the system clipboard
      // prove what an editor-only copy contained.
      event.preventDefault();
      pastePayload(localOnlyPayload, target);
    } else {
      // Let the trusted native paste report the current clipboard first.
      // Some WebViews run no paste command at all on a focused row number.
      pendingPaste = {
        element: event.target, stage: currentStage(), rows: currentRows(),
        target: { ...target, ids: new Set(target.ids) },
      };
    }
  }
}

export function clearPasteGesture() {
  pendingPaste = null;
  pastedOnKeyUp = false;
}

export function finishPasteShortcut(event) {
  if (event.key.toLowerCase() !== "v" || !pendingPaste) return;
  const pending = pendingPaste;
  pendingPaste = null;
  if (document.activeElement !== pending.element || !clipboardTarget(pending.element) ||
      pending.stage !== currentStage() || pending.rows !== currentRows() || !ownsClipboard || !state.clipboard) return;
  pastedOnKeyUp = true;
  pastePayload(state.clipboard, pending.target);
}

export function handleCopy(event) {
  const bundle = copySource(clipboardTarget(event.target));
  if (bundle) copyClipboard(bundle, event);
  else forgetClipboard();
}

export function releaseClipboard() {
  clearPasteGesture();
  localOnlyPayload = null;
  ownsClipboard = false;
}

export function forgetClipboard() {
  releaseClipboard();
  state.clipboard = null;
}

export function handlePaste(event) {
  pendingPaste = null;
  if (pastedOnKeyUp) {
    // A late native event belongs to the gesture already handled on keyup.
    pastedOnKeyUp = false;
    event.preventDefault();
    return;
  }
  const target = clipboardTarget(event.target);
  if (!target) return;
  const data = event.clipboardData;
  let bundle = parsePayload(data?.getData(CARD_MIME)) || parsePayload(data?.getData(ROW_MIME));
  if (!bundle) {
    const marker = /<pre\s+data-xuxian-(?:clipboard|rows)="([^"]+)"/i.exec(data?.getData("text/html") || "");
    if (marker) {
      try {
        bundle = parsePayload(decodeURIComponent(marker[1]));
      } catch {
        // Other applications can place arbitrary HTML on the system clipboard.
      }
    }
  }
  if (!data?.types.length && ownsClipboard) bundle = state.clipboard;
  if (!bundle) {
    forgetClipboard();
    if (!target.editable) toast(target.canvas
      ? "请先复制调查卡片或脚本行"
      : "请先复制脚本行，普通文字可粘贴到输入框");
    return;
  }
  event.preventDefault();
  if (!canPaste(bundle, target)) {
    toast("请在调查画布上粘贴卡片");
    return;
  }
  if (pastePayload(bundle, target)) {
    state.clipboard = bundle;
    localOnlyPayload = null;
    ownsClipboard = true;
  }
}

function canPaste(bundle, target) {
  return Boolean(bundle && target && (!bundle.cards || target.canvas));
}

function pastePayload(bundle, target) {
  return bundle.cards ? pasteInvestigationCards(bundle) : pasteRows(bundle, target.ids);
}

function parsePayload(raw) {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (data?.format === "xuxian.investigation-cards.v1" && Array.isArray(data.cards))
      return data;
    return ["xuxian.rows.v1", "xuxian.rows.v2"].includes(data?.format) &&
      Array.isArray(data.rows)
      ? data
      : null;
  } catch {
    return null;
  }
}

