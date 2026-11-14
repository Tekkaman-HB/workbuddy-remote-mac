/**
 * [INPUT]: 依赖 Node test、jsdom 与实际 UI 模块。
 * [OUTPUT]: 验证安全富文本、顶部拖动排除控件、任务聚合与只读自动化展开/文件/执行会话及原有桥接流程。
 * [POS]: tests 的 UI 边界与集成回归，不访问用户账号。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
const dom = new JSDOM(await readFile(new URL("../ui/index.html", import.meta.url), "utf8"), {
  url: "https://local.invalid",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  CustomEvent: dom.window.CustomEvent,
  innerWidth: 1280,
  innerHeight: 770,
  localStorage: dom.window.localStorage,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
});
const { mergeRecords } = await import("../ui/state.js");
const { markdown, blocks, assistantReply } = await import("../ui/render.js");
test("历史重叠分页更新已有回复，保持旧记录和时间顺序", () => {
  const merged = mergeRecords(
    [
      { id: "b", requestSeq: 2, state: "running" },
      { id: "c", requestSeq: 3 },
    ],
    [
      { id: "a", requestSeq: 1 },
      { id: "b", requestSeq: 2, state: "completed" },
    ],
  );
  assert.deepEqual(
    merged.map((x) => x.id),
    ["a", "b", "c"],
  );
  assert.equal(merged[1].state, "completed");
  assert.deepEqual(
    mergeRecords(merged, [{ id: "a", requestSeq: 1 }], true).map((x) => x.id),
    ["a", "b", "c"],
  );
});
test("Markdown 支持表格、代码复制，并拒绝脚本和危险链接", () => {
  const rendered = markdown(
    '| 标题 | 内容 |\n|---|---|\n| A | B |\n\n```js\nconst a = 1;\n```\n<img src=x onerror="alert(1)"><script>alert(1)</script>[点击](javascript:alert(1))',
  );
  const holder = document.createElement("div");
  holder.innerHTML = rendered;
  assert.equal(holder.querySelectorAll("table").length, 1);
  assert.equal(holder.querySelector("code").textContent, "const a = 1;\n");
  assert.ok(holder.querySelector(".copy-code"));
  assert.equal(holder.querySelector("script"), null);
  assert.equal(holder.querySelector("[onerror]"), null);
  assert.equal(holder.querySelector('a[href^="javascript:"]'), null);
  assert.equal(holder.querySelector("img"), null);
});
test("工具和未知消息块以转义内容展示，不能注入界面按钮", () => {
  const html = blocks([
    { type: "tool_call", name: "<img src=x onerror=alert(1)>", result: '<button data-action="delete">x</button>' },
    { type: "image", uri: "file:///private/secret.png" },
  ]);
  const holder = document.createElement("div");
  holder.innerHTML = html;
  assert.ok(holder.querySelector("details"));
  assert.equal(holder.querySelector("button"), null);
  assert.equal(holder.querySelector("img"), null);
});
test("执行过程默认收起，正文独立可见，工具详情不能注入动作", () => {
  const holder = document.createElement("div");
  holder.innerHTML = assistantReply({
    state: "completed",
    timestamp: 1000,
    finishTimestamp: 72000,
    assistantMessage: [
      { type: "reasoning", messageId: "r", text: "内部过程" },
      {
        type: "tool",
        toolName: "Bash",
        toolCallId: "t",
        status: "completed",
        summary: "检查文件",
        output: '<button data-action="delete">删除</button>',
      },
      { type: "text", text: "**最终回复**" },
    ],
  });
  assert.equal(holder.querySelector(".execution-process").open, false);
  assert.match(holder.querySelector(".execution-process > summary").textContent, /已完成 1m11s/);
  assert.equal(holder.querySelector(".answer-content").textContent, "最终回复\n");
  assert.equal(holder.querySelector(".tool-card summary").textContent.includes("completed"), false);
  assert.equal(holder.querySelector("button"), null);
});
const until = async (predicate) => {
  for (let i = 0; i < 150; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("界面未进入预期状态");
};
test("实际页面按接口裁剪入口，支持新建续聊并保留失败草稿", async () => {
  const calls = [];
  let rejectSend = false;
  let supportAutomations = false;
  let olderAvailable = false, deferOlder = false, releaseOlder;
  let deferAutomation = false, releaseAutomation;
  const automation = {id: "daily", name: "每日测试", status: "ACTIVE", schedule: {type: "recurring", rrule: "FREQ=DAILY;BYHOUR=7;BYMINUTE=30"}, nextRunAt: Date.now() + 86400000};
  const automationRecord = {id: "auto-record", automationId: "daily", sessionId: "auto-session", startedAt: Date.now(), status: "success", summary: "**执行结果**"};
  let deferSend = false,
    releaseSend;
  const sessions = [{ id: "existing", title: "测试任务", state: "completed", updatedAt: Date.now() }];
  const records = [
    {
      id: "r1",
      requestSeq: 1,
      state: "completed",
      userMessage: { content: [{ type: "text", text: "测试问题" }] },
      assistantMessage: {
        content: [
          { type: "tool", toolName: "Bash", toolCallId: "stable-tool", summary: "检查测试记录", output: "OK" },
          { type: "text", text: "**测试回复**\n\n报告：`report.html`" },
        ],
      },
    },
  ];
  window.webkit = {
    messageHandlers: {
      native: {
        postMessage(message) {
          calls.push(message);
          let value;
          if (message.action === "ready") value = { preferredDevice: "host" };
          else if (message.action === "devices")
            value = {
              items: [{ deviceId: "host", displayName: "测试 Mac", onlineFlag: true, remoteViewFlag: 1 }],
              profile: { nickname: "测试用户" },
            };
          else if (message.action === "appearance") value = {theme: message.args.preference === "system" ? "dark" : message.args.theme};
          else if (message.action === "connect") value = { deviceId: "host" };
          else if (message.action === "rpc") {
            const { method, values } = message.args;
            if (method === "wb:connectors:list" || method === "wb:automations:list" && !supportAutomations)
              value = { errorCode: "METHOD_NOT_SUPPORTED", message: "测试设备不支持该方法" };
            else if (method === "wb:automations:list") value = [automation];
            else if (method === "wb:automations:listRecords") value = {items: [automationRecord], total: 1};
            else if (method === "wb:automations:getRecordDetail") value = {...automationRecord, runs: [{conversationId: "auto-session", output: "**执行结果**"}], artifacts: [{fileName: "report.html", size: 2048}]};
            else if (method === "wb:experts:list") value = { items: [{ id: "expert", name: "测试专家" }] };
            else if (method === "wb:skills:installed")
              value = { items: [{ id: "skill", name: "测试技能", description: "真实只读目录内容" }] };
            else if (method === "wb:artifacts:list") value = { items: [{ id: "artifact-report", title: "report.html", mimeType: "text/html" }] };
            else if (method === "wb:conversations:list") value = { items: sessions, total: sessions.length };
            else if (method === "wb:models:list")
              value = [
                { id: "model", name: "测试模型" },
                { id: "custom:personal", name: "Internal GPT", custom: true },
              ];
            else if (method === "wb:models:customs") value = { items: [{ id: "personal", name: "我的 GPT" }] };
            else if (method === "wb:workspaces:list")
              value = {
                items: [
                  { path: "/remote/work", name: "/remote/work" },
                  { path: "/remote/work2", name: "/remote/work2" },
                ],
              };
            else if (method === "wb:conversations:get")
              value = {
                info: sessions.find(x => x.id === values[0]),
                configManager: { model: "model", permissionMode: "fullAccess", mode: "craft" },
              };
            else if (method === "wb:conversations:requests")
              value = { items: values[0] === "existing" ? values[1]?.beforeRequestId ? [{id: "history-older", requestSeq: 0, assistantMessage: {content: [{type: "text", text: "更早的回复"}]}}] : records : [], hasOlder: olderAvailable && !values[1]?.beforeRequestId };
            else if (method === "wb:conversations:create") {
              const info = { id: "new-task", title: "新任务" };
              sessions.unshift(info);
              value = { info, configManager: { model: "model" } };
            } else if (method === "wb:conversations:sendPrompt")
              value = rejectSend ? { errorCode: "TEST_REJECTED", message: "测试拒绝" } : null;
          }
          const response = structuredClone(value ?? null);
          const complete = () => window.nativeReply({ id: message.id, value: response, error: null });
          if (deferOlder && message.args?.method === "wb:conversations:requests" && message.args.values[1]?.beforeRequestId) releaseOlder = complete;
          else if (deferAutomation && message.args?.method === "wb:automations:listRecords") releaseAutomation = complete;
          else if (deferSend && message.args?.method === "wb:conversations:sendPrompt") releaseSend = complete;
          else queueMicrotask(complete);
        },
      },
    },
  };
  const originalInterval = globalThis.setInterval;
  const intervals = [];
  globalThis.setInterval = (...args) => {
    const handle = originalInterval(...args);
    intervals.push(handle);
    return handle;
  };
  try {
    await import("../ui/app.js");
    await until(
      () => document.body.classList.contains("connected") && document.querySelector('[data-session="existing"]'),
    );
    const { state: pageState } = await import("../ui/state.js");
    await until(() => !pageState.connecting);
    document.querySelector("#titlebar").dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await until(() => calls.some(c => c.action === "dragWindow"));
    const drags = calls.filter(c => c.action === "dragWindow").length;
    document.querySelector('[data-action="search"]').dispatchEvent(new dom.window.MouseEvent("mousedown", {bubbles: true, button: 0}));
    document.querySelector("#titlebar").dispatchEvent(new dom.window.MouseEvent("mousedown", {bubbles: true, button: 2}));
    assert.equal(calls.filter(c => c.action === "dragWindow").length, drags);
    assert.equal(document.querySelector('[data-action="assistant"]'), null);
    assert.equal(document.querySelector('[data-action="library"]'), null);
    assert.equal(document.querySelector('[data-action="voice"]'), null);
    assert.equal(document.querySelector('[data-action="notifications"]'), null);
    assert.equal(document.querySelector('[data-action="automations"]'), null);
    assert.equal(document.querySelector('[data-action="catalog"]').textContent, "专家·技能");
    document.querySelector('[data-action="plus"]').click();
    await until(() => !document.querySelector("#popover").hidden);
    assert.equal(document.querySelector('[data-command="attachment"]'), null);
    assert.equal(document.querySelector('[data-command="connectors"]'), null);
    const panels = await import("../ui/panels.js");
    panels.closePopover({ immediate: true });
    document.querySelector("#model-button").click();
    await until(
      () =>
        document.querySelector("#model-options") &&
        document.querySelector("#model-options").getAttribute("aria-busy") === "false",
    );
    assert.ok(document.querySelector("#model-options").textContent.includes("自定义模型"));
    assert.equal(document.querySelector("#popover input"), null);
    document.querySelector('[data-command="chooseModel"]').click();
    await until(() => pageState.config.model === "custom:personal");
    assert.equal(document.querySelector("#model-button .control-label").textContent, "我的 GPT · 自定义");
    pageState.config = {};
    pageState.draftConfig = {};
    panels.closePopover({ immediate: true });
    document.querySelector("#workspace-button").click();
    await until(() => document.querySelector("#workspace-options"));
    const workspaceSearch = document.querySelector(".menu-search");
    workspaceSearch.value = "work2";
    workspaceSearch.dispatchEvent(new dom.window.Event("input"));
    assert.equal(document.querySelector("#workspace-options strong").textContent, "work2");
    assert.equal(document.querySelector("#workspace-options button").title, "/remote/work2");
    document.querySelector("#workspace-options button").click();
    await until(() => pageState.workspace?.path === "/remote/work2");
    assert.equal(pageState.workspace.path, "/remote/work2");
    pageState.workspace = null;
    panels.closePopover({ immediate: true });
    panels.settings();
    const sections = [...document.querySelectorAll("[data-settings-section]")].map((el) => el.dataset.settingsSection);
    assert.deepEqual(sections, ["通用", "外观", "快捷键", "模型", "设备连接"]);
    const settingsSearch = document.querySelector("#settings-search");
    panels.settings("外观");
    assert.equal(document.querySelector("#settings-search"), settingsSearch);
    const themeSelect = document.querySelector('#theme-select');
    themeSelect.value = 'dark';
    themeSelect.dispatchEvent(new dom.window.Event('change'));
    await until(() => calls.some(c => c.action === 'appearance' && c.args.theme === 'dark'));
    assert.equal(document.documentElement.dataset.theme, 'dark');
    themeSelect.value = 'light';
    themeSelect.dispatchEvent(new dom.window.Event('change'));
    await until(() => calls.filter(c => c.action === 'appearance').at(-1)?.args.theme === 'light');
    assert.equal(document.documentElement.dataset.theme, 'light');
    themeSelect.value = 'system';
    themeSelect.dispatchEvent(new dom.window.Event('change'));
    await until(() => document.documentElement.dataset.theme === 'dark');
    assert.equal(calls.filter(c => c.action === 'appearance').at(-1).args.preference, 'system');
    panels.closeModal();
    await panels.catalog("skills");
    assert.ok(document.querySelector("article.catalog-card"));
    assert.equal(document.querySelector('[data-catalog-type="skills"]'), null);
    assert.equal(document.querySelector('[data-catalog-tab="connectors"]'), null);
    panels.closeModal();
    document.querySelector('[data-session="existing"]').click();
    await until(() => document.querySelector(".assistant-message strong")?.textContent === "测试回复");
    assert.match(document.querySelector(".permission").textContent, /允许完全访问/);
    document.querySelector('[data-artifact-name="report.html"]').click();
    await until(() => calls.some(c => c.action === "artifactOpen"));
    assert.deepEqual(calls.find(c => c.action === "artifactOpen").args, {conversationId: "existing", artifactId: "artifact-report"});
    assert.equal(calls.some(c => c.args?.method === "wb:artifacts:locate"), false);
    window.nativeEvent({type: "artifactPreview", data: {open: true}});
    assert.equal(document.body.classList.contains("collapsed"), true);
    window.nativeEvent({type: "artifactPreview", data: {open: false}});
    assert.equal(document.body.classList.contains("collapsed"), false);
    const originalMessage = document.querySelector(".assistant-message strong");
    const { loadHistory, loadSessions } = await import("../ui/controller.js");
    olderAvailable = true;
    await loadHistory(false, true);
    const historyScroll = document.querySelector("#messages-scroll");
    Object.defineProperty(historyScroll, "scrollHeight", {configurable: true, get: () => 1200 + (document.querySelector('[data-request="history-older"]') ? 500 : 0)});
    Object.defineProperty(historyScroll, "clientHeight", {configurable: true, value: 700});
    historyScroll.scrollTop = 0;
    deferOlder = true;
    const beforeOlder = calls.filter(c => c.args?.method === "wb:conversations:requests" && c.args.values[1]?.beforeRequestId).length;
    historyScroll.dispatchEvent(new dom.window.Event("scroll"));
    historyScroll.dispatchEvent(new dom.window.Event("scroll"));
    await until(() => releaseOlder);
    assert.equal(calls.filter(c => c.args?.method === "wb:conversations:requests" && c.args.values[1]?.beforeRequestId).length, beforeOlder + 1);
    releaseOlder();
    await until(() => document.querySelector('[data-request="history-older"]') && !pageState.loadingOlder);
    assert.equal(historyScroll.scrollTop, 500);
    assert.equal(document.querySelector('button[data-action="older"]'), null);
    assert.match(document.querySelector(".history-edge").textContent, /最早/);
    olderAvailable = false;
    deferOlder = false;
    await loadHistory(false, true);
    assert.equal(document.querySelector(".assistant-message strong"), originalMessage);
    document.querySelector(".execution-process").open = true;
    document.querySelector('[data-detail-key="process:stable-tool"]').open = true;
    records[0].assistantMessage.content.unshift({
      type: "reasoning",
      messageId: "late-thought",
      text: "后到达的过程块",
    });
    await loadHistory(false, true);
    assert.equal(document.querySelector(".execution-process").open, true);
    assert.equal(document.querySelector('[data-detail-key="process:stable-tool"]').open, true);
    assert.equal(document.querySelector(".thinking").open, false);

    sessions[0].title = "远端更新后的标题";
    await loadSessions();
    assert.equal(document.querySelector("#conversation-title").textContent, "远端更新后的标题");
    document.querySelector('[data-action="new"]').click();
    await until(() => !document.querySelector("#home").hidden);
    assert.match(document.querySelector("#model-button").textContent, /选择模型/);
    const input = document.querySelector("#prompt");
    input.value = "隔离测试消息";
    input.dispatchEvent(new dom.window.Event("input"));
    document.querySelector('[data-action="send"]').click();
    await until(() => calls.some((c) => c.args?.method === "wb:conversations:sendPrompt") && input.value === "");
    assert.equal(calls.find((c) => c.args?.method === "wb:conversations:create").args.values[0].transport, undefined);
    assert.deepEqual(calls.find((c) => c.args?.method === "wb:conversations:sendPrompt").args.values.slice(0, 2), [
      "new-task",
      [{ type: "text", text: "隔离测试消息" }],
    ]);
    assert.equal(
      calls.some((c) => c.args?.method === "wb:conversations:configSetPermissionMode"),
      false,
    );
    rejectSend = true;
    input.value = "应保留的草稿";
    input.dispatchEvent(new dom.window.Event("input"));
    document.querySelector('[data-action="send"]').click();
    await until(() => document.querySelector("#toast").textContent.includes("测试拒绝"));
    assert.equal(input.value, "应保留的草稿");
    rejectSend = false;
    deferSend = true;
    input.value = "慢速确认的消息";
    input.dispatchEvent(new dom.window.Event("input"));
    document.querySelector('[data-action="send"]').click();
    await until(() => releaseSend);
    input.value = "确认期间继续输入的新草稿";
    input.dispatchEvent(new dom.window.Event("input"));
    releaseSend();
    const { state } = await import("../ui/state.js");
    await until(() => !state.sending);
    assert.equal(input.value, "确认期间继续输入的新草稿");
    supportAutomations = true;
    sessions.push({id: "auto-session", title: "每日测试", isBackgroundAutomation: true, tags: {automationId: "daily"}, lastActivityAt: Date.now()});
    sessions.push({id: "auto-older", title: "每日测试", isBackgroundAutomation: true, tags: {automationId: "daily"}, lastActivityAt: Date.now() - 86400000});
    pageState.features.automations = true;
    await loadSessions();
    assert.equal(document.querySelectorAll('[data-session="automation:daily"]').length, 1);
    assert.equal(document.querySelector('[data-session="auto-older"]'), null);
    document.querySelector('[data-session="automation:daily"]').click();
    await until(() => document.querySelector(".automation-run strong")?.textContent === "执行结果");
    assert.equal(document.querySelector("#composer-wrap").hidden, true);
    assert.equal(document.querySelector("#conversation-schedule").textContent, "每天 07:30");
    const expand = document.querySelector('[data-action="expandAutomationRecord"]');
    expand.click();
    await until(() => document.querySelector('[data-action="expandAutomationRecord"]').getAttribute("aria-expanded") === "true");
    await loadHistory(false, true);
    assert.equal(document.querySelector('[data-action="expandAutomationRecord"]').getAttribute("aria-expanded"), "true");
    document.querySelector('[data-action="automationFile"]').click();
    await until(() => calls.some(c => c.action === "artifactOpen" && c.args.conversationId === "auto-session"));
    const sent = calls.filter(c => c.args?.method === "wb:conversations:sendPrompt").length;
    const {send} = await import("../ui/controller.js");
    await send();
    assert.equal(calls.filter(c => c.args?.method === "wb:conversations:sendPrompt").length, sent);
    document.querySelector('[data-action="openAutomationConversation"]').click();
    await until(() => pageState.session?.id === "auto-session" && !pageState.loading);
    assert.equal(pageState.automation, null);
    assert.equal(document.querySelector("#composer-wrap").hidden, false);
    deferAutomation = true;
    document.querySelector('[data-session="automation:daily"]').click();
    await until(() => releaseAutomation);
    document.querySelector('[data-session="existing"]').click();
    await until(() => pageState.session?.id === "existing" && !pageState.loading);
    releaseAutomation();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(pageState.automation, null);
    assert.equal(pageState.session.id, "existing");
    assert.equal(document.querySelector(".assistant-message strong").textContent, "测试回复");
    assert.ok(calls.filter((c) => c.action === "rpc").every((c) => !c.args.method.includes("cloud")));
  } finally {
    intervals.forEach(clearInterval);
    globalThis.setInterval = originalInterval;
  }
});
