/**
 * [INPUT]: 依赖原生桥、共享状态、主视图及次级面板。
 * [OUTPUT]: 页面初始化、菜单动作和鼠标/键盘交互。
 * [POS]: UI 入口，将用户动作路由到 controller 和 panels。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { state, $, native, textOf, escapeHTML as esc } from "./state.js";
import { paintIcons, icon } from "./icons.js";
import {
  renderPage,
  renderSidebar,
  renderMessages,
  resetHistory,
  updateComposer,
  toast,
  banner,
} from "./view.js";
import * as panels from "./panels.js";
import { toggleSidebar } from "./motion.js";
import {
  safe,
  requireConnection,
  discover,
  connect,
  loadSessions,
  setDraft,
  resizeInput,
  newTask,
  openSession,
  loadHistory,
  config,
  send,
  stop,
  taskAction,
  poll,
} from "./controller.js";

function information(title, description) {
  panels.modal(
    `<button class="dialog-close" data-command="closeModal" aria-label="关闭">${icon("close")}</button><h2>${esc(title)}</h2><p>${esc(description)}</p><div class="dialog-actions"><button class="button primary" data-command="closeModal">知道了</button></div>`,
  );
}
async function command(type, data = {}, anchor) {
  switch (type) {
    case "new":
      newTask();
      break;
    case "devices":
      panels.deviceMenu(anchor ?? $("#device-button"));
      break;
    case "refreshDevices":
      await discover();
      panels.deviceMenu($("#device-button"));
      break;
    case "login":
      await native("login");
      panels.closePopover();
      break;
    case "search":
      panels.searchDialog();
      break;
    case "collapse":
      toggleSidebar();
      break;
    case "showAll":
      state.showAll = !state.showAll;
      renderSidebar();
      break;
    case "filter":
      panels.popover(
        anchor,
        rowFilter("全部任务", "all") +
          rowFilter("置顶任务", "pinned") +
          rowFilter("进行中", "running"),
        200,
      );
      break;
    case "setFilter":
      state.filter = data.value;
      panels.closePopover();
      renderSidebar();
      break;
    case "models":
      panels.modelMenu(anchor ?? $("#model-button"));
      break;
    case "chooseModel": {
      const model = state.models[Number(data.index)];
      if (model) await config("model", model.id ?? model.model ?? model.key);
      break;
    }
    case "plus":
      panels.plusMenu(anchor);
      break;
    case "permission":
      panels.permissionMenu(anchor);
      break;
    case "permissionStandard":
      await config("permissionMode", "bypassPermissions");
      break;
    case "permissionFull":
      panels.closePopover();
      if (state.config.permissionMode === "fullAccess") break;
      panels.confirmDialog(
        "允许完全访问",
        "此任务可以在远端 Mac 上使用更广泛的文件和命令权限。仅对当前任务生效。",
        () => safe(() => config("permissionMode", "fullAccess")),
      );
      break;
    case "workspaces":
      if (state.session) {
        toast("当前任务的工作空间在创建时已确定");
        break;
      }
      panels.workspaceMenu(anchor);
      break;
    case "chooseWorkspace":
      state.workspace = state.workspaces[Number(data.index)] ?? null;
      updateComposer();
      panels.closePopover();
      break;
    case "mode":
      panels.popover(
        anchor ?? $("#model-button"),
        panels.row("工作模式", "chooseMode", "code", "", 'data-value="craft"') +
          panels.row(
            "计划模式",
            "chooseMode",
            "file",
            "",
            'data-value="plan"',
          ) +
          panels.row("问答模式", "chooseMode", "book", "", 'data-value="ask"'),
        220,
      );
      break;
    case "chooseMode":
      await config("mode", data.value);
      break;
    case "catalog":
    case "expert":
      await panels.catalog("experts");
      break;
    case "skills":
    case "connectors":
      await panels.catalog(type);
      break;
    case "catalogItem": {
      const item = state.catalogs[data.catalogType]?.[Number(data.index)];
      if (!item) break;
      if (data.catalogType === "experts") {
        await config("expertId", item.id ?? item.expertId);
        panels.closeModal();
        toast("已选择专家：" + (item.name ?? item.id));
      }
      break;
    }
    case "account":
      panels.accountMenu(anchor);
      break;
    case "settings":
      panels.settings();
      break;
    case "appearance":
      panels.settings("外观");
      break;
    case "settingsModels":
      panels.closeModal();
      panels.modelMenu($("#model-button"));
      break;
    case "deviceSettings":
      panels.closeModal();
      panels.deviceMenu($("#device-button"));
      break;
    case "about":
      information(
        "WorkBuddy Remote",
        "0.2.2 · Mac 本地任务远程客户端。界面对照本机 WorkBuddy 5.9.3 实现；任务在所连接的 Mac 上执行，控制端不需要安装 WorkBuddy。",
      );
      break;
    case "logout":
      panels.confirmDialog(
        "退出登录",
        "清除此 App 的登录状态。远端设备及任务保留。",
        () =>
          safe(async () => {
            ++state.epoch;
            ++state.historyEpoch;
            await native("logout");
            Object.assign(state, {
              connected: false,
              device: null,
              devices: [],
              sessions: [],
              models: [],
              workspaces: [],
              profile: {},
              features: {},
              catalogs: {},
              draftConfig: {},
              config: {},
              records: [],
              session: null,
              sending: false,
              connecting: false,
              loading: false,
              view: "home",
            });
            setDraft("");
            resetHistory();
            renderPage();
            banner("请登录 WorkBuddy 账号");
          }),
      );
      break;
    case "files":
      await panels.files();
      break;
    case "send":
      await send();
      break;
    case "stop":
      await stop();
      break;
    case "older":
      await loadHistory(true, true);
      break;
    case "scrollBottom":
      $("#messages-scroll").scrollTop = $("#messages-scroll").scrollHeight;
      break;
    case "copyConversation":
      await native("copy", {
        text: state.records
          .map(
            (r) =>
              "你：\n" +
              textOf(r.userMessage) +
              "\n\nWorkBuddy：\n" +
              textOf(r.assistantMessage),
          )
          .join("\n\n"),
      });
      toast("已复制会话内容");
      break;
    case "rename":
    case "pin":
    case "archive":
    case "delete":
      await taskAction(type, data.sessionId);
      break;
    case "automations":
      if (requireConnection()) await panels.automations();
      break;
    case "closeModal":
      panels.closeModal();
      break;
  }
}
function rowFilter(label, value) {
  return panels.row(
    label,
    "setFilter",
    "",
    state.filter === value ? icon("check", "check") : "",
    `data-value="${value}"`,
  );
}

document.addEventListener("command", (e) =>
  safe(() => command(e.detail.type, e.detail, e.detail.anchor)),
);
document.addEventListener("click", (e) => {
  const target = e.target.closest("button,[data-session]");
  if (!target) {
    if (!e.target.closest("#popover"))
      panels.closePopover({ restoreFocus: false });
    return;
  }
  if (target.dataset.connect) {
    safe(() => connect(target.dataset.connect));
    return;
  }
  if (target.dataset.taskMenu) {
    e.stopPropagation();
    panels.taskMenu(target, target.dataset.taskMenu);
    return;
  }
  if (target.dataset.session) {
    safe(() => openSession(target.dataset.session));
    return;
  }
  if (target.dataset.action || target.dataset.command) {
    safe(() =>
      command(
        target.dataset.action ?? target.dataset.command,
        target.dataset,
        target,
      ),
    );
    return;
  }
  if (target.dataset.catalogTab) {
    safe(() => panels.catalog(target.dataset.catalogTab));
    return;
  }
  if (target.dataset.settingsSection) {
    panels.settings(target.dataset.settingsSection);
    return;
  }
  if (target.dataset.catalogItem !== undefined) {
    safe(() =>
      command("catalogItem", {
        index: target.dataset.catalogItem,
        catalogType: target.dataset.catalogType,
      }),
    );
    return;
  }
  if (target.dataset.file !== undefined) {
    safe(() => panels.fileDetail(Number(target.dataset.file)));
    return;
  }
  if (target.dataset.workspaceView !== undefined) {
    const w = state.workspaces[Number(target.dataset.workspaceView)];
    state.search = "";
    panels.modal(
      `<button class="dialog-close" data-command="closeModal" aria-label="关闭">${icon("close")}</button><h2>${esc(w.name ?? "工作空间")}</h2><p>${esc(w.path ?? w.cwd)}</p><div>${
        state.sessions
          .filter((s) => s.space?.cwd === (w.path ?? w.cwd))
          .map(
            (s) =>
              `<button class="menu-row" data-session="${esc(s.id)}">${esc(s.title)}</button>`,
          )
          .join("") || '<div class="empty">此工作空间暂无任务</div>'
      }</div>`,
      "dialog catalog-dialog",
    );
    return;
  }
  if (target.dataset.copyRecord) {
    const r = state.records.find((x) => x.id === target.dataset.copyRecord);
    safe(async () => {
      await native("copy", { text: textOf(r?.assistantMessage) });
      toast("已复制回复");
    });
    return;
  }
  if (target.classList.contains("copy-code")) {
    safe(async () => {
      await native("copy", {
        text:
          target.closest(".code-block").querySelector("code")?.textContent ??
          "",
      });
      toast("已复制代码");
    });
  }
});
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[href]");
  if (a) {
    e.preventDefault();
    safe(() => native("open", { url: a.href }));
  }
  if (e.target === $("#modal-layer")) panels.closeModal();
});
document.addEventListener("contextmenu", (e) => {
  const task = e.target.closest("[data-session]");
  if (task) {
    e.preventDefault();
    panels.taskMenu(task, task.dataset.session);
  }
});
$("#prompt").addEventListener("input", () => {
  resizeInput();
  updateComposer();
});
$("#prompt").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
    e.preventDefault();
    safe(send);
  }
});
$("#messages-scroll").addEventListener("scroll", () => {
  const s = $("#messages-scroll");
  $("#scroll-bottom").hidden =
    s.scrollHeight - s.clientHeight - s.scrollTop < 150;
});
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    panels.searchDialog();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
    e.preventDefault();
    newTask();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === ",") {
    e.preventDefault();
    panels.settings();
    return;
  }
  if (e.key === "Escape") {
    if (!$("#popover").hidden && !$("#popover").inert) panels.closePopover();
    else if (!$("#modal-layer").hidden && !$("#modal-layer").inert)
      panels.closeModal();
    else if (state.panel) {
      safe(() => panels.files());
    }
    return;
  }
  const modal = $("#modal-layer"),
    pop = $("#popover");
  const scope =
    !pop.hidden && !pop.inert
      ? pop
      : !modal.hidden && !modal.inert
        ? modal
        : null;
  if (scope && e.key === "Tab") {
    const focusable = [
      ...scope.querySelectorAll(
        'button:not(:disabled),input,select,[tabindex="0"]',
      ),
    ].filter((x) => !x.hidden);
    if (!focusable.length) return;
    const i = focusable.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) {
      e.preventDefault();
      focusable.at(-1).focus();
    } else if (!e.shiftKey && i === focusable.length - 1) {
      e.preventDefault();
      focusable[0].focus();
    }
  }
  if (scope && ["ArrowDown", "ArrowUp"].includes(e.key)) {
    const list = [
      ...scope.querySelectorAll("button:not(:disabled),.task-row"),
    ].filter((x) => !x.hidden);
    if (!list.length) return;
    e.preventDefault();
    const i = list.indexOf(document.activeElement);
    list[
      (i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length
    ].focus();
  }
  if (e.key === "Enter" && document.activeElement?.matches(".task-row")) {
    e.preventDefault();
    safe(() => openSession(document.activeElement.dataset.session));
  }
});
window.nativeEvent = ({ type, data }) => {
  if (type === "authReady" && !state.connected) safe(() => discover(true));
  if (type === "signedIn") {
    state.devices = data.items;
    state.profile = data.profile;
    renderSidebar();
    banner("选择远端 Mac");
    panels.deviceMenu($("#device-button"));
  }
  if (type === "settings") panels.settings();
};
document.body.classList.add("wb-polished");
paintIcons();
panels.applyAppearance();
matchMedia("(prefers-color-scheme:dark)").addEventListener(
  "change",
  panels.applyAppearance,
);
renderPage();
safe(async () => {
  const prefs = await native("ready");
  state.preferredDevice = prefs.preferredDevice ?? "";
  await discover(true);
});
setInterval(() => safe(poll), 2000);
