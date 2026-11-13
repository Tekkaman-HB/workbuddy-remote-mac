/**
 * [INPUT]: 依赖 WebKit native 消息处理器。
 * [OUTPUT]: Promise 请求桥、共享页面状态和纯数据归一函数。
 * [POS]: UI 的数据边界，不持有账号凭证。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export const state = {
  devices: [],
  profile: {},
  device: null,
  sessions: [],
  workspaces: [],
  models: [],
  config: {},
  draftConfig: {},
  records: [],
  session: null,
  connected: false,
  connecting: false,
  loading: false,
  sending: false,
  hasOlder: false,
  workspace: null,
  draft: "",
  search: "",
  showAll: false,
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
export function native(action, args = {}) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID(),
      timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error("请求超时，请检查远端设备连接；消息不会自动重发。"));
      }, 90000);
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
    error ? p.reject(new Error(error)) : p.resolve(value);
  };
export async function rpc(method, ...values) {
  const result = await native("rpc", {
    method: method.startsWith("wb:") ? method : "wb:conversations:" + method,
    values,
  });
  if (result?.errorCode) throw new Error(result.message ?? result.errorCode);
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
  return state.sessions.filter(
    (s) =>
      (state.filter !== "pinned" || s.isPinned) &&
      (state.filter !== "running" || isRunning(s.state)) &&
      (!state.search ||
        String(s.title ?? "")
          .toLowerCase()
          .includes(state.search.toLowerCase())),
  );
}
export function relativeDate(value) {
  const date = new Date(value < 1e12 ? value * 1000 : value);
  const d = Math.max(0, Math.floor((Date.now() - date) / 86400000));
  return !value
    ? ""
    : d === 0
      ? "今天"
      : d === 1
        ? "昨天"
        : d < 7
          ? `${d}天前`
          : `${date.getMonth() + 1}/${date.getDate()}`;
}
