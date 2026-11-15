import { $, esc, ico } from "./context.js";

/** Touch menus use a single sheet with a back stack, never cascading side popups. */
export function showTouchMenu(anchor, items, close) {
  const root = $("#menu-root");
  const stack = [{ title: "操作", items }];
  const restore = document.activeElement;
  const scrim = document.createElement("div");
  scrim.className = "touch-menu-scrim";
  scrim.onclick = close;
  root.append(scrim);
  const sheet = document.createElement("section");
  sheet.className = "menu touch-menu-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  root.append(sheet);
  function paint() {
    const current = stack.at(-1);
    sheet.setAttribute("aria-label", current.title);
    sheet.innerHTML = `<div class="touch-menu-head">${stack.length > 1 ? `<button aria-label="返回上一级操作" class="icon-btn" data-sheet-back>${ico("back")}</button>` : ""}<h2>${esc(current.title)}</h2><button class="icon-btn" aria-label="关闭操作菜单" data-sheet-close>${ico("close")}</button></div><div class="touch-menu-list" role="menu"></div>`;
    sheet.querySelector("[data-sheet-back]")?.addEventListener("click", back);
    sheet.querySelector("[data-sheet-close]").onclick = close;
    const list = sheet.querySelector(".touch-menu-list");
    for (const item of current.items) {
      if (!item) {
        const separator = document.createElement("div");
        separator.className = "menu-sep";
        list.append(separator);
        continue;
      }
      const button = document.createElement("button");
      button.className = "menu-item" + (item.danger ? " danger" : "");
      button.disabled = !!item.disabled;
      button.setAttribute("role", "menuitem");
      button.setAttribute("aria-label", item.label);
      button.innerHTML =
        (item.icon ? ico(item.icon) : "") +
        `<span>${esc(item.label)}</span>` +
        (item.children ? ico("next") : "");
      button.onclick = (event) => {
        event.stopPropagation();
        if (item.children) {
          stack.push({ title: item.label, items: item.children });
          paint();
        } else {
          close();
          item.click?.();
        }
      };
      list.append(button);
    }
    sheet
      .querySelector(".menu-item:not(:disabled)")
      ?.focus({ preventScroll: true });
  }
  function back() {
    if (stack.length > 1) {
      stack.pop();
      paint();
    } else close();
  }
  root.touchMenuBack = back;
  root.touchMenuCleanup = () => {
    if (restore?.isConnected && restore.matches("button"))
      restore.focus({ preventScroll: true });
  };
  sheet.onkeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      back();
    }
    if (event.key === "Tab") {
      const buttons = [...sheet.querySelectorAll("button:not(:disabled)")];
      const at = buttons.indexOf(document.activeElement);
      if (
        (!event.shiftKey && at === buttons.length - 1) ||
        (event.shiftKey && at === 0)
      ) {
        event.preventDefault();
        event.stopPropagation();
        buttons[event.shiftKey ? buttons.length - 1 : 0]?.focus();
      }
    }
  };
  paint();
}
