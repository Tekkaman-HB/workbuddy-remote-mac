/**
 * [INPUT]: 依赖 marked 的 GFM 解析、DOMPurify 的 HTML 净化与 UI 图标、产物引用识别。
 * [OUTPUT]: Markdown、安全消息块、轻量过程行/真实详情折叠、正文与回复元数据。
 * [POS]: UI 的消息展示模块，不执行消息中的 HTML 或脚本。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { marked } from "marked";
import DOMPurify from "dompurify";
import { escapeHTML as esc, textOf } from "./state.js";
import { linkFileReferences } from "./artifacts.js";
import { icon } from "./icons.js";
import { contentBlocks, isThought, isTool, replyParts, requestStatus, toolPresentation } from "./transcript.js";
export function markdown(text) {
  const clean = DOMPurify.sanitize(marked.parse(String(text ?? ""), { gfm: true, breaks: true }), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["input", "button", "form", "style", "video", "audio", "iframe"],
    FORBID_ATTR: ["style", "id", "name"],
  });
  const holder = document.createElement("div");
  holder.innerHTML = clean;
  holder.querySelectorAll("pre").forEach((pre) => {
    const wrapper = document.createElement("div");
    wrapper.className = "code-block";
    const head = document.createElement("div");
    head.className = "code-header";
    const lang = pre.querySelector("code")?.className.replace("language-", "") || "代码";
    const label = document.createElement("span");
    label.textContent = lang;
    const button = document.createElement("button");
    button.className = "copy-code";
    button.setAttribute("aria-label", "复制代码");
    button.innerHTML = icon("copy") + "复制";
    head.append(label, button);
    pre.replaceWith(wrapper);
    wrapper.append(head, pre);
  });
  holder.querySelectorAll("a").forEach((a) => {
    a.setAttribute("rel", "noreferrer noopener");
  });
  holder.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") ?? "";
    if (!/^https:\/\//i.test(src) && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(src)) {
      img.remove();
      return;
    }
    img.loading = "lazy";
  });
  linkFileReferences(holder);
  return holder.innerHTML;
}
function payload(value) {
  if (value === undefined || value === null || value === "") return "";
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return `<pre>${esc(text)}</pre>`;
}
export function blocks(value, prefix = "block") {
  return contentBlocks(value)
    .map((block, index) => {
      const key = esc(prefix + ":" + (block.toolCallId ?? block.messageId ?? block.id ?? index));
      if (block.type === "text") return markdown(block.text ?? "");
      if (isThought(block)) {
        const thought = String(block.text ?? textOf(block.content));
        return thought.trim()
          ? `<details class="thinking" data-detail-key="${key}"><summary><span>深度思考</span>${icon("chevron", "detail-chevron")}</summary><div class="detail-content thought-content">${markdown(thought)}</div></details>`
          : '<div class="thinking process-row"><span>深度思考</span></div>';
      }
      if (block.type === "image") {
        const src = block.uri ?? (block.data ? `data:${block.mimeType || "image/png"};base64,${block.data}` : "");
        return /^https:\/\//i.test(src) || /^data:image\/(png|jpeg|webp|gif);base64,/i.test(src)
          ? `<img class="message-image" src="${esc(src)}" alt="会话图片" loading="lazy">`
          : `<div class="attachment">${icon("file")}图片由远端保存</div>`;
      }
      if (["resource_link", "resource", "file"].includes(block.type))
        return `<div class="attachment">${icon("file")}<span>${esc(block.name ?? block.title ?? block.uri?.split("/").pop() ?? "附件")}</span></div>`;
      if (isTool(block)) {
        const tool = toolPresentation(block);
        const row = `${tool.running ? '<span class="spinner process-spinner" aria-label="正在执行"></span>' : icon(tool.icon, "tool-icon")}<span class="process-label">${esc(tool.action)}</span>${tool.context ? `<small class="tool-context">${esc(tool.context)}</small>` : ""}${tool.failed ? '<small class="tool-error">失败</small>' : tool.cancelled ? '<small class="tool-cancelled">已取消</small>' : ""}`;
        if (!tool.hasDetail) return `<div class="tool-card process-row" data-detail-key="${key}" title="${esc(tool.label)}">${row}</div>`;
        const detail = {};
        if (tool.input !== undefined && tool.input !== null) detail.parameters = tool.input;
        if (tool.output !== undefined && tool.output !== null) detail.result = tool.output;
        return `<details class="tool-card" data-detail-key="${key}"><summary title="${esc(tool.label)}">${row}${icon("chevron", "detail-chevron")}</summary><div class="detail-content tool-content">${tool.description ? `<div class="tool-description">${esc(tool.description)}</div>` : ""}${Object.keys(detail).length ? payload(detail) : ""}</div></details>`;
      }
      if (block.text) return markdown(block.text);
      if (block.content) return blocks(block.content, key);
      return `<details class="tool-card" data-detail-key="${key}"><summary>${icon("file")}<span>${esc(block.type ?? "消息内容")}</span>${icon("chevron", "detail-chevron")}</summary><div class="detail-content tool-content">${payload(block)}</div></details>`;
    })
    .join("");
}
export function assistantReply(record) {
  const parts = replyParts(record),
    status = esc(requestStatus(record));
  const process = parts.process.length
    ? `<details class="execution-process" data-detail-key="process"><summary>${status}${icon("chevron")}</summary><div class="process-content detail-content">${blocks(parts.process, "process")}</div></details>`
    : `<div class="execution-status">${status}</div>`;
  return `${process}<div class="answer-content">${blocks(parts.answer, "answer")}</div>`;
}
export function messageActions(record) {
  const time = record.finishTimestamp ?? record.completedAt ?? record.timestamp;
  const clock = Number.isFinite(time)
    ? new Date(time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
    : "";
  return `<div class="message-actions"><button data-copy-record="${esc(record.id)}" aria-label="复制回复">${icon("copy")}</button><span>${esc(record.responseModel?.name ?? record.responseModel?.model ?? record.requestedModel?.name ?? "")}</span>${clock ? `<time>${esc(clock)}</time>` : ""}</div>`;
}
