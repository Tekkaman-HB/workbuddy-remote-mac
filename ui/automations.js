/**
 * [INPUT]: 只读自动化执行记录、Markdown 净化、共享页面状态和真实时间。
 * [OUTPUT]: 按日期展示的结果/文件卡片、读取失败与重试入口、展开状态、下一次运行时间及前插阅读位置。
 * [POS]: UI 的定时任务历史视图；读取由 controller 协调，不创建或修改执行计划。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { state, $, escapeHTML as esc } from "./state.js";
import { markdown } from "./render.js";
import { runDate, fullDate } from "./tasks.js";
import { icon } from "./icons.js";
import { renderHistoryEdge, captureHistoryPosition, restoreHistoryPosition } from "./history-scroll.js";
let viewportObserver;

function measureCards() {
  for (const card of document.querySelectorAll(".automation-card")) {
    const body = card.querySelector(".run-output");
    const expanded = card.classList.contains("expanded");
    const clipped = !expanded && body.scrollHeight > body.clientHeight + 1;
    body.classList.toggle("clipped", clipped);
    card.querySelector('[data-action="expandAutomationRecord"]').hidden = !expanded && !clipped;
  }
}

export function runConversation(record) {
  return (
    record.metadata?.conversationId ??
    record.runs?.find((x) => x.conversationId)?.conversationId ??
    record.sessionId
  );
}
export function runBody(record) {
  const output = record.runs
    ?.map((x) => x.output)
    .filter((x) => typeof x === "string" && x.trim())
    .join("\n\n");
  return output || record.summary || "";
}
export function automationCard(record) {
  const expanded = state.automationExpanded.has(record.id);
  const files = record.artifacts ?? [];
  const status = {
    queued: "等待执行",
    running: "正在执行…",
    failed: "执行失败",
    archived: "已归档",
  }[record.status];
  const text = runBody(record);
  return `<article class="automation-run" data-automation-record="${esc(record.id)}">
    <h2 class="run-date" title="${esc(fullDate(record.startedAt))}">${esc(runDate(record.startedAt))}</h2>
    <div class="automation-card ${expanded ? "expanded" : ""}">
      ${status ? `<div class="run-status ${record.status === "failed" ? "failed" : ""}">${esc(status)}</div>` : ""}
      ${record.detailError ? `<div class="run-status failed">执行详情读取失败 <span>${esc(record.detailError)}</span><button data-action="refreshAutomation">重试</button></div>` : ""}
      <div class="run-output assistant-message">${text ? markdown(text) : '<p class="empty">暂无执行结果</p>'}</div>
      <div class="run-files">${files.map((file) => `<button class="run-file" data-action="automationFile" data-record="${esc(record.id)}" data-filename="${esc(file.fileName)}">${icon("file")}<span><strong>${esc(file.fileName)}</strong>${Number.isFinite(file.size) ? `<small>${(file.size / 1024).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} KB</small>` : ""}</span></button>`).join("")}</div>
      <div class="run-card-actions"><button data-action="expandAutomationRecord" data-record="${esc(record.id)}" aria-expanded="${expanded}">${expanded ? "收起" : "查看全部"}${icon("chevronDown")}</button>${runConversation(record) ? `<button data-action="openAutomationConversation" data-record="${esc(record.id)}">打开执行会话${icon("chevron")}</button>` : ""}</div>
    </div></article>`;
}
export function automationMessages(forceBottom = false) {
  const root = $("#messages"),
    scroll = $("#messages-scroll");
  const position = captureHistoryPosition();
  if (!viewportObserver && typeof ResizeObserver !== "undefined") {
    viewportObserver = new ResizeObserver(measureCards);
    viewportObserver.observe(scroll);
  }
  const signature = JSON.stringify([
    state.records,
    [...state.automationExpanded],
    state.hasOlder,
    state.loading,
    state.historyError,
    state.automation.definition,
  ]);
  if (root.dataset.automationSignature !== signature) {
    root.innerHTML = `${state.records.map(automationCard).join("")}${!state.records.length ? `<div class="empty">${state.loading ? "正在读取执行记录…" : state.historyError ? `读取未完成<p>${esc(state.historyError)}</p><button class="button" data-action="refreshAutomation">重新读取</button>` : "暂无执行记录"}</div>` : ""}`;
    const definition = state.automation.definition;
    if (definition.status === "PAUSED")
      root.insertAdjacentHTML(
        "beforeend",
        '<p class="next-run">定时任务已暂停</p>',
      );
    else if (definition.nextRunAt)
      root.insertAdjacentHTML(
        "beforeend",
        `<p class="next-run">下一次运行 ${esc(runDate(definition.nextRunAt))}</p>`,
      );
    root.dataset.automationSignature = signature;
  }
  renderHistoryEdge();
  measureCards();
  restoreHistoryPosition(position, forceBottom);
}
