/**
 * [INPUT]: 依赖 Node test、jsdom 与实际 UI 模块。
 * [OUTPUT]: 验证过程真实详情与安全性、历史分页/阅读位置、执行详情并发/错误恢复及二级页和桥接流程。
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
test("精简过程行保留真实内容，无详情不显示空折叠，思考和工具详情安全展示", () => {
  const holder = document.createElement('div');
  holder.innerHTML = blocks([
    {type: 'reasoning', text: '**检查方案**'},
    {type: 'tool', toolName: 'ToolSearch', toolCallId: 'no-detail', status: 'completed'},
    {type: 'tool', toolName: 'Read', input: {file_path: '/remote/a.md'}, output: '<button>危险按钮</button>', status: 'failed'},
  ]);
  assert.equal(holder.querySelector('.thinking summary > .icon:not(.detail-chevron)'), null);
  assert.equal(holder.querySelector('.thought-content strong').textContent, '检查方案');
  assert.equal(holder.querySelector('[data-detail-key="block:no-detail"]').tagName, 'DIV');
  assert.equal(holder.querySelector('[data-detail-key="block:no-detail"] .detail-chevron'), null);
  assert.equal(holder.querySelector('.tool-error').textContent, '失败');
  const data = JSON.parse(holder.querySelector('.tool-content pre').textContent);
  assert.equal(data.parameters.file_path, '/remote/a.md');
  assert.equal(data.result, '<button>危险按钮</button>');
  assert.equal(holder.querySelector('button'), null);
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
  let olderAvailable = false, deferOlder = false, releaseOlder, rejectOlder = false;
  let deferRefresh = false, releaseRefresh, automationPagination = false;
  let deferAutomation = false, releaseAutomation;
  let rejectAutomation = false, activeDetails = 0, peakDetails = 0;
  const automation = {id: "daily", name: "每日测试", status: "ACTIVE", schedule: {type: "recurring", rrule: "FREQ=DAILY;BYHOUR=7;BYMINUTE=30"}, nextRunAt: Date.now() + 86400000};
  const automationRecord = {id: "auto-record", automationId: "daily", sessionId: "auto-session", startedAt: Date.now(), status: "success", summary: "**执行结果**"};
  const automationRecords = Array.from({length: 11}, (_, i) => ({...automationRecord, id: i ? `auto-record-${i}` : automationRecord.id, startedAt: automationRecord.startedAt - i * 86400000}));
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
            else if (method === "wb:automations:listRecords") value = rejectAutomation ? {errorCode:'PUBLISH_NETWORK_FAILED',message:'PUBLISH_NETWORK_FAILED'} : automationPagination ? {items: automationRecords.slice(0, values[0].limit), total: 11} : {items: [automationRecord], total: 1};
            else if (method === "wb:automations:getRecordDetail") {
              activeDetails++; peakDetails=Math.max(peakDetails,activeDetails);
              value = {...automationRecords.find(x => x.id === values[0]), runs: [{conversationId: "auto-session", output: "**执行结果**"}], artifacts: [{fileName: "report.html", size: 2048}]};
            }
            else if (method === "wb:experts:list") value = { items: [{ id: "expert", name: {zh: "测试专家", en: "Test expert"}, description: {zh: "真实专家说明"} }] };
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
              value = rejectOlder && values[1]?.beforeRequestId ? {errorCode: "TEST_HISTORY", message: "历史读取失败"} : { items: values[0] === "existing" ? values[1]?.beforeRequestId ? [{id: "history-older", requestSeq: 0, assistantMessage: {content: [{type: "text", text: "更早的回复"}]}}] : records : [], hasOlder: olderAvailable && !values[1]?.beforeRequestId };
            else if (method === "wb:conversations:create") {
              const info = { id: "new-task", title: "新任务" };
              sessions.unshift(info);
              value = { info, configManager: { model: "model" } };
            } else if (method === "wb:conversations:sendPrompt")
              value = rejectSend ? { errorCode: "TEST_REJECTED", message: "测试拒绝" } : null;
          }
          const response = structuredClone(value ?? null);
          const complete = () => {
            if(message.args?.method==='wb:automations:getRecordDetail') activeDetails--;
            window.nativeReply({ id: message.id, value: response, error: null });
          };
          if (deferOlder && message.args?.method === "wb:conversations:requests" && message.args.values[1]?.beforeRequestId) releaseOlder = complete;
          else if (deferRefresh && message.args?.method === "wb:conversations:requests") releaseRefresh = complete;
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
    document.querySelector('[data-model-id="custom:personal"]').click();
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
    assert.ok(document.querySelector("#font-size"));
    assert.ok(document.querySelector('[data-settings-section="通用"] .icon'));
    settingsSearch.value = "设备";
    settingsSearch.dispatchEvent(new dom.window.Event("input"));
    assert.equal(document.querySelectorAll('.settings-group:not([hidden])').length, 1);
    assert.equal(document.querySelector('[data-settings-section="通用"]').hidden, true);
    settingsSearch.value = "";
    settingsSearch.dispatchEvent(new dom.window.Event("input"));
    panels.settings("外观");
    assert.equal(document.querySelector("#settings-search"), settingsSearch);
    assert.equal(document.querySelectorAll('[data-theme-choice]').length, 3);
    document.querySelector('[data-theme-choice="dark"]').click();
    await until(() => calls.some(c => c.action === 'appearance' && c.args.theme === 'dark'));
    assert.equal(document.documentElement.dataset.theme, 'dark');
    assert.equal(document.querySelector('[data-theme-choice="dark"]').getAttribute('aria-pressed'), 'true');
    document.querySelector('[data-theme-choice="light"]').click();
    await until(() => calls.filter(c => c.action === 'appearance').at(-1)?.args.theme === 'light');
    assert.equal(document.documentElement.dataset.theme, 'light');
    document.querySelector('[data-theme-choice="system"]').click();
    await until(() => document.documentElement.dataset.theme === 'dark');
    assert.equal(calls.filter(c => c.action === 'appearance').at(-1).args.preference, 'system');
    panels.settings("快捷键");
    const shortcuts = document.querySelector('#shortcut-search');
    shortcuts.value = '换行';
    shortcuts.dispatchEvent(new dom.window.Event('input'));
    assert.equal(document.querySelectorAll('.shortcut-table tbody tr:not([hidden])').length, 1);
    panels.closeModal();
    panels.searchDialog();
    assert.match(document.querySelector('.search-empty').textContent, /输入关键字/);
    const search = document.querySelector('#search-input');
    search.value = '测试'; search.dispatchEvent(new dom.window.Event('input'));
    assert.equal(document.querySelector('.search-result strong').textContent, '测试任务');
    search.dispatchEvent(new dom.window.KeyboardEvent('keydown', {bubbles: true, key: 'ArrowDown'}));
    assert.equal(document.activeElement, document.querySelector('.search-result'));
    document.querySelector('[data-search-tab="空间"]').click();
    assert.match(document.querySelector('.search-empty').textContent, /没有找到/);
    document.querySelector('#search-clear').click();
    assert.equal(search.value, '');
    assert.equal(document.activeElement, search);
    document.querySelector('[data-search-tab="全部"]').dispatchEvent(new dom.window.KeyboardEvent('keydown', {bubbles: true, key: 'End'}));
    assert.equal(document.querySelector('[aria-selected="true"]').dataset.searchTab, '空间');
    panels.closeModal();
    await panels.catalog("skills");
    assert.ok(document.querySelector('.catalog-page'));
    assert.equal(document.querySelector('.catalog-page').getAttribute('role'), 'region');
    assert.equal(document.querySelector('.catalog-page').hasAttribute('aria-modal'), false);
    const catalogDragCount = calls.filter(c => c.action === "dragWindow").length;
    document.querySelector('.catalog-header').dispatchEvent(new dom.window.MouseEvent('mousedown', {bubbles: true, button: 0}));
    await until(() => calls.filter(c => c.action === "dragWindow").length === catalogDragCount + 1);
    document.querySelector('#catalog-search').dispatchEvent(new dom.window.MouseEvent('mousedown', {bubbles: true, button: 0}));
    assert.equal(calls.filter(c => c.action === "dragWindow").length, catalogDragCount + 1);
    const catalogTab = new dom.window.KeyboardEvent('keydown', {bubbles: true, cancelable: true, key: 'Tab'});
    document.querySelector('.catalog-header').dispatchEvent(catalogTab);
    assert.equal(catalogTab.defaultPrevented, false);
    assert.ok(document.querySelector("article.catalog-card"));
    assert.equal(document.querySelector('[data-catalog-type="skills"]'), null);
    assert.equal(document.querySelector('[data-catalog-tab="connectors"]'), null);
    const catalogSearch = document.querySelector('#catalog-search');
    catalogSearch.value = '无匹配'; catalogSearch.dispatchEvent(new dom.window.Event('input'));
    assert.equal(document.querySelector('article.catalog-card'), null);
    assert.match(document.querySelector('.catalog-grid').textContent, /没有匹配/);
    await panels.catalog("experts");
    assert.equal(document.querySelector('.catalog-card strong').textContent, '测试专家');
    assert.equal(document.querySelector('.catalog-card p').textContent, '真实专家说明');
    assert.equal(document.querySelector('.catalog-grid').textContent.includes('[object Object]'), false);
    pageState.config.expertId = 'expert';
    const {updateComposer} = await import('../ui/view.js');
    updateComposer();
    assert.equal(document.querySelector('.context-chip[data-action="expert"]').textContent, '测试专家');
    delete pageState.config.expertId;
    document.querySelector('[data-action="new"]').click();
    await until(() => document.querySelector('#modal-layer').hidden || document.querySelector('#modal-layer').inert);
    assert.equal(pageState.view, 'home');
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

    // 后台轮询占用时记住一次到顶意图；失败停止自动重试，上滑才重试。
    document.querySelector('[data-session="existing"]').click();
    await until(() => !pageState.loading);
    olderAvailable = true;
    await loadHistory(false, true);
    deferRefresh = true;
    const refresh = loadHistory();
    await until(() => releaseRefresh);
    historyScroll.scrollTop = 0;
    rejectOlder = true;
    const countOlder = () => calls.filter(c => c.args?.method === "wb:conversations:requests" && c.args.values[1]?.beforeRequestId).length;
    const queuedCount = countOlder();
    historyScroll.dispatchEvent(new dom.window.Event("scroll"));
    historyScroll.dispatchEvent(new dom.window.Event("scroll"));
    assert.equal(countOlder(), queuedCount);
    deferRefresh = false;
    releaseRefresh();
    await refresh;
    await until(() => pageState.olderError && !pageState.loadingOlder);
    assert.equal(countOlder(), queuedCount + 1);
    historyScroll.dispatchEvent(new dom.window.Event("scroll"));
    assert.equal(countOlder(), queuedCount + 1);
    assert.match(document.querySelector(".history-edge").textContent, /失败/);
    rejectOlder = false;
    historyScroll.scrollTop = 0;
    historyScroll.dispatchEvent(new dom.window.WheelEvent("wheel", {deltaY: -10}));
    await until(() => !pageState.olderError && !pageState.loadingOlder && !pageState.hasOlder);
    assert.equal(countOlder(), queuedCount + 2);
    historyScroll.scrollTop = 0;
    historyScroll.dispatchEvent(new dom.window.WheelEvent("wheel", {deltaY: -10}));
    assert.equal(countOlder(), queuedCount + 2);
    olderAvailable = false;

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
    automationPagination = true;
    peakDetails = 0;
    await loadHistory(false, true);
    assert.equal(pageState.records.length, 10);
    assert.ok(peakDetails <= 3, '明细读取限制突发请求');
    Object.defineProperty(historyScroll, "scrollHeight", {configurable: true, get: () => 300 + (document.querySelector('[data-automation-record="auto-record-10"]') ? 500 : 0)});
    Object.defineProperty(historyScroll, "clientHeight", {configurable: true, value: 400});
    historyScroll.scrollTop = 0;
    const autoBefore = calls.filter(c => c.args?.method === "wb:automations:listRecords").length;
    historyScroll.dispatchEvent(new dom.window.WheelEvent("wheel", {deltaY: -10}));
    historyScroll.dispatchEvent(new dom.window.Event("scroll"));
    await until(() => pageState.records.length === 11 && !pageState.loadingOlder);
    assert.equal(calls.filter(c => c.args?.method === "wb:automations:listRecords").length, autoBefore + 1);
    assert.equal(historyScroll.scrollTop, 500);
    assert.equal(pageState.hasOlder, false);
    assert.equal(document.querySelector('button[data-action="older"]'), null);
    assert.equal(document.querySelector('[data-action="expandAutomationRecord"][data-record="auto-record"]').getAttribute("aria-expanded"), "true");
    rejectAutomation = true;
    await loadHistory(false, true);
    assert.equal(pageState.records.length, 11);
    assert.match(document.querySelector('#connection-banner').textContent, /网络/);
    rejectAutomation = false;
    await loadHistory(false, true);
    assert.equal(document.querySelector('#connection-banner').hidden, true, '读取恢复后移除旧错误提示');
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
    deferAutomation = false;
    rejectAutomation = true;
    document.querySelector('[data-session="automation:daily"]').click();
    await until(() => !pageState.loading && pageState.historyError);
    assert.equal(pageState.records.length, 0);
    assert.equal(document.querySelector('#messages').textContent.includes('暂无执行记录'), false);
    assert.ok(document.querySelector('#messages [data-action="refreshAutomation"]'));
    rejectAutomation = false;
    document.querySelector('#messages [data-action="refreshAutomation"]').click();
    await until(() => pageState.records.length && !pageState.historyError);
    assert.equal(document.querySelector('#connection-banner').hidden, true);
    assert.ok(calls.filter((c) => c.action === "rpc").every((c) => !c.args.method.includes("cloud")));
  } finally {
    intervals.forEach(clearInterval);
    globalThis.setInterval = originalInterval;
  }
});
