/**
 * [INPUT]: 依赖 state 的运行状态识别和远端请求记录。
 * [OUTPUT]: 提供执行过程/正文分层、真实耗时、工具动作/图标/状态与可用详情。
 * [POS]: UI 的转录语义层，被 render.js 消费；不修改远端消息。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { isRunning } from "./state.js";
export function contentBlocks(value) {
  if (typeof value === "string") return value ? [{ type: "text", text: value }] : [];
  if (Array.isArray(value)) return value;
  return value?.content ? contentBlocks(value.content) : [];
}
export const isThought = (block) => ["thinking", "reasoning", "thought"].includes(block.type);
export const isTool = (block) =>
  !["text", "image", "resource_link", "resource", "file"].includes(block.type) &&
  Boolean(block.toolName || block.name || block.function?.name || /tool|function/i.test(block.type ?? ""));
function lastIndex(items, predicate) {
  for (let i = items.length - 1; i >= 0; i--) if (predicate(items[i])) return i;
  return -1;
}
export function replyParts(record) {
  const content = contentBlocks(record.assistantMessage);
  const lastProcess = lastIndex(content, (b) => isThought(b) || isTool(b));
  if (lastProcess < 0) return { process: [], answer: content };
  const process = content.slice(0, lastProcess + 1),
    answer = content.slice(lastProcess + 1);
  // -- 取消或中断没有最终段落时，仍把最后一段实际文字留在主区 --
  if (!answer.some((b) => b.type === "text" && b.text?.trim()) && !isRunning(record.state)) {
    const lastText = lastIndex(process, (b) => b.type === "text" && b.text?.trim());
    if (lastText >= 0) answer.unshift(...process.splice(lastText, 1));
  }
  return { process, answer };
}
export function requestStatus(record) {
  const labels = {
    completed: "已完成",
    cancelled: "已取消",
    canceled: "已取消",
    failed: "执行失败",
    error: "执行失败",
    queued: "排队中",
  };
  const label = labels[record.state] || (isRunning(record.state) ? "正在处理" : "执行过程");
  const start = record.timestamp,
    end = record.finishTimestamp ?? record.completedAt;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return label;
  const seconds = Math.round((end - start) / 1000);
  const duration =
    seconds >= 3600
      ? `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`
      : seconds >= 60
        ? `${Math.floor(seconds / 60)}m${seconds % 60}s`
        : `${seconds}s`;
  return label + " " + duration;
}
const toolLabels = {
  bash: ["运行命令", "terminal"],
  read: ["读取文件", "file"],
  write: ["写入文件", "file"],
  edit: ["修改文件", "edit"],
  multiedit: ["修改文件", "edit"],
  grep: ["搜索内容", "search"],
  glob: ["查找文件", "search"],
  todowrite: ["整理计划", "check"],
  task: ["执行子任务", "wrench"],
  toolsearch: ["搜索工具", "search"],
  deferexecutetool: ["执行工具", "wrench"],
  websearch: ["搜索网页", "search"],
  webfetch: ["读取网页", "globe"],
  list_installed_plugins: ["查看已添加连接器", "plug"],
  reconnect_plugin: ["重新授权连接器", "plug"],
  send_automation_result: ["发送执行结果", "up"],
};
const asText = value => typeof value === "string" ? value : "";
export function toolPresentation(block) {
  const name = asText(block.toolName || block.name || block.function?.name || block._meta?.["codebuddy.ai/toolName"]) || "工具执行";
  const input = block.input ?? block.arguments ?? block.rawInput;
  let args = input;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {}
  }
  const canonical = name.split("__").at(-1).toLowerCase();
  const [base, icon] = Object.hasOwn(toolLabels, canonical) ? toolLabels[canonical] : [name, "wrench"];
  const description = asText(block.summary) || (block.title !== name ? asText(block.title) : "") || asText(args?.description);
  const fileTool = ["read", "write", "edit", "multiedit"].includes(canonical);
  const path = fileTool && (asText(args?.file_path ?? args?.path) || (/^(\/|[A-Za-z]:[\\/])/.test(description) ? description : ""));
  const context = path ? path.split(/[\\/]/).pop() : "";
  const output = block.result ?? block.output ?? block.rawOutput ?? block.content;
  const status = asText(block.status ?? block.state).toLowerCase();
  return {
    name,
    label: context ? `${base}：${context}` : base,
    action: base, context, icon, description,
    input: args, output,
    hasDetail: Boolean(description || [args, output].some(value => value !== undefined && value !== null && value !== "")),
    failed: ["failed", "error"].includes(status),
    running: ["pending", "running", "in_progress", "working"].includes(status),
    cancelled: ["cancelled", "canceled"].includes(status),
  };
}
