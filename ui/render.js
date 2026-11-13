/**
 * [INPUT]: 依赖 marked 的 GFM 解析、DOMPurify 的 HTML 净化与 UI 图标。
 * [OUTPUT]: Markdown、消息内容块和工具结果的安全 HTML。
 * [POS]: UI 的消息展示模块，不执行消息中的 HTML 或脚本。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { marked } from "marked";
import DOMPurify from "dompurify";
import { escapeHTML as esc, textOf } from "./state.js";
import { icon } from "./icons.js";
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
  return holder.innerHTML;
}
export function blocks(value) {
  if (typeof value === "string") return markdown(value);
  if (!Array.isArray(value)) return value?.content ? blocks(value.content) : "";
  return value
    .map((block) => {
      if (block.type === "text") return markdown(block.text ?? "");
      if (["thinking", "reasoning", "thought"].includes(block.type))
        return `<details class="thinking"><summary>${icon("spark")}思考过程${icon("chevron")}</summary><div>${markdown(block.text ?? textOf(block.content))}</div></details>`;
      if (block.type === "image") {
        const src = block.uri ?? (block.data ? `data:${block.mimeType || "image/png"};base64,${block.data}` : "");
        return /^https:\/\//i.test(src) || /^data:image\/(png|jpeg|webp|gif);base64,/i.test(src)
          ? `<img class="message-image" src="${esc(src)}" alt="会话图片" loading="lazy">`
          : `<div class="attachment">${icon("file")}图片由远端保存</div>`;
      }
      if (["resource_link", "resource", "file"].includes(block.type))
        return `<div class="attachment">${icon("file")}<span>${esc(block.name ?? block.title ?? block.uri?.split("/").pop() ?? "附件")}</span><small>远端文件</small></div>`;
      const tool = block.name ?? block.toolName ?? block.function?.name;
      if (tool || /tool|function/i.test(block.type ?? ""))
        return `<details class="tool-card"><summary>${icon("code")}<span>${esc(tool ?? "工具执行")}</span><small>${esc(block.state ?? block.status ?? "")}</small>${icon("chevron")}</summary><pre>${esc(typeof block.result === "string" ? block.result : JSON.stringify(block.result ?? block.output ?? block.arguments ?? block.input ?? block.content ?? {}, null, 2))}</pre></details>`;
      if (block.text) return markdown(block.text);
      if (block.content) return blocks(block.content);
      return `<details class="tool-card"><summary>${icon("file")}<span>${esc(block.type ?? "消息内容")}</span>${icon("chevron")}</summary><pre>${esc(JSON.stringify(block, null, 2))}</pre></details>`;
    })
    .join("");
}
export function messageActions(record) {
  return `<div class="message-actions"><button data-copy-record="${esc(record.id)}" aria-label="复制回复">${icon("copy")}</button><span>${esc(record.responseModel?.name ?? record.responseModel?.model ?? record.requestedModel?.name ?? "")}</span>${record.state === "cancelled" ? "<span>已停止</span>" : ""}</div>`;
}
