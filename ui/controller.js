/**
 * [INPUT]: 依赖原生请求桥、共享状态和视图更新函数。
 * [OUTPUT]: 设备连接、分页读取、草稿、任务写入和轮询协调。
 * [POS]: UI 的远端会话控制器；发送失败保留草稿且不自动重发。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { state, $, native, rpc, listItems, isListResult, mergeRecords } from "./state.js";
import {
  renderPage,
  renderSidebar,
  renderMessages,
  resetHistory,
  updateComposer,
  updateTitle,
  toast,
  banner,
} from "./view.js";
import * as panels from "./panels.js";
const drafts = new Map();
let historyBusy = false,
  discoveryBusy = false,
  listEpoch = null,
  historyError = false,
  lastListRefresh = 0;
export const safe = (fn) =>
  Promise.resolve()
    .then(fn)
    .catch((error) => toast(error.message));
export function requireConnection() {
  if (!state.connected) {
    panels.deviceMenu($("#device-button"));
    return false;
  }
  return true;
}
export async function discover(auto = false) {
  if (discoveryBusy) return;
  discoveryBusy = true;
  try {
    const data = await native("devices");
    state.devices = data.items ?? [];
    state.profile = data.profile ?? {};
    renderSidebar();
    if (auto && !state.connected && !state.connecting) {
      const preferred = state.devices.find((x) => x.deviceId === state.preferredDevice && x.onlineFlag);
      if (preferred) await connect(preferred.deviceId);
      else {
        banner("选择远端 Mac，开始使用本地任务");
        panels.deviceMenu($("#device-button"));
      }
    }
    return data;
  } catch (e) {
    banner("登录 WorkBuddy 账号，然后连接远端 Mac");
    if (!auto) throw e;
  } finally {
    discoveryBusy = false;
  }
}
export async function connect(id) {
  if (state.connecting) return;
  const device = state.devices.find((d) => d.deviceId === id);
  if (!device) return;
  state.connecting = true;
  panels.closePopover();
  const epoch = ++state.epoch;
  state.historyEpoch++;
  historyBusy = false;
  state.connected = false;
  state.session = null;
  state.records = [];
  state.sessions = [];
  state.workspaces = [];
  state.models = [];
  state.features = {};
  state.catalogs = {};
  state.config = {};
  state.draftConfig = {};
  state.view = "home";
  state.device = device;
  state.loading = true;
  resetHistory();
  renderPage();
  banner("正在连接 " + device.displayName + "…");
  try {
    await native("connect", { deviceId: id });
    if (epoch !== state.epoch) return;
    state.connected = true;
    state.preferredDevice = id;
    await loadSessions(epoch);
    const probes = [
      ["models", "wb:models:list", []],
      ["workspaces", "wb:workspaces:list", [{}]],
      ["experts", "wb:experts:list", []],
      ["skills", "wb:skills:installed", [{}]],
      ["connectors", "wb:connectors:list", []],
      ["automations", "wb:automations:list", [{}]],
    ];
    if (state.sessions[0]) probes.push(["files", "wb:artifacts:list", [{ conversationId: state.sessions[0].id }]]);
    const results = await Promise.allSettled(probes.map(([, method, args]) => rpc(method, ...args)));
    if (epoch !== state.epoch) return;
    results.forEach((result, i) => {
      const key = probes[i][0];
      state.features[key] = result.status === "fulfilled" && isListResult(result.value);
      if (state.features[key]) state.catalogs[key] = listItems(result.value);
    });
    state.models = state.catalogs.models ?? [];
    state.workspaces = state.catalogs.workspaces ?? [];
    banner("");
  } catch (e) {
    if (epoch === state.epoch) {
      state.connected = false;
      banner("连接失败：" + e.message);
      toast(e.message);
    }
  } finally {
    if (epoch === state.epoch) {
      state.connecting = false;
      state.loading = false;
      renderPage();
    }
  }
}
export async function loadSessions(epoch = state.epoch) {
  if (!state.connected || listEpoch === epoch) return;
  listEpoch = epoch;
  const sessions = [],
    seen = new Set();
  try {
    for (let page = 1; page <= 100; page++) {
      const result = await rpc("list", { page, size: 100 });
      if (epoch !== state.epoch) return;
      const items = listItems(result);
      let fresh = 0;
      for (const item of items)
        if (item.id && !seen.has(item.id)) {
          seen.add(item.id);
          sessions.push(item);
          fresh++;
        }
      if (!items.length || !fresh || sessions.length >= (result?.total ?? Infinity) || items.length < 100) break;
    }
    if (epoch !== state.epoch) return;
    state.sessions = sessions;
    lastListRefresh = Date.now();
    if (state.session) {
      const current = sessions.find((x) => x.id === state.session.id);
      if (current) state.session = { ...state.session, ...current };
    }
    updateTitle();
    renderSidebar();
    updateComposer();
  } finally {
    if (listEpoch === epoch) listEpoch = null;
  }
}
function saveDraft() {
  drafts.set(state.session?.id ?? "new", $("#prompt").value);
}
export function setDraft(text) {
  $("#prompt").value = text;
  resizeInput();
  updateComposer();
}
export function resizeInput() {
  const input = $("#prompt");
  input.style.height = "auto";
  input.style.height = Math.min(220, Math.max(state.view === "home" ? 78 : 64, input.scrollHeight)) + "px";
}
export function newTask() {
  saveDraft();
  state.historyEpoch++;
  state.session = null;
  state.records = [];
  state.hasOlder = false;
  state.view = "home";
  state.config = { ...state.draftConfig };
  state.loading = false;
  resetHistory();
  renderPage();
  setDraft(drafts.get("new") ?? "");
  $("#prompt").focus();
  if (state.panel) {
    state.panel = false;
    panels.files();
  }
}
export async function openSession(id) {
  const item = state.sessions.find((s) => s.id === id);
  if (!item || !state.connected) return;
  saveDraft();
  panels.closeModal();
  panels.closePopover();
  const epoch = state.epoch,
    historyEpoch = ++state.historyEpoch;
  state.session = item;
  state.records = [];
  state.config = {};
  state.hasOlder = false;
  state.loading = true;
  state.view = "chat";
  resetHistory();
  renderPage();
  setDraft(drafts.get(id) ?? "");
  renderMessages();
  try {
    const result = await rpc("get", id);
    if (epoch !== state.epoch || historyEpoch !== state.historyEpoch) return;
    state.config = result?.configManager ?? {};
    state.session = { ...item, ...result?.info };
    updateComposer();
    await loadHistory(false, true, historyEpoch);
    if (state.panel) {
      state.panel = false;
      await panels.files();
    }
  } catch (e) {
    if (historyEpoch === state.historyEpoch) toast(e.message);
  } finally {
    if (historyEpoch === state.historyEpoch) {
      state.loading = false;
      renderPage();
      renderMessages();
    }
  }
}
export async function loadHistory(older = false, force = false, expected = state.historyEpoch) {
  const id = state.session?.id,
    epoch = state.epoch;
  if (!id || (!force && historyBusy) || !state.connected) return;
  historyBusy = true;
  state.loadingOlder = older;
  try {
    const query = { byteLength: 262144, resultScope: "page" };
    if (older && state.records.length) query.beforeRequestId = state.records[0].id;
    const page = await rpc("requests", id, query);
    if (epoch !== state.epoch || expected !== state.historyEpoch) return;
    state.records = mergeRecords(state.records, listItems(page), older);
    if (older || state.records.length === listItems(page).length) state.hasOlder = Boolean(page?.hasOlder);
    state.loading = false;
    if (historyError) {
      historyError = false;
      banner("");
    }
    renderMessages(force && !older);
  } catch (e) {
    if (expected === state.historyEpoch) {
      if (force) throw e;
      historyError = true;
      banner("远端暂不可达：" + e.message);
    }
  } finally {
    if (expected === state.historyEpoch) {
      historyBusy = false;
      state.loadingOlder = false;
    }
  }
}
export async function config(key, value) {
  if (!requireConnection()) return;
  if (state.session) {
    const id = state.session.id;
    await rpc(
      key === "expertId" ? "configSetExpert" : "configSet" + key[0].toUpperCase() + key.slice(1),
      id,
      key === "expertId" ? { id: value } : value,
    );
    if (state.session?.id !== id) return;
  }
  state.config[key] = value;
  if (!state.session) state.draftConfig[key] = value;
  if (key === "mode" && ["ask", "plan"].includes(value)) state.config.expertId = "";
  updateComposer();
  panels.closePopover();
}
export async function send() {
  const text = $("#prompt").value.trim();
  if (!text || state.sending || state.loading || !requireConnection()) return;
  const epoch = state.epoch,
    originHistory = state.historyEpoch,
    draftKey = state.session?.id ?? "new";
  const desired = { ...state.config },
    workspace = state.workspace;
  drafts.set(draftKey, text);
  state.sending = true;
  updateComposer();
  let id = state.session?.id;
  try {
    if (!id) {
      const options = workspace ? { cwd: workspace.path ?? workspace.cwd } : {};
      const created = await rpc("create", options);
      if (epoch !== state.epoch) return;
      const info = created?.info ?? created;
      if (!info?.id) throw new Error("远端未返回新任务 ID");
      id = info.id;
      const actual = { ...created.configManager };
      state.sessions.unshift(info);
      if (originHistory === state.historyEpoch) {
        state.session = info;
        state.view = "chat";
        state.records = [];
        state.historyEpoch++;
        resetHistory();
        state.config = { ...actual };
        renderPage();
        renderMessages();
      } else renderSidebar();
      for (const key of ["model", "expertId", "permissionMode", "mode"]) {
        if (!desired[key] || desired[key] === actual[key]) continue;
        if (epoch !== state.epoch) return;
        const method = key === "expertId" ? "configSetExpert" : "configSet" + key[0].toUpperCase() + key.slice(1);
        await rpc(method, id, key === "expertId" ? { id: desired[key] } : desired[key]);
        actual[key] = desired[key];
        if (state.session?.id === id) {
          state.config = { ...actual };
          updateComposer();
        }
      }
    }
    if (epoch !== state.epoch) return;
    await rpc("sendPrompt", id, [{ type: "text", text }], {});
    if (epoch !== state.epoch) return;
    if (drafts.get(draftKey) === text) drafts.delete(draftKey);
    if (state.session?.id === id) {
      if ($("#prompt").value.trim() === text) setDraft("");
      state.session.state = "running";
      await loadHistory(false, true);
    }
    await loadSessions(epoch);
  } catch (e) {
    if (epoch === state.epoch) {
      toast("发送未完成：" + e.message);
      if (state.session?.id === id && !$("#prompt").value.trim()) setDraft(text);
    }
  } finally {
    if (epoch === state.epoch) {
      state.sending = false;
      updateComposer();
    }
  }
}
export async function stop() {
  if (!state.session) return;
  const id = state.session.id;
  await rpc("cancel", id);
  toast("已请求远端停止当前任务");
  await loadHistory(false, true);
}
export async function taskAction(type, id) {
  const item = state.sessions.find((s) => s.id === id);
  if (!item) return;
  if (type === "rename") {
    panels.confirmDialog(
      "重命名任务",
      "修改远端任务的标题。",
      (name) =>
        safe(async () => {
          if (!name?.trim()) return;
          await rpc("rename", id, name.trim());
          await loadSessions();
          if (state.session?.id === id) {
            state.session.title = name.trim();
            renderPage();
          }
        }),
      { initial: item.title ?? "" },
    );
    return;
  }
  if (type === "pin") {
    await rpc(item.isPinned ? "unpin" : "pin", id);
    await loadSessions();
    return;
  }
  const descriptions = {
    archive: "任务将从当前列表归档，可在远端 WorkBuddy 的归档中查找。",
    delete: "删除的是远端 Mac 上的此任务及其会话。请确认后再继续。",
  };
  panels.confirmDialog(
    type === "archive" ? "归档任务" : "删除任务",
    `“${item.title ?? "新任务"}”\n${descriptions[type]}`,
    () =>
      safe(async () => {
        await rpc(type, id);
        if (state.session?.id === id) newTask();
        await loadSessions();
      }),
    { destructive: type === "delete" },
  );
}

export async function poll() {
  if (!state.connected || state.connecting || state.loading || state.sending) return;
  if (state.session) await loadHistory();
  if (Date.now() - lastListRefresh > 30000) await loadSessions();
}
