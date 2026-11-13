/**
 * [INPUT]: 依赖 Node test、jsdom 与实际 UI 模块。
 * [OUTPUT]: 验证历史合并、安全富文本及原生桥的真实点击流程。
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
const { markdown, blocks } = await import("../ui/render.js");
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
  let deferSend = false,
    releaseSend;
  const sessions = [{ id: "existing", title: "测试任务", state: "completed", updatedAt: Date.now() }];
  const records = [
    {
      id: "r1",
      requestSeq: 1,
      state: "completed",
      userMessage: { content: [{ type: "text", text: "测试问题" }] },
      assistantMessage: { content: [{ type: "text", text: "**测试回复**" }] },
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
          else if (message.action === "connect") value = { deviceId: "host" };
          else if (message.action === "rpc") {
            const { method, values } = message.args;
            if (["wb:connectors:list", "wb:automations:list"].includes(method))
              value = { errorCode: "METHOD_NOT_SUPPORTED", message: "测试设备不支持该方法" };
            else if (method === "wb:experts:list") value = { items: [{ id: "expert", name: "测试专家" }] };
            else if (method === "wb:skills:installed")
              value = { items: [{ id: "skill", name: "测试技能", description: "真实只读目录内容" }] };
            else if (method === "wb:artifacts:list") value = { items: [] };
            else if (method === "wb:conversations:list") value = { items: sessions, total: sessions.length };
            else if (method === "wb:models:list") value = [{ id: "model", name: "测试模型" }];
            else if (method === "wb:workspaces:list") value = { items: [{ path: "/remote/work", name: "远端空间" }] };
            else if (method === "wb:conversations:get")
              value = {
                info: sessions[0],
                configManager: { model: "model", permissionMode: "fullAccess", mode: "craft" },
              };
            else if (method === "wb:conversations:requests")
              value = { items: values[0] === "existing" ? records : [], hasOlder: false };
            else if (method === "wb:conversations:create") {
              const info = { id: "new-task", title: "新任务" };
              sessions.unshift(info);
              value = { info, configManager: { model: "model" } };
            } else if (method === "wb:conversations:sendPrompt")
              value = rejectSend ? { errorCode: "TEST_REJECTED", message: "测试拒绝" } : null;
          }
          const response = structuredClone(value ?? null);
          const complete = () => window.nativeReply({ id: message.id, value: response, error: null });
          if (deferSend && message.args?.method === "wb:conversations:sendPrompt") releaseSend = complete;
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
    panels.closePopover();
    panels.settings();
    const sections = [...document.querySelectorAll("[data-settings-section]")].map((el) => el.dataset.settingsSection);
    assert.deepEqual(sections, ["通用", "外观", "快捷键", "模型", "设备连接"]);
    panels.closeModal();
    await panels.catalog("skills");
    assert.ok(document.querySelector("article.catalog-card"));
    assert.equal(document.querySelector('[data-catalog-type="skills"]'), null);
    assert.equal(document.querySelector('[data-catalog-tab="connectors"]'), null);
    panels.closeModal();
    document.querySelector('[data-session="existing"]').click();
    await until(() => document.querySelector(".assistant-message strong")?.textContent === "测试回复");
    assert.match(document.querySelector(".permission").textContent, /允许完全访问/);
    const originalMessage = document.querySelector(".assistant-message strong");
    const { loadHistory, loadSessions } = await import("../ui/controller.js");
    await loadHistory(false, true);
    assert.equal(document.querySelector(".assistant-message strong"), originalMessage);
    sessions[0].title = "远端更新后的标题";
    await loadSessions();
    assert.equal(document.querySelector("#conversation-title").textContent, "远端更新后的标题");
    document.querySelector('[data-action="new"]').click();
    await until(() => !document.querySelector("#home").hidden);
    assert.match(document.querySelector("#model-button").textContent, /远端默认模型/);
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
    assert.ok(calls.filter((c) => c.action === "rpc").every((c) => !c.args.method.includes("cloud")));
  } finally {
    intervals.forEach(clearInterval);
    globalThis.setInterval = originalInterval;
  }
});
