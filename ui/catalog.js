/**
 * [INPUT]: 依赖远端模型目录、脱敏自定义模型元数据与工作空间对象。
 * [OUTPUT]: 提供模型合并、显示名称、工作空间名称、完整路径及精简路径。
 * [POS]: UI 目录的展示边界，被 controller、panels 和 view 共享。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export const modelId = (model) => model.id ?? model.model ?? model.key;
export const modelName = (model) => model.name || model.label || model.displayName || modelId(model);
const isCustom = (m) =>
  m.custom === true ||
  m.trustLevel === "custom" ||
  m.tags?.includes("custom") === true ||
  String(modelId(m)).startsWith("custom:") ||
  String(modelId(m)).startsWith("custom-local:");
export function mergeModels(published, customs) {
  const models = new Map(published.filter((m) => modelId(m)).map((m) => [modelId(m), { ...m }]));
  for (const custom of customs) {
    const raw = modelId(custom);
    if (!raw) continue;
    // -- 使用已发布的真实 ID；不替远端猜测 custom: 前缀 --
    const existing = [models.get(`custom-local:${raw}`), models.get(`custom:${raw}`), models.get(raw)].find(
      (m) => m && isCustom(m),
    );
    // -- 内置模型与原始配置可能重名；不能把内置条目标为自定义 --
    if (!existing && models.has(raw)) continue;
    const id = existing ? modelId(existing) : raw;
    models.set(id, {
      ...custom,
      ...existing,
      id,
      custom: true,
      name: custom.name || custom.label || existing?.name || raw,
      disabled: existing ? existing.disabled === true : true,
      disabledReason: existing?.disabledReason || (!existing ? "远端尚未发布此模型" : ""),
    });
  }
  return [...models.values()].map((m) => ({ ...m, custom: isCustom(m) }));
}
export function workspacePath(workspace) {
  return workspace?.path || workspace?.cwd || (workspace?.name?.startsWith("/") ? workspace.name : "");
}
export function workspaceName(workspace) {
  if (!workspace) return "选择工作空间";
  const path = workspacePath(workspace).replace(/\/+$/, "");
  const label = workspace.label || workspace.name;
  return label && !label.includes("/") ? label : path.split("/").filter(Boolean).at(-1) || "工作空间";
}

export function workspaceHint(workspace) {
  const path = workspacePath(workspace).replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);
  return parts.length > 3 ? "…/" + parts.slice(-2).join("/") : path;
}
