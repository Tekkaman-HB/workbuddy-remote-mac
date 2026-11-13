/**
 * [INPUT]: 依赖共享 state、消息渲染器和线性图标。
 * [OUTPUT]: 精简首页、侧栏、会话、统一下拉控件及连接状态的 DOM 更新。
 * [POS]: UI 的主要视图；操作由 controller.js 和 app.js 协调。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {
  state,
  $,
  escapeHTML as esc,
  visibleSessions,
  relativeDate,
  isRunning,
} from "./state.js";
import { icon } from "./icons.js";
import { blocks, messageActions } from "./render.js";
import { enter, reveal, dismiss } from "./motion.js";
export function taskRows(items) {
  return items
    .map(
      (item) =>
        `<div class="task-row ${state.session?.id === item.id ? "active" : ""}" data-session="${esc(item.id)}" tabindex="0" role="button" aria-label="${esc(item.title || "新任务")}">${isRunning(item.state) ? '<i class="running-dot"></i>' : item.unread ? '<i class="unread-dot"></i>' : ""}<span class="task-title">${esc(item.title || "新任务")}</span><time>${relativeDate(item.lastActivityAt ?? item.updatedAt)}</time><button class="task-menu" data-task-menu="${esc(item.id)}" aria-label="任务菜单">${icon("more")}</button></div>`,
    )
    .join("");
}
export function renderSidebar() {
  const catalogName = Object.entries({
    experts: "专家",
    skills: "技能",
    connectors: "连接器",
  })
    .filter(([key]) => state.features[key])
    .map(([, name]) => name)
    .join("·");
  const nav = [
    ["new", "新建任务", "new"],
    ["catalog", catalogName, "owl"],
    ["automations", "定时任务", "clock"],
  ];
  $("#navigation").innerHTML = nav
    .filter(
      ([action]) =>
        action === "new" ||
        (action === "catalog"
          ? ["experts", "skills", "connectors"].some(
              (key) => state.features[key],
            )
          : state.features.automations),
    )
    .map(
      ([action, name, i]) =>
        `<button data-action="${action}" class="${action === "new" && state.view === "home" ? "active" : ""}">${icon(i)}${name}</button>`,
    )
    .join("");
  const all = visibleSessions();
  const pinned = all.filter((x) => x.isPinned);
  const others = all.filter((x) => !x.isPinned);
  $("#tasks").innerHTML =
    (pinned.length
      ? `<div class="section-heading">置顶 (${pinned.length})</div>${taskRows(pinned)}`
      : "") +
    `<div class="section-heading">任务 (${others.length})${state.loading ? '<span class="spinner" role="status" aria-label="加载中"></span>' : ""}</div>` +
    taskRows(state.showAll ? others : others.slice(0, 5)) +
    (others.length > 5
      ? `<button class="show-all" data-action="showAll">${state.showAll ? "收起任务" : `查看更多 (${others.length - 5})`}</button>`
      : "") +
    (!all.length
      ? `<div class="empty">${state.connected ? "暂无任务" : "连接远端 Mac 后<br>查看本地任务"}</div>`
      : "");
  $("#spaces").innerHTML =
    `<div class="section-heading">空间 (${state.workspaces.length})</div>` +
    state.workspaces
      .map(
        (w, i) =>
          `<button class="space-row" data-workspace-view="${i}">${icon("folder")}<span>${esc(w.name ?? w.path?.split("/").pop() ?? "工作空间")}</span></button>`,
      )
      .join("");
  $("#profile-name").textContent =
    state.profile.nickname ??
    state.profile.displayName ??
    state.profile.name ??
    "WorkBuddy 用户";
  const name = $("#profile-name").textContent;
  const avatar = state.profile.avatarUrl ?? state.profile.avatar;
  $(".avatar").innerHTML =
    typeof avatar === "string" && /^https:\/\//.test(avatar)
      ? `<img src="${esc(avatar)}" alt="">`
      : esc(name.slice(0, 1));
  document.body.classList.toggle("connected", state.connected);
  $("#device-button").title = state.device
    ? `${state.device.displayName} · ${state.connected ? "已连接" : "未连接"}`
    : "连接远端 Mac";
}
export function updateTitle() {
  $("#conversation-title").textContent =
    state.view === "home" ? "" : state.session?.title || "新任务";
}
let previousView;
export function renderPage() {
  const home = state.view === "home";
  $("#home").hidden = !home;
  $("#chat").hidden = home;
  updateTitle();
  $(".title-actions")
    .querySelectorAll("button")
    .forEach((b, i) => {
      b.hidden = home || (i === 2 && !state.features.files);
    });
  (home ? $("#home-composer-slot") : $("#chat-composer-slot")).append(
    $("#composer-wrap"),
  );
  $("#prompt").placeholder = home
    ? "向远端 Mac 发送任务…"
    : "继续向远端 WorkBuddy 发送消息";
  if (previousView !== state.view)
    enter(home ? $("#home") : $("#chat"), { distance: 5 });
  previousView = state.view;
  updateComposer();
  renderSidebar();
}
export function updateComposer() {
  $("#model-button").hidden = !state.features.models;
  $("#workspace-button").hidden = !state.features.workspaces;
  $("#spaces").hidden = !state.features.workspaces;
  const fileButton = document.querySelector('[data-action="files"]');
  fileButton.hidden = state.view === "home" || !state.features.files;
  const selected = state.models.find(
    (m) => (m.id ?? m.model ?? m.key) === state.config.model,
  );
  $("#model-button").innerHTML =
    '<span class="control-label">' +
    esc(
      selected?.name ||
        selected?.displayName ||
        state.config.model ||
        (state.connected ? "远端默认模型" : "选择模型"),
    ) +
    "</span>" +
    icon("chevronDown", "dropdown-chevron");
  const full = state.config.permissionMode === "fullAccess";
  document.querySelectorAll(".permission").forEach((el) => {
    el.innerHTML =
      icon("shield") +
      '<span class="control-label">' +
      (full ? "允许完全访问" : "默认权限") +
      "</span>" +
      icon("chevronDown", "dropdown-chevron");
  });
  $("#workspace-button").innerHTML =
    icon("folder") +
    `<span class="control-label">${esc(state.workspace?.name ?? state.workspace?.path?.split("/").pop() ?? state.session?.space?.name ?? "选择工作空间")}</span>` +
    icon("chevronDown", "dropdown-chevron");
  const expert = state.config.expertId;
  $("#composer-tags").innerHTML =
    expert && state.features.experts
      ? `<button class="context-chip" data-action="expert">${icon("owl")}${esc(state.catalogs.experts?.find((x) => (x.id ?? x.expertId) === expert)?.name ?? expert)}</button>`
      : "";
  const running =
    state.sending ||
    isRunning(state.session?.state) ||
    isRunning(state.records.at(-1)?.state);
  $("#send-button").hidden = running;
  $("#stop-button").hidden = !running;
  $("#send-button").disabled =
    !state.connected || !$("#prompt").value.trim() || state.loading;
  $("#stop-button").disabled = !state.session;
}
const messageNodes = new Map();
export function resetHistory() {
  messageNodes.clear();
  $("#messages").replaceChildren();
}
function requestHTML(record) {
  return `${record.userMessage ? `<div class="user-message"><div class="user-bubble">${blocks(record.userMessage)}</div></div>` : ""}
    <div class="assistant-label"><span class="buddy-icon">${icon("owl")}</span>WorkBuddy ${isRunning(record.state) ? '<span class="spinner" role="status" aria-label="加载中"></span>' : ""}</div>
    <div class="assistant-message">${blocks(record.assistantMessage) || `<div class="reply-status">${isRunning(record.state) ? '<span class="spinner" role="status" aria-label="加载中"></span>正在处理…' : "暂无回复内容"}</div>`}</div>${messageActions(record)}`;
}
export function renderMessages(forceBottom = false) {
  const root = $("#messages"),
    scroll = $("#messages-scroll");
  const oldHeight = scroll.scrollHeight,
    oldTop = scroll.scrollTop;
  const nearBottom = oldHeight - scroll.clientHeight - oldTop < 100;
  let older = root.querySelector(".older");
  if (state.hasOlder && !older) {
    older = document.createElement("button");
    older.className = "older";
    older.dataset.action = "older";
    older.textContent = "加载更早的记录";
    root.prepend(older);
  }
  if (!state.hasOlder) older?.remove();
  root
    .querySelectorAll(
      ":scope > .empty,:scope > .reply-status,:scope > .loading-skeleton",
    )
    .forEach((el) => el.remove());
  if (!state.records.length) {
    root.insertAdjacentHTML(
      "beforeend",
      state.loading
        ? '<div class="reply-status"><span class="spinner" role="status" aria-label="加载中"></span>正在读取远端会话…</div><div class="loading-skeleton"></div><div class="loading-skeleton"></div>'
        : '<div class="empty">任务已就绪，发送消息开始对话</div>',
    );
  }
  const active = new Set();
  let previous = older;
  for (const record of state.records) {
    active.add(record.id);
    const signature = JSON.stringify([
      record.userMessage,
      record.assistantMessage,
      record.state,
      record.responseModel,
    ]);
    let entry = messageNodes.get(record.id);
    if (!entry) {
      const node = document.createElement("article");
      node.className = "request";
      node.dataset.request = record.id;
      if (messageNodes.size && record === state.records.at(-1))
        enter(node, { distance: 4, duration: 180 });
      entry = { node, signature: null };
      messageNodes.set(record.id, entry);
    }
    if (entry.signature !== signature) {
      const expanded = [...entry.node.querySelectorAll("details")].map(
        (d) => d.open,
      );
      entry.node.innerHTML = requestHTML(record);
      entry.node.querySelectorAll("details").forEach((d, i) => {
        d.open = expanded[i] ?? false;
      });
      entry.signature = signature;
    }
    const expected = previous ? previous.nextSibling : root.firstChild;
    if (expected !== entry.node) root.insertBefore(entry.node, expected);
    previous = entry.node;
  }
  for (const [id, entry] of messageNodes) {
    if (!active.has(id)) {
      entry.node.remove();
      messageNodes.delete(id);
    }
  }
  if (forceBottom || nearBottom) scroll.scrollTop = scroll.scrollHeight;
  else if (state.loadingOlder)
    scroll.scrollTop = oldTop + (scroll.scrollHeight - oldHeight);
  else scroll.scrollTop = oldTop;
  updateComposer();
}
export function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  reveal(el, { kind: "toast" });
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    dismiss(el, { kind: "toast" });
  }, 6000);
}
export function banner(text) {
  $("#connection-banner").textContent = text;
  $("#connection-banner").hidden = !text;
}
