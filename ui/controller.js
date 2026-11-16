/**
 * [INPUT]: 依赖原生请求桥、共享状态、catalog 模型合并和视图更新函数。
 * [OUTPUT]: 账号认证/设备发现状态区分、阅读成功后的远端已读同步、设备连接、单飞历史分页及最多三路执行详情读取、失败保留记录/恢复清除提示、产物/模型/草稿协调。
 * [POS]: UI 的远端会话控制器；发送失败保留草稿且不自动重发。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { state, $, native, rpc, listItems, isListResult, mergeRecords, projectedSessions, resetAccount } from "./state.js";
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
import { mergeModels } from "./catalog.js";
import { conversationRevision, applyReadReceipts } from "./tasks.js";
import { runConversation } from "./automations.js";
import { matchArtifacts } from "./artifacts.js";
import { renderHistoryEdge } from "./history-scroll.js";
const drafts = new Map();
const automationDetails = new Map();
const readReceipts = new Map(), pendingReads = new Set(), readRetryAfter = new Map();
const AUTOMATION_DETAIL_CONCURRENCY = 3;
let lastAutomationRefresh = 0;
let pendingOlderEpoch = null;
let historyBusy = false,
  discoveryBusy = false,
  listEpoch = null,
  lastListRefresh = 0;
export const safe = (fn) =>
  Promise.resolve()
    .then(fn)
    .catch((error) => toast(error.message));
function resetHistoryLoading() {
  historyBusy = false;
  pendingOlderEpoch = null;
  state.loadingOlder = false;
  state.olderError = null;
  clearHistoryError();
}
function clearHistoryError() {
  if (state.historyError) { state.historyError = null; banner(""); }
}
function finishHistoryLoading(expected) {
  if (expected !== state.historyEpoch) return;
  historyBusy = false;
  state.loadingOlder = false;
  renderHistoryEdge();
  const pending = pendingOlderEpoch;
  pendingOlderEpoch = null;
  if (pending === expected) void loadOlder();
}
export async function loadOlder() {
  if (!state.connected || state.loading || !state.hasOlder || state.loadingOlder) return;
  if (historyBusy) { pendingOlderEpoch = state.historyEpoch; return; }
  await loadHistory(true);
}
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
  const epoch = state.epoch;
  try {
    const data = await native("devices");
    if (epoch !== state.epoch) return;
    state.devices = data.items ?? [];
    state.profile = data.profile ?? {};
    state.authStatus = "signedIn";
    renderSidebar();
    panels.refreshAuthMenu();
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
    if (epoch !== state.epoch) return;
    const auth = await native("authStatus").catch(() => null);
    if (epoch !== state.epoch) return;
    if (auth?.status === "signedOut") {
      resetAccount(); resetHistory(); renderPage();
    } else if (auth?.status === "signedIn") {
      state.authStatus = "signedIn"; state.profile = auth.profile ?? {};
      renderSidebar();
    }
    panels.refreshAuthMenu();
    banner(state.authStatus === "signedOut" ? "请登录 WorkBuddy 账号" : e.message);
    if (!auto && state.authStatus !== "signedOut") throw e;
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
  resetHistoryLoading();
  state.connected = false;
  state.session = null;
  state.automation = null;
  automationDetails.clear();
  readReceipts.clear(); readRetryAfter.clear();
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
      ["customModels", "wb:models:customs", []],
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
    state.models = mergeModels(state.catalogs.models ?? [], state.catalogs.customModels ?? []);
    state.features.models = state.features.models || state.features.customModels;
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
    const definitions = state.features.automations ? listItems(await rpc("wb:automations:list", {})) : null;
    if (epoch !== state.epoch) return;
    state.sessions = applyReadReceipts(sessions, readReceipts);
    if (definitions) state.catalogs.automations = definitions;
    lastListRefresh = Date.now();
    if (state.session) {
      const current = state.sessions.find((x) => x.id === state.session.id);
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
  panels.closeModal();
  panels.closePopover();
  void native("artifactClose").catch(() => {});
  saveDraft();
  state.historyEpoch++;
  resetHistoryLoading();
  state.session = null;
  state.automation = null;
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
  const task = projectedSessions().find(x => x.id === id);
  if (task?.isAutomationAggregate) return openAutomation(task);
  void native("artifactClose").catch(() => {});
  const item = state.sessions.find((s) => s.id === id);
  if (!item || !state.connected) return;
  saveDraft();
  panels.closeModal();
  panels.closePopover();
  const epoch = state.epoch,
    historyEpoch = ++state.historyEpoch;
  resetHistoryLoading();
  state.session = item;
  state.automation = null;
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
async function acknowledgeRead(items, epoch, notify = false) {
  let failed = false, changed = false;
  const unread = items.filter(item => item.unread);
  if (!unread.length) return;
  for (let offset = 0; offset < unread.length && epoch === state.epoch; offset += 3) {
    await Promise.all(unread.slice(offset, offset + 3).map(async item => {
    const revision = conversationRevision(item), key = JSON.stringify([epoch, item.id, revision]);
    if (pendingReads.has(key) || !notify && (readRetryAfter.get(key) ?? 0) > Date.now()) return;
    pendingReads.add(key);
    try {
      await rpc("markRead", item.id);
      if (epoch !== state.epoch) return;
      const current = state.sessions.find(session => session.id === item.id);
      if (!current || conversationRevision(current) !== revision) return;
      readReceipts.set(item.id, revision);
      changed = true;
      readRetryAfter.delete(key);
      state.sessions = applyReadReceipts(state.sessions, readReceipts);
      if (state.session?.id === item.id && conversationRevision(state.session) === revision)
        state.session = {...state.session, unread: false};
    } catch {
      if (epoch === state.epoch) {failed = true; readRetryAfter.set(key, Date.now() + 30000);}
    } finally {pendingReads.delete(key);}
    }));
  }
  if (epoch !== state.epoch) return;
  if (changed) renderSidebar();
  if (failed && notify) toast("内容已读取，已读状态同步失败，请稍后重新打开任务重试");
}

export async function loadHistory(older = false, force = false, expected = state.historyEpoch) {
  if (older && !state.hasOlder) return;
  if (state.automation) return loadAutomationHistory(older, force);
  const id = state.session?.id,
    epoch = state.epoch;
  if (!id || (!force && historyBusy) || !state.connected) return;
  const readSnapshot = state.sessions.filter(item => item.id === id).map(item => ({...item}));
  historyBusy = true;
  state.loadingOlder = older;
  if (older) { state.olderError = null; renderHistoryEdge(); }
  try {
    const query = { byteLength: 262144, resultScope: "page" };
    if (older && state.records.length) query.beforeRequestId = state.records[0].id;
    const page = await rpc("requests", id, query);
    if (epoch !== state.epoch || expected !== state.historyEpoch) return;
    const merged = mergeRecords(state.records, listItems(page), older);
    if (older && page?.hasOlder && merged[0]?.id === state.records[0]?.id) throw new Error("历史分页没有推进，请重试");
    state.records = merged;
    if (older || state.records.length === listItems(page).length) state.hasOlder = Boolean(page?.hasOlder);
    state.loading = false;
    clearHistoryError();
    renderMessages(force && !older);
    if (!older && (force || document.visibilityState === "visible" && document.hasFocus()))
      await acknowledgeRead(readSnapshot, epoch, force);
  } catch (e) {
    if (expected === state.historyEpoch) {
      if (older) { state.olderError = e.message; return; }
      if (force) throw e;
      state.historyError = e.message;
      banner("远端暂不可达：" + e.message);
    }
  } finally {
    finishHistoryLoading(expected);
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
  if (state.automation) return;
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
  if (state.session || state.automation) await loadHistory();
  if (Date.now() - lastListRefresh > 30000) await loadSessions();
}

async function openAutomation(task) {
  if (!requireConnection()) return;
  void native("artifactClose").catch(() => {});
  saveDraft();
  panels.closeModal(); panels.closePopover();
  const historyEpoch = ++state.historyEpoch;
  resetHistoryLoading();
  state.session = null;
  state.automation = task;
  state.automationExpanded.clear();
  state.records = [];
  state.view = "automation";
  state.loading = true;
  state.hasOlder = false;
  resetHistory(); renderPage(); renderMessages();
  try { await loadAutomationHistory(false, true); }
  catch (error) { toast(error.message); }
  finally { if (state.historyEpoch === historyEpoch) { state.loading = false; renderMessages(true); } }
}

async function loadAutomationHistory(older = false, force = false) {
  const task = state.automation, epoch = state.epoch, historyEpoch = state.historyEpoch;
  if (!task || historyBusy || !force && !older && Date.now() - lastAutomationRefresh < 10000) return;
  const readSnapshot = state.sessions.filter(item => item.isBackgroundAutomation && item.tags?.automationId === task.automationId).map(item => ({...item}));
  historyBusy = true;
  state.loadingOlder = older;
  if (older) { state.olderError = null; renderHistoryEdge(); }
  try {
    const count = older ? state.records.length + 10 : Math.max(10, state.records.length);
    const page = await rpc("wb:automations:listRecords", {automationId: task.automationId, offset: 0, limit: count, withTotal: true});
    if (epoch !== state.epoch || historyEpoch !== state.historyEpoch) return;
    const records = listItems(page);
    const readDetail = async record => {
      const key = JSON.stringify([epoch, record.id, record.status, record.finishedAt, record.summary, record.resultTitle]);
      if (["success", "failed", "archived"].includes(record.status) && automationDetails.has(key)) return automationDetails.get(key);
      try {
        const detail = await rpc("wb:automations:getRecordDetail", record.id);
        if (!detail || detail.id !== record.id || detail.automationId !== task.automationId) throw new Error("执行记录归属不匹配");
        const merged = {...record, ...detail};
        automationDetails.set(key, merged);
        return merged;
      } catch (error) { return {...record, detailError: error.message}; }
    };
    const results = new Array(records.length);
    let next = 0;
    await Promise.all(Array.from({length: Math.min(AUTOMATION_DETAIL_CONCURRENCY, records.length)}, async () => {
      while (next < records.length && epoch === state.epoch && historyEpoch === state.historyEpoch) {
        const index = next++;
        results[index] = await readDetail(records[index]);
      }
    }));
    if (epoch !== state.epoch || historyEpoch !== state.historyEpoch) return;
    state.automation = projectedSessions().find(x => x.id === task.id) ?? task;
    const merged = new Map([...state.records, ...results].map(record => [record.id, record]));
    const more = Number.isFinite(page.total) ? merged.size < page.total : records.length === count;
    if (older && more && merged.size === state.records.length) throw new Error("历史分页没有推进，请重试");
    state.records = [...merged.values()].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
    state.hasOlder = more;
    state.loading = false;
    lastAutomationRefresh = Date.now();
    clearHistoryError();
    updateTitle(); renderMessages(force && !older);
    if (records.length && !results.some(record => record.detailError) && !older &&
        (force || document.visibilityState === "visible" && document.hasFocus()))
      await acknowledgeRead(readSnapshot, epoch, force);
  } catch (error) {
    if (historyEpoch === state.historyEpoch) {
      if (older) state.olderError = error.message;
      else {
        state.historyError = error.message;
        state.loading = false;
        banner("执行记录读取失败：" + error.message);
        renderMessages();
      }
    }
  }
  finally { finishHistoryLoading(historyEpoch); }
}

export function expandAutomationRecord(id) {
  if (!state.automation || !state.records.some(x => x.id === id)) return;
  if (state.automationExpanded.has(id)) state.automationExpanded.delete(id);
  else state.automationExpanded.add(id);
  const top = $("#messages-scroll").scrollTop;
  renderMessages();
  $("#messages-scroll").scrollTop = top;
  [...document.querySelectorAll('[data-action="expandAutomationRecord"]')].find(button => button.dataset.record === id)?.focus({preventScroll: true});
}
export async function openAutomationConversation(id) {
  const record = state.automation && state.records.find(x => x.id === id);
  const conversation = record && runConversation(record);
  if (!conversation) return;
  if (!state.sessions.some(x => x.id === conversation)) { toast("此执行会话未出现在当前设备列表中"); return; }
  await openSession(conversation);
}
export async function openAutomationArtifact(id, name) {
  const record = state.automation && state.records.find(x => x.id === id);
  const conversation = record && runConversation(record);
  const epoch = state.historyEpoch;
  if (!conversation) return;
  const items = listItems(await rpc("wb:artifacts:list", {conversationId: conversation}));
  if (epoch !== state.historyEpoch) return;
  const matches = matchArtifacts(items, name);
  if (matches.length !== 1) { toast(matches.length ? "存在同名文件，请打开执行会话后选择" : "此文件尚未出现在任务产物列表中"); return; }
  await panels.openArtifact(matches[0], conversation);
}
