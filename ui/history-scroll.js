/**
 * [INPUT]: 共享分页状态、真实历史 DOM 与控制器的只读加载回调。
 * [OUTPUT]: 顶部自动加载/上滑重试、状态提示及前插记录后的阅读锚点恢复。
 * [POS]: 普通会话与自动化历史共用的滚动分页交互，不持有远端接口。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { state, $ } from "./state.js";

export function renderHistoryEdge() {
  const root = $("#messages");
  let edge = root.querySelector(":scope > .history-edge");
  if (!edge) {
    edge = document.createElement("div");
    edge.className = "history-edge";
    edge.setAttribute("role", "status");
    edge.setAttribute("aria-live", "polite");
    root.prepend(edge);
  }
  const text = state.loadingOlder ? "正在加载更早的记录…"
    : state.olderError ? "加载失败，继续向上滚动重试"
    : state.hasOlder ? "向上滚动加载更早记录"
    : state.records.length && !state.loading ? "已到最早记录" : "";
  edge.hidden = !text;
  edge.textContent = text;
  if (state.loadingOlder) {
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    spinner.setAttribute("aria-hidden", "true");
    edge.prepend(spinner);
  }
  return edge;
}

const rows = () => [...$("#messages").querySelectorAll(":scope > [data-request],:scope > [data-automation-record]")];
const key = row => row.dataset.request ?? row.dataset.automationRecord;
export function captureHistoryPosition() {
  const scroll = $("#messages-scroll"), viewport = scroll.getBoundingClientRect();
  const anchor = rows().find(row => {
    const rect = row.getBoundingClientRect();
    return rect.bottom > viewport.top && rect.top < viewport.bottom;
  });
  return { top: scroll.scrollTop, height: scroll.scrollHeight,
    nearBottom: scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 100,
    anchor: anchor && key(anchor), offset: anchor && anchor.getBoundingClientRect().top - viewport.top };
}
export function restoreHistoryPosition(position, forceBottom = false) {
  const scroll = $("#messages-scroll");
  if (state.loadingOlder) {
    const anchor = position.anchor && rows().find(row => key(row) === position.anchor);
    if (anchor) scroll.scrollTop += anchor.getBoundingClientRect().top - scroll.getBoundingClientRect().top - position.offset;
    else scroll.scrollTop = position.top + scroll.scrollHeight - position.height;
  } else if (forceBottom || position.nearBottom) scroll.scrollTop = scroll.scrollHeight;
  else scroll.scrollTop = position.top;
}

export function installHistoryScroll(loadOlder) {
  const scroll = $("#messages-scroll");
  const request = () => {
    if (scroll.scrollTop <= 32 && state.hasOlder && !state.loading && !state.loadingOlder) void loadOlder();
  };
  scroll.addEventListener("scroll", () => { if (!state.olderError) request(); });
  // 到顶后再次上滑不会改变 scrollTop；仍允许用户重试失败页或加载不足一屏的历史。
  scroll.addEventListener("wheel", event => { if (event.deltaY < 0) request(); }, {passive: true});
}
