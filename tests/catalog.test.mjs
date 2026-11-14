/**
 * [INPUT]: 依赖 Node test 与实际 catalog.js。
 * [OUTPUT]: 验证多语言目录名称/说明、自定义模型 ID、禁用状态与工作空间名称。
 * [POS]: tests 的目录归一回归，防止展示名称替代真实远端选择 ID。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mergeModels, workspaceName, workspacePath, workspaceHint, catalogText, catalogName, catalogDescription } from "../ui/catalog.js";
test("目录多语言字段优先中文并回退英文，未知对象不显示为 Object", () => {
  assert.equal(catalogName({id: "raw", name: {zh: "中文专家", en: "English"}}), "中文专家");
  assert.equal(catalogName({name: "raw", displayName: {en: "Display"}}), "Display");
  assert.equal(catalogDescription({description: {zh: "说明", en: "Description"}}), "说明");
  assert.equal(catalogDescription({displayDescription: {en: "Display description"}}), "Display description");
  assert.equal(catalogName({id: "valid-id", name: {unexpected: "未知形状"}}), "valid-id");
  assert.equal(catalogText({zh: 123}), "");
  assert.equal(catalogText(null), "");
});
test("自定义模型名称合并到已发布的真实 ID，不生成重复选项", () => {
  const models = mergeModels(
    [{ id: "custom:my-gpt", name: "my-gpt", custom: true }],
    [{ id: "my-gpt", name: "我的模型" }],
  );
  assert.equal(models.length, 1);
  assert.equal(models[0].id, "custom:my-gpt");
  assert.equal(models[0].name, "我的模型");
  assert.equal(models[0].disabled, false);
  const shared = mergeModels(
    [
      { id: "glm", name: "内置 GLM" },
      { id: "custom-local:glm", name: "glm", custom: true },
    ],
    [{ id: "glm", name: "自定义 GLM" }],
  );
  assert.equal(shared.length, 2);
  assert.equal(shared.find((m) => m.id === "glm").custom, false);
  assert.equal(shared.find((m) => m.id === "custom-local:glm").name, "自定义 GLM");
});
test("自定义配置未发布时不可选，不猜测可调用 ID", () => {
  const [model] = mergeModels([], [{ id: "offline", name: "本地模型" }]);
  assert.equal(model.id, "offline");
  assert.equal(model.disabled, true);
  assert.equal(model.custom, true);
});
test("合并不覆盖远端禁用状态，并识别本地自定义 ID", () => {
  const [model] = mergeModels(
    [{ id: "custom-local:llama", disabled: true, disabledReason: "设备未就绪" }],
    [{ id: "custom-local:llama" }],
  );
  assert.equal(model.custom, true);
  assert.equal(model.disabled, true);
  assert.equal(model.disabledReason, "设备未就绪");
});
test("共同前缀和尾部斜杠不影响目录区分，保留自定义名称及完整路径", () => {
  assert.equal(
    workspaceName({ name: "/Users/demo/WorkBuddy/2026-11-13-12-00/", path: "/Users/demo/WorkBuddy/2026-11-13-12-00/" }),
    "2026-11-13-12-00",
  );
  assert.equal(workspaceName({ label: "产品设计", path: "/remote/project" }), "产品设计");
  assert.equal(workspacePath({ name: "/remote/project" }), "/remote/project");
  assert.equal(workspaceHint({ path: "/Users/demo/WorkBuddy/task" }), "…/WorkBuddy/task");
});
