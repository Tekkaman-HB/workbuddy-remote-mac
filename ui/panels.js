/**
 * [INPUT]: 依赖共享 state、受限 rpc、视图提示和图标。
 * [OUTPUT]: 设备/模型/权限菜单、目录、账户、设置和文件面板。
 * [POS]: UI 的次级交互，实际会话变更交给 app.js。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { state, $, native, rpc, listItems, escapeHTML as esc } from "./state.js";
import { icon } from "./icons.js";
import { toast, taskRows } from "./view.js";
import { reveal, dismiss, enter, layoutChange } from "./motion.js";
export const action = (type, data = {}) =>
  document.dispatchEvent(new CustomEvent("command", { detail: { type, ...data } }));
let anchorElement = null,
  previousFocus = null,
  modalGeneration = 0;
export function closePopover({ immediate = false, restoreFocus = true } = {}) {
  const p = $("#popover");
  const previous = anchorElement;
  dismiss(p, { immediate, onHidden: () => p.replaceChildren() });
  previous?.setAttribute("aria-expanded", "false");
  if (restoreFocus && previous?.isConnected) previous.focus({ preventScroll: true });
  anchorElement = null;
}
export function popover(anchor, html, width = 240) {
  if (anchorElement === anchor && !$("#popover").hidden) {
    closePopover();
    return;
  }
  closePopover({ immediate: true, restoreFocus: false });
  anchorElement = anchor;
  const p = $("#popover");
  p.style.width = width + "px";
  p.innerHTML = html;
  p.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const height = p.offsetHeight;
  p.style.left = Math.min(Math.max(10, rect.left), innerWidth - width - 10) + "px";
  const above = rect.bottom + height + 12 > innerHeight;
  p.dataset.placement = above ? "above" : "below";
  p.style.top = (above ? Math.max(10, rect.top - height - 8) : rect.bottom + 8) + "px";
  p.setAttribute("role", "dialog");
  p.setAttribute("aria-label", p.querySelector(".menu-title")?.textContent ?? "操作菜单");
  anchor.setAttribute("aria-expanded", "true");
  anchor.setAttribute("aria-controls", "popover");
  reveal(p);
  p.querySelectorAll('[data-danger="true"]').forEach((button) => button.classList.add("danger"));
  p.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
}
export function row(label, type, i = "", extra = "", attrs = "") {
  return `<button class="menu-row" data-command="${type}" ${attrs}>${i ? icon(i) : ""}<span class="name">${esc(label)}</span>${extra}</button>`;
}
export function closeModal({ immediate = false } = {}) {
  modalGeneration++;
  const el = $("#modal-layer");
  dismiss(el, { kind: "backdrop", immediate, onHidden: () => el.replaceChildren() });
  previousFocus?.focus({ preventScroll: true });
  previousFocus = null;
}
export function modal(html, cls = "dialog") {
  closePopover({ immediate: true, restoreFocus: false });
  const root = $("#modal-layer");
  const replacing = !root.hidden && !root.inert;
  if (!replacing) previousFocus = document.activeElement;
  root.innerHTML = `<section class="${cls}" role="dialog" aria-modal="true">${html}</section>`;
  reveal(root, { kind: "backdrop", immediate: replacing });
  enter(root.firstElementChild, { distance: 7, duration: 220 });
  root.querySelector("input,button,select,textarea")?.focus({ preventScroll: true });
  return ++modalGeneration;
}
export function confirmDialog(title, description, onConfirm, { initial, destructive = false } = {}) {
  modal(
    `<h2>${esc(title)}</h2><p>${esc(description)}</p>${initial !== undefined ? `<input id="dialog-input" aria-label="${esc(title)}" value="${esc(initial)}">` : ""}<div class="dialog-actions"><button class="button" id="dialog-cancel">取消</button><button class="button ${destructive ? "danger" : "primary"}" id="dialog-confirm">确定</button></div>`,
  );
  $("#dialog-cancel").onclick = () => closeModal();
  $("#dialog-confirm").onclick = () => {
    const value = $("#dialog-input")?.value;
    closeModal();
    onConfirm(value);
  };
  $("#dialog-input")?.select();
  $("#dialog-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#dialog-confirm").click();
  });
}
export function deviceMenu(anchor) {
  const content =
    `<div class="menu-title">设备连接 · 任务在所选 Mac 上执行</div>` +
    (state.devices.length
      ? state.devices
          .map(
            (d) =>
              `<button class="device-card ${d.deviceId === state.device?.deviceId ? "selected" : ""}" data-connect="${esc(d.deviceId)}">${icon("device")}<span><strong>${esc(d.displayName ?? "未命名电脑")}</strong><small class="${d.onlineFlag ? "online" : ""}">${d.onlineFlag ? "在线" : "离线"}${d.deviceId === state.device?.deviceId && state.connected ? " · 已连接" : ""}${d.remoteViewFlag !== 1 ? " · 未启用远程连接" : ""}</small></span>${d.deviceId === state.device?.deviceId && state.connected ? icon("check", "check") : ""}</button>`,
          )
          .join("")
      : '<div class="empty">登录后读取你的 Mac 设备</div>') +
    '<div class="menu-separator"></div>' +
    row("刷新设备", "refreshDevices", "refresh") +
    row("使用 WorkBuddy 账号登录", "login", "device");
  popover(anchor, content, 330);
}
export function modelMenu(anchor) {
  popover(
    anchor,
    `<div class="menu-title">选择模型 · 来自远端 Mac</div>` +
      (state.models.length
        ? state.models
            .map((m, i) => {
              const id = m.id ?? m.model ?? m.key;
              return row(
                m.name ?? m.displayName ?? id,
                "chooseModel",
                "spark",
                id === state.config.model ? icon("check", "check") : "",
                `data-index="${i}"`,
              );
            })
            .join("")
        : '<div class="menu-note">模型列表尚未加载，请重新连接设备。</div>'),
    340,
  );
}
export function plusMenu(anchor) {
  popover(
    anchor,
    row("模式", "mode", "code", icon("chevron")) +
      (state.features.experts ? row("专家", "expert", "owl", icon("chevron")) : "") +
      (state.features.skills ? row("查看技能", "skills", "spark", icon("chevron")) : "") +
      (state.features.connectors ? row("查看连接器", "connectors", "plug", icon("chevron")) : ""),
    200,
  );
}
export function permissionMenu(anchor) {
  popover(
    anchor,
    '<div class="menu-title">当前任务权限</div>' +
      row(
        "默认权限",
        "permissionStandard",
        "shield",
        state.config.permissionMode !== "fullAccess" ? icon("check", "check") : "",
      ) +
      row(
        "允许完全访问",
        "permissionFull",
        "shield",
        state.config.permissionMode === "fullAccess" ? icon("check", "check") : "",
      ) +
      '<div class="menu-note">权限应用于当前任务，远端 Mac 执行操作前遵循此设置。</div>',
    270,
  );
}
export function workspaceMenu(anchor) {
  popover(
    anchor,
    '<div class="menu-title">远端工作空间</div>' +
      row("默认工作空间", "chooseWorkspace", "folder", "", 'data-index="-1"') +
      state.workspaces
        .map((w, i) =>
          row(
            w.name ?? w.path,
            "chooseWorkspace",
            "folder",
            state.workspace === w ? icon("check", "check") : "",
            `data-index="${i}"`,
          ),
        )
        .join("") +
      '<div class="menu-note">工作空间在创建任务时确定。</div>',
    320,
  );
}
export function accountMenu(anchor) {
  const name = state.profile.nickname ?? state.profile.displayName ?? state.profile.name ?? "WorkBuddy 用户";
  popover(
    anchor,
    `<div class="profile-card"><span class="avatar">${esc(name[0])}</span><div><strong>${esc(name)}</strong><small>${esc(state.device?.displayName ?? "尚未连接远端 Mac")}</small></div></div><div class="menu-separator"></div>` +
      row("设置", "settings", "settings", "<small>⌘,</small>") +
      row("外观", "appearance", "sun") +
      row("设备连接", "deviceSettings", "device") +
      '<div class="menu-separator"></div>' +
      row("关于 WorkBuddy Remote", "about", "owl") +
      row("退出登录", "logout", "logout"),
    300,
  );
}
export function taskMenu(anchor, id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return;
  popover(
    anchor,
    row("重命名", "rename", "edit", "", `data-session-id="${esc(id)}"`) +
      row(s.isPinned ? "取消置顶" : "置顶", "pin", "pin", "", `data-session-id="${esc(id)}"`) +
      row("归档", "archive", "archive", "", `data-session-id="${esc(id)}"`) +
      `<div class="menu-separator"></div>` +
      row("删除", "delete", "trash", "", `data-session-id="${esc(id)}" data-danger="true"`),
    200,
  );
}
export function searchDialog() {
  modal(
    `<div class="search-box">${icon("search")}<input id="search-input" aria-label="搜索任务" placeholder="搜索任务" autocomplete="off"><button data-command="closeModal" aria-label="关闭搜索">${icon("close")}</button></div><div class="search-results"></div><div class="search-hint">搜索所连接设备的任务标题 · ↑ ↓ 选择 · Enter 打开 · Esc 关闭</div>`,
    "dialog search-dialog",
  );
  const render = () => {
    const query = $("#search-input").value.toLowerCase();
    $(".search-results").innerHTML =
      taskRows(
        state.sessions.filter((x) =>
          String(x.title ?? "")
            .toLowerCase()
            .includes(query),
        ),
      ) || '<div class="empty">没有匹配的任务</div>';
  };
  $("#search-input").oninput = render;
  render();
}
export async function catalog(tab = "experts") {
  const labels = Object.fromEntries(
    Object.entries({ experts: "专家", skills: "技能", connectors: "连接器" }).filter(([key]) => state.features[key]),
  );
  if (!labels[tab]) tab = Object.keys(labels)[0];
  if (!tab) return;
  const gen = modal(
    `<button class="dialog-close" data-command="closeModal" aria-label="关闭">${icon("close")}</button><h2>远端目录</h2><div class="catalog-tabs">${Object.entries(
      labels,
    )
      .map(([k, v]) => `<button data-catalog-tab="${k}" class="${tab === k ? "active" : ""}">${v}</button>`)
      .join(
        "",
      )}</div><div class="catalog-grid"><div class="empty"><span class="spinner" role="status" aria-label="加载中"></span> 正在读取远端${labels[tab]}…</div></div>`,
    "dialog catalog-dialog",
  );
  try {
    const method = { experts: "wb:experts:list", skills: "wb:skills:installed", connectors: "wb:connectors:list" }[tab];
    const items = listItems(await rpc(method, ...(tab === "skills" ? [{}] : [])));
    state.catalogs[tab] = items;
    if (gen !== modalGeneration) return;
    $(".catalog-grid").innerHTML =
      items
        .map((item, index) => {
          const selectable = tab === "experts" && Boolean(item.id ?? item.expertId);
          const tag = selectable ? "button" : "article";
          const attrs = selectable ? `data-catalog-item="${index}" data-catalog-type="experts"` : "";
          const metadata = [item.version, item.status ?? item.state]
            .filter((value) => typeof value === "string")
            .join(" · ");
          return `<${tag} class="catalog-card" ${attrs}>
        ${/^https:|^data:image\//.test(item.icon ?? "") ? `<img class="catalog-icon" src="${esc(item.icon)}" alt="">` : icon({ experts: "owl", skills: "spark", connectors: "plug" }[tab])}
        <strong>${esc(item.name ?? item.displayName ?? item.title ?? item.id ?? "未命名")}</strong>
        ${item.description || item.summary ? `<p>${esc(item.description ?? item.summary)}</p>` : ""}
        <small>${selectable ? "选择专家" : esc(metadata || "只读")}</small></${tag}>`;
        })
        .join("") || `<div class="empty">远端暂无${labels[tab]}</div>`;
  } catch (e) {
    if (gen === modalGeneration) $(".catalog-grid").innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}
function settingsSections() {
  return {
    客户端: ["通用", "外观", "快捷键"],
    远端: [...(state.features.models ? ["模型"] : []), "设备连接"],
  };
}
export function settings(section = "通用") {
  const sections = settingsSections();
  if (!Object.values(sections).flat().includes(section)) section = "通用";
  const reuse = !$("#modal-layer").hidden && !$("#modal-layer").inert && Boolean(document.querySelector(".settings"));
  if (reuse) {
    document.querySelector(".settings-body h2").textContent = section;
    document
      .querySelectorAll("[data-settings-section]")
      .forEach((button) => button.classList.toggle("selected", button.dataset.settingsSection === section));
  } else {
    modal(
      `<aside class="settings-nav"><input id="settings-search" aria-label="搜索设置项" placeholder="搜索设置项">${Object.entries(
        sections,
      )
        .map(
          ([g, items]) =>
            `<div class="menu-title">${g}</div>${items.map((x) => `<button class="menu-row ${section === x ? "selected" : ""}" data-settings-section="${x}">${x}</button>`).join("")}`,
        )
        .join(
          "",
        )}</aside><div class="settings-body"><button class="dialog-close" data-command="closeModal" aria-label="关闭设置">${icon("close")}</button><h2>${section}</h2><div id="settings-content"></div></div>`,
      "dialog settings",
    );
  }
  $("#settings-search").oninput = () => {
    const q = $("#settings-search").value;
    document.querySelectorAll("[data-settings-section]").forEach((b) => (b.hidden = !b.textContent.includes(q)));
  };
  const card = (html) => `<div class="setting-card">${html}</div>`;
  const setting = (title, description, control = "") =>
    `<div class="setting-row"><div><label>${title}</label><small>${description}</small></div>${control}</div>`;
  let html = "";
  if (section === "外观")
    html = card(
      setting(
        "主题",
        "选择当前客户端的界面外观",
        `<select id="theme-select" aria-label="主题"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select>`,
      ) +
        setting(
          "字体大小",
          "调整消息正文的显示大小",
          `<input id="font-size" type="range" min="13" max="20" step="1" aria-label="字体大小" value="${localStorage.getItem("fontSize") ?? 16}">`,
        ),
    );
  else if (section === "设备连接")
    html = card(
      setting(
        "当前设备",
        esc(state.device?.displayName ?? "未连接"),
        '<button class="button" data-command="deviceSettings">选择设备</button>',
      ) +
        setting("执行位置", "任务和文件保留在远端 Mac；客户端通过账号通道连接。") +
        setting("远程访问", "目标 Mac 需在 WorkBuddy 中开启“允许移动端连接此设备”。"),
    );
  else if (section === "快捷键")
    html = card(
      [
        ["搜索任务", "⌘ K"],
        ["新建任务", "⌘ N"],
        ["发送消息", "Enter / ⌘ Enter"],
        ["输入换行", "Shift Enter"],
        ["设置", "⌘ ,"],
        ["关闭菜单或面板", "Esc"],
      ]
        .map(([a, b]) => setting(a, "", `<span class="key">${b}</span>`))
        .join(""),
    );
  else if (section === "模型")
    html = card(
      setting(
        "会话模型",
        esc(state.config.model || "使用远端默认模型"),
        '<button class="button" data-command="settingsModels">选择模型</button>',
      ) + setting("模型配置", "选择当前远端任务使用的模型。"),
    );
  else if (section === "通用")
    html = card(
      setting("WorkBuddy Remote", "独立账号登录 · 本地任务远程接入 · 0.2.2") +
        setting(
          "连接状态",
          state.connected ? "已连接 " + esc(state.device?.displayName) : "尚未连接",
          '<button class="button" data-command="deviceSettings">设备连接</button>',
        ) +
        setting("消息显示", "支持 Markdown、表格、代码、图片和工具折叠内容。") +
        setting("刷新方式", "会话历史每 2 秒读取一次，任务列表每 30 秒刷新。"),
    );
  $("#settings-content").innerHTML = html;
  if (reuse) enter($("#settings-content"), { distance: 4, duration: 180 });
  if ($("#theme-select")) {
    const select = $("#theme-select");
    select.value = localStorage.getItem("theme") ?? "system";
    select.onchange = () => {
      localStorage.setItem("theme", select.value);
      applyAppearance();
    };
    $("#font-size").oninput = (e) => {
      localStorage.setItem("fontSize", e.target.value);
      applyAppearance();
    };
  }
}
export function applyAppearance() {
  const theme = localStorage.getItem("theme") ?? "system";
  document.documentElement.dataset.theme =
    theme === "system" ? (matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light") : theme;
  document.documentElement.style.setProperty("--font-size", (localStorage.getItem("fontSize") ?? 16) + "px");
}
export async function files() {
  state.panel = !state.panel;
  const p = $("#file-panel");
  document.querySelector('[data-action="files"]')?.setAttribute("aria-expanded", String(state.panel));
  if (!state.panel) {
    dismiss(p, { kind: "drawer" });
    return;
  }
  layoutChange(() => reveal(p, { kind: "drawer" }));
  p.innerHTML = `<header><strong>任务文件</strong><button data-command="files" aria-label="关闭文件面板">${icon("close")}</button></header><div id="file-list" class="empty">${state.session ? '<span class="spinner" role="status" aria-label="加载中"></span> 读取远端文件…' : "选择任务后查看产出文件"}</div>`;
  if (!state.session) return;
  const id = state.session.id;
  try {
    const result = await rpc("wb:artifacts:list", { conversationId: id });
    if (state.session?.id !== id || !state.panel) return;
    const items = listItems(result);
    state.artifacts = items;
    $("#file-list").className = "";
    $("#file-list").innerHTML =
      items
        .map(
          (f, i) =>
            `<button class="file-row" data-file="${i}">${icon("file")}<span>${esc(f.title ?? f.name ?? "文件")}<small>${esc(f.mimeType ?? f.contentType ?? "")}</small></span></button>`,
        )
        .join("") || '<div class="empty">此任务暂无产出文件</div>';
  } catch (e) {
    if (state.session?.id === id && state.panel) $("#file-list").innerHTML = esc(e.message);
  }
}
export async function fileDetail(index) {
  const item = state.artifacts?.[index];
  if (!item) return;
  const gen = modal(
    `<button class="dialog-close" data-command="closeModal" aria-label="关闭">${icon("close")}</button><h2>${esc(item.title ?? item.name ?? "文件详情")}</h2><div class="file-detail">正在读取…</div>`,
    "dialog catalog-dialog",
  );
  try {
    const detail = await rpc("wb:artifacts:get", { artifactId: item.id ?? item.artifactId });
    if (gen !== modalGeneration) return;
    const text = detail?.content ?? detail?.text ?? detail?.description;
    $(".file-detail").textContent =
      typeof text === "string"
        ? text
        : [
            detail?.title ?? detail?.name ?? item.title,
            detail?.mimeType ?? detail?.contentType,
            typeof detail?.size === "number" ? `${detail.size.toLocaleString()} 字节` : "",
          ]
            .filter(Boolean)
            .join("\n");
  } catch (e) {
    if (gen === modalGeneration) $(".file-detail").textContent = e.message;
  }
}
export async function automations() {
  const gen = modal(
    `<button class="dialog-close" data-command="closeModal" aria-label="关闭">${icon("close")}</button><h2>定时任务</h2><div class="menu-note">远端 Mac 的定时任务 · 只读</div><div id="automation-list" class="empty"><span class="spinner" role="status" aria-label="加载中"></span> 正在读取…</div>`,
    "dialog catalog-dialog",
  );
  try {
    const items = listItems(await rpc("wb:automations:list", {}));
    if (gen !== modalGeneration) return;
    $("#automation-list").innerHTML =
      items
        .map(
          (a) =>
            `<div class="setting-card"><strong>${esc(a.name ?? a.title ?? "定时任务")}</strong><p>${esc(a.description ?? a.prompt ?? "")}</p><small>${esc(a.status ?? "")}</small></div>`,
        )
        .join("") || "远端暂无定时任务";
  } catch (e) {
    if (gen === modalGeneration) $("#automation-list").textContent = e.message;
  }
}
