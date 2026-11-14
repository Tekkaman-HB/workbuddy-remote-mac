/**
 * [INPUT]: 依赖 Node test 与实际 transcript.js。
 * [OUTPUT]: 验证过程/正文分层、真实耗时与工具动作/图标/摘要及缺少详情边界。
 * [POS]: tests 的转录语义回归，不访问用户会话。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from "node:test";
import assert from "node:assert/strict";
import { replyParts, requestStatus, toolPresentation } from "../ui/transcript.js";
test("执行前说明与工具收在过程内，最终正文保持原顺序且不改原记录", () => {
  const content = [
    { type: "text", text: "准备数据" },
    { type: "tool", toolName: "Read", toolCallId: "a" },
    { type: "reasoning", text: "检查结果" },
    { type: "text", text: "最终回复" },
  ];
  const record = { state: "completed", assistantMessage: { content } };
  const snapshot = JSON.stringify(record);
  const parts = replyParts(record);
  assert.equal(parts.process.length, 3);
  assert.deepEqual(parts.answer, [content[3]]);
  assert.equal(JSON.stringify(record), snapshot);
});
test("中断没有最终回复时，最后一段实际文字保留可见，纯文字不进入过程", () => {
  const parts = replyParts({
    state: "cancelled",
    assistantMessage: [
      { type: "text", text: "已检查文件" },
      { type: "tool", toolName: "Bash" },
    ],
  });
  assert.equal(parts.answer[0].text, "已检查文件");
  assert.equal(parts.process[0].toolName, "Bash");
  assert.deepEqual(replyParts({ assistantMessage: "普通回复" }).process, []);
  assert.deepEqual(replyParts({ assistantMessage: [{ type: "file", name: "报告.md" }] }).process, []);
});
test("状态耗时只取实际时间戳，工具摘要使用记录已有字段", () => {
  assert.equal(requestStatus({ state: "cancelled", timestamp: 1000, finishTimestamp: 154000 }), "已取消 2m33s");
  assert.equal(requestStatus({ state: "completed" }), "已完成");
  assert.equal(requestStatus({ state: "running" }), "正在处理");
  const tool = toolPresentation({
    type: "tool",
    toolName: "Read",
    input: { file_path: "/remote/report.md" },
    summary: "检查报告",
  });
  assert.equal(tool.label, "读取文件：report.md");
  assert.equal(tool.description, "检查报告");
});
test("过程按工具类型展示动作与图标，使用可用摘要且不猜测被裁剪的调用", () => {
  assert.equal(toolPresentation({toolName: 'ToolSearch'}).label, '搜索工具');
  assert.equal(toolPresentation({toolName: 'ToolSearch'}).icon, 'search');
  const wrapper = toolPresentation({toolName: 'DeferExecuteTool', status: 'completed'});
  assert.equal(wrapper.label, '执行工具');
  assert.equal(wrapper.icon, 'wrench');
  assert.equal(wrapper.hasDetail, false);
  assert.equal(toolPresentation({toolName: 'mcp__workbuddy__reconnect_plugin'}).label, '重新授权连接器');
  assert.equal(toolPresentation({toolName: 'Read', summary: '/remote/notes/report.md'}).context, 'report.md');
  assert.equal(toolPresentation({toolName: 'unknown-tool'}).label, 'unknown-tool');
  assert.equal(toolPresentation({toolName: 'constructor'}).label, 'constructor');
});
