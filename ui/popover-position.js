/**
 * [INPUT]: 依赖锚点矩形、内容高度和可用视口尺寸。
 * [OUTPUT]: 受视口约束的菜单坐标、宽高及展开方向。
 * [POS]: UI 弹层的纯布局计算，由 panels 在内容/尺寸变化后复用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export function popoverBounds(anchor, contentHeight, viewport, requestedWidth, limit = 360) {
  const edge = 12, gap = 8;
  const width = Math.min(requestedWidth, Math.max(0, viewport.width - edge * 2));
  const above = Math.max(0, anchor.top - gap - edge);
  const below = Math.max(0, viewport.height - anchor.bottom - gap - edge);
  const desired = Math.min(contentHeight, limit);
  const placement = below >= desired || below >= above ? 'below' : 'above';
  const maxHeight = Math.min(limit, placement === 'above' ? above : below);
  const height = Math.min(contentHeight, maxHeight);
  return {
    width, maxHeight, placement,
    left: Math.max(edge, Math.min(anchor.right - width, viewport.width - width - edge)),
    top: Math.max(edge, Math.min(placement === 'above' ? anchor.top - gap - height : anchor.bottom + gap, viewport.height - height - edge)),
  };
}
