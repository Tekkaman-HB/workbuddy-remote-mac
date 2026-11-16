/**
 * [INPUT]: 依赖 WebKit native 消息处理器与 tasks 的纯任务投影。
 * [OUTPUT]: 账号认证状态/重置/显示名称、Promise 桥、按网络阶段归一的错误文案、历史加载/失败共享状态、身份聚合任务与数据归一函数。
 * [POS]: UI 的数据边界，不持有账号凭证。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { projectTasks } from "./tasks.js";
export { relativeDate } from "./tasks.js";
export const state = {
  devices: [],
  profile: {},
  authStatus: "unknown",
  device: null,
  sessions: [],
  workspaces: [],
  models: [],
  config: {},
  draftConfig: {},
  records: [],
  session: null,
  automation: null,
  automationExpanded: new Set(),
  connected: false,
  connecting: false,
  loading: false,
  sending: false,
  hasOlder: false,
  loadingOlder: false,
  olderError: null,
  historyError: null,
  workspace: null,
  draft: "",
  search: "",
  filter: "all",
  view: "home",
  panel: false,
  epoch: 0,
  historyEpoch: 0,
  preferredDevice: "",
  catalogs: {},
  features: {},
};
const pending = new Map();
export function remoteErrorMessage(value) {
  const text = String(value ?? "请求失败");
  const messages = {
    AUTH_REQUIRED: "请在官方页面完成账号登录和账号选择",
    PUBLISH_NETWORK_FAILED: "发送请求时网络连接中断，请稍后重试",
    PUBLISH_TIMEOUT: "发送请求超时，请先刷新确认任务状态",
    PUBLISH_INVALID_RESPONSE: "通道服务返回格式异常，请稍后重试",
    CREDENTIALS_NETWORK_FAILED: "续期连接凭证时网络请求失败，请检查网络后重试",
    CREDENTIALS_TIMEOUT: "续期连接凭证超时，请稍后重试",
    API_NETWORK_FAILED: "读取账号或设备时网络请求失败，请检查网络后重试",
    API_TIMEOUT: "读取账号或设备超时，请稍后重试",
    CHANNEL_CLOSED: "远程连接已断开，请重新连接设备",
    REMOTE_TIMEOUT: "远端响应超时，请稍后刷新",
  };
  for (const [code, message] of Object.entries(messages)) if (text.includes(code)) return message;
  if (/PUBLISH_HTTP_50[234]/.test(text)) return "通道服务暂时不可用，请稍后重试";
  if (/^(?:TypeError:\s*)?Load failed$/i.test(text)) return "网络请求加载失败，请检查网络后重试";
  return text;
}
export function native(action, args = {}) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID(),
      timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error("请求超时，请检查远端设备连接；消息不会自动重发。"));
      }, action === "artifactOpen" ? 300000 : 90000);
    pending.set(id, { resolve, reject, timeout });
    if (!window.webkit?.messageHandlers?.native) {
      clearTimeout(timeout);
      pending.delete(id);
      reject(new Error("请在 WorkBuddy Remote App 中使用"));
      return;
    }
    window.webkit.messageHandlers.native.postMessage({ id, action, args });
  });
}
if (typeof window !== "undefined")
  window.nativeReply = ({ id, value, error }) => {
    const p = pending.get(id);
    if (!p) return;
    clearTimeout(p.timeout);
    pending.delete(id);
    error ? p.reject(new Error(remoteErrorMessage(error))) : p.resolve(value);
  };
export async function rpc(method, ...values) {
  const result = await native("rpc", {
    method: method.startsWith("wb:") ? method : "wb:conversations:" + method,
    values,
  });
  if (result?.errorCode) throw new Error(remoteErrorMessage(result.message ?? result.errorCode));
  return result;
}
const listKeys = [
  "items",
  "models",
  "experts",
  "skills",
  "connectors",
  "workspaces",
  "list",
];
export function isListResult(result) {
  return (
    Array.isArray(result) ||
    listKeys.some((key) => Array.isArray(result?.[key]))
  );
}
export function listItems(result) {
  if (Array.isArray(result)) return result;
  for (const key of listKeys)
    if (Array.isArray(result?.[key])) return result[key];
  return [];
}
export function mergeRecords(old, incoming, older = false) {
  const map = new Map();
  for (const item of older ? [...incoming, ...old] : [...old, ...incoming])
    map.set(item.id, item);
  return [...map.values()].sort(
    (a, b) =>
      (a.requestSeq ?? a.timestamp ?? 0) - (b.requestSeq ?? b.timestamp ?? 0),
  );
}
export function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
export const $ = (s) => document.querySelector(s);
export function textOf(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join("\n");
  return value?.text ?? textOf(value?.content ?? "");
}
export const isRunning = (value) =>
  [
    "running",
    "pending",
    "working",
    "queued",
    "processing",
    "generating",
    "streaming",
  ].includes(String(value ?? "").toLowerCase());
export function visibleSessions() {
  return projectedSessions().filter(
    (s) =>
      s.inTaskList &&
      (state.filter !== "pinned" || s.isPinned) &&
      (state.filter !== "running" || isRunning(s.state)) &&
      (!state.search ||
        String(s.title ?? "")
          .toLowerCase()
          .includes(state.search.toLowerCase())),
  );
}
export function projectedSessions() {
  return projectTasks(state.sessions, state.features.automations ? state.catalogs.automations ?? [] : []);
}

// -- 账号状态独立于设备连接；不根据占位用户名或设备在线状态推断登录 --
export function accountName() {
  return state.authStatus === "signedIn"
    ? state.profile.nickname ?? state.profile.displayName ?? state.profile.name ?? "WorkBuddy 用户"
    : "登录 WorkBuddy";
}
export function resetAccount() {
  ++state.epoch; ++state.historyEpoch;
  Object.assign(state, {
    authStatus: "signedOut", profile: {}, connected: false, device: null, devices: [],
    sessions: [], models: [], workspaces: [], features: {}, catalogs: {},
    draftConfig: {}, config: {}, records: [], session: null, automation: null,
    sending: false, connecting: false, loading: false, loadingOlder: false,
    hasOlder: false, olderError: null, historyError: null, preferredDevice: "", view: "home",
  });
  state.automationExpanded.clear();
}
