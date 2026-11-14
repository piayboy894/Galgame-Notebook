import { isDesktop } from "../platform/desktop";
import {
  branchRowCount,
  flattenRows,
  stageRootRows,
} from "../domain/project.js";

/** Mutable editor session. Filesystem access lives behind the platform adapter. */
export const state = {
  activeInspectObjectId: null,
  project: undefined,
  fileHandle: null,
  fileStamp: null,
  sourceName: "",
  dirty: true,
  exported: false,
  cacheOK: true,
  bridgeBinding: null,
  view: { type: "board", chapterId: null, stageId: null },
  zoom: 1,
  boardScroll: { x: 0, y: 0 },
  connectFrom: null,
  history: [],
  future: [],
  lastEdit: "",
  lastEditAt: 0,
  cacheTimer: null,
  toastTimer: null,
  saving: false,
  composition: false,
  sim: {
    active: false,
    chapters: new Set(),
    stages: new Set(),
    flags: new Set(),
  },
  previousFocus: null,
  modalClose: null,
  suppressUnload: false,
  renderedKey: "",
  skipBoardCapture: false,
  selectedRowIds: new Set(),
  selectionAnchor: null,
  rowClipboard: null,
  edgeFrame: 0,
  collapsedOptionIds: new Set(),
  dragSuppressUntil: 0,
  libraryItems: [],
  libraryBusy: false,
  restoredDraft: false,
  dragDepth: 0,
};

export const STORAGE = "xuxian.draft.v1",
  BACKUPS = "xuxian.backups.v1";

export const ICONS = {
  logo: '<path d="M4 4v5a3 3 0 0 0 3 3h10a3 3 0 0 1 3 3v5M4 20v-5a3 3 0 0 1 3-3h10a3 3 0 0 0 3-3V4"/><circle cx="4" cy="3" r="1.5"/><circle cx="20" cy="3" r="1.5"/><circle cx="4" cy="21" r="1.5"/><circle cx="20" cy="21" r="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  back: '<path d="m14 6-6 6 6 6"/>',
  next: '<path d="m9 6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  users:
    '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2"/>',
  map: '<rect x="3" y="3" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><path d="M6 8v8M6 12h12v4"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  link: '<path d="m9 15 6-6M7 13l-2 2a4 4 0 0 0 6 6l2-2M11 5l2-2a4 4 0 0 1 6 6l-2 2"/>',
  flag: '<path d="M5 22V3h13l-2 4 2 4H5"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
  undo: '<path d="m8 4-5 5 5 5M3 9h11a7 7 0 0 1 0 14"/>',
  redo: '<path d="m16 4 5 5-5 5M21 9H10a7 7 0 0 0 0 14"/>',
  file: '<path d="M14 2H5v20h14V7ZM14 2v5h5M8 12h8M8 16h6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  save: '<path d="M4 3h14l3 3v15H3V3h1ZM7 3v6h10V3M7 21v-8h10v8"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="3" fill="currentColor" stroke="none"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8a2.5 2.5 0 1 1 4 2c-1 .5-1.5 1-1.5 3M12 17h.01"/>',
  fit: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6Z M13 6l5 5"/>',
  up: '<path d="m6 14 6-6 6 6"/>',
  down: '<path d="m6 10 6 6 6-6"/>',
  note: '<path d="M5 3h14v18H5ZM8 8h8M8 12h8M8 16h5"/>',
  branch:
    '<path d="M5 3v11a5 5 0 0 0 5 5h7M5 10h8a5 5 0 0 0 5-5V3M14 16l3 3-3 3"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 3v7h7"/>',
  grip: '<path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" stroke-width="3"/>',
  audit: '<path d="M12 3 2 21h20Z M12 9v5M12 17h.01"/>',
  folder: '<path d="M3 6V4h7l2 3h9v13H3Z"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8ZM2 12l10 5 10-5M2 16l10 5 10-5"/>',
};

export const ico = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.note}</svg>`;

export const $ = (sel, root = document) => root.querySelector(sel),
  $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export const attr = esc;

export const btn = (label, icon, action, cls = "", title = "") =>
  `<button class="btn ${cls}" data-act="${action}" title="${attr(title || label)}">${icon ? ico(icon) : ""}${esc(label)}</button>`;

export const ib = (icon, action, title, extra = "") =>
  `<button class="icon-btn" data-act="${action}" title="${attr(title)}" aria-label="${attr(title)}" ${extra}>${ico(icon)}</button>`;

export const option = (v, label, current) =>
  `<option value="${attr(v)}"${v === current ? " selected" : ""}>${esc(label)}</option>`;

export const BRIDGE = isDesktop ? "desktop" : "";

export const HANDLE_DB = "xuxian-sources-v1";

export const ROW_MIME = "application/x-xuxian-rows+json";

export const C = (id) => state.project.chapters.find((c) => c.id === id),
  R = (id) => state.project.routes.find((r) => r.id === id),
  P = (id) => state.project.characters.find((c) => c.id === id),
  F = (id) => state.project.flags.find((f) => f.id === id);

export const S = (id) => {
  for (const c of state.project.chapters) {
    const s = c.stages.find((s) => s.id === id);
    if (s) return { chapter: c, stage: s };
  }
  return null;
};

export const currentChapter = () => C(state.view.chapterId),
  currentStage = () =>
    currentChapter()?.stages.find((s) => s.id === state.view.stageId);

export const linesOf = (c) =>
    c.stages.reduce((n, s) => n + branchRowCount(s), 0),
  textCount = (s) =>
    flattenRows(stageRootRows(s)).reduce(
      (n, r) =>
        n +
        (r.text || "").replace(/\s/g, "").length +
        (r.type === "branch"
          ? r.options.reduce(
              (a, o) => a + (o.text || "").replace(/\s/g, "").length,
              0,
            )
          : 0),
      0,
    );

export const routeChapters = (id) =>
  state.project.chapters
    .filter((c) => c.routeId === id)
    .sort((a, b) => a.y - b.y);

export const libraryVisible = () =>
  !$("#project-library").classList.contains("hidden");
