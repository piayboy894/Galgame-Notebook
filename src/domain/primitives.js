export const FORMAT = "xuxian.story";
export const PALETTE = [
  "#79929d",
  "#9b8da8",
  "#809b8e",
  "#b39b7d",
  "#a18d8d",
  "#7f99a8",
  "#969d7d",
  "#909598",
];
export const uid = (p = "id") =>
  p +
  "_" +
  (globalThis.crypto?.randomUUID?.() ||
    Date.now().toString(36) + Math.random().toString(36).slice(2));
export const now = () => new Date().toISOString();
export const clone = (x) => JSON.parse(JSON.stringify(x));
export const safeColor = (c) =>
  /^#[0-9a-f]{6}$/i.test(c || "") ? c : PALETTE[0];
