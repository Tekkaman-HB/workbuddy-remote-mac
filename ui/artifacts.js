/**
 * [INPUT]: 依赖已净化的消息 DOM 和当前会话产物列表。
 * [OUTPUT]: 文件引用按钮与保留重名歧义的精确产物匹配。
 * [POS]: UI 的报告入口，不从消息路径读取文件，不执行文件内容。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const extensions = /\.(html?|pdf|md|txt|csv|json|png|jpe?g|webp|svg|xlsx?|docx?|pptx?)$/i;
export function fileName(value) {
  const text = String(value ?? "").trim();
  if (!text || /[\n\r\x00]/.test(text) || /^(https?:|javascript:|data:)/i.test(text)) return "";
  return text.split(/[\\/]/).pop();
}
export function matchArtifacts(items, reference) {
  const name = fileName(reference);
  return name ? items.filter((item) => fileName(item.title ?? item.name ?? item.filePath ?? item.uri) === name) : [];
}
export function linkFileReferences(holder) {
  holder.querySelectorAll("code,a").forEach((node) => {
    if (node.closest("pre") || (node.tagName === "CODE" && node.closest("a"))) return;
    const reference = node.tagName === "A" ? node.getAttribute("href") : node.textContent;
    const name = fileName(reference);
    if (!name || !extensions.test(name)) return;
    const button = document.createElement("button");
    button.className = "artifact-reference";
    button.dataset.artifactName = name;
    button.title = "预览 " + name;
    button.textContent = node.textContent;
    node.replaceWith(button);
  });
}
