/**
 * [INPUT]: 无外部依赖。
 * [OUTPUT]: 自绘 SVG 图标与按钮图标填充。
 * [POS]: UI 的统一线性图标字典。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const paths = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  new: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/>',
  search: '<circle cx="10.7" cy="10.7" r="6.7"/><path d="m16 16 4.5 4.5"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
  rightPanel: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/>',
  owl: '<path d="m5 4 4 2h6l4-2v10a7 7 0 0 1-14 0Z"/><circle cx="9" cy="11" r="2"/><circle cx="15" cy="11" r="2"/><path d="m10 16 2 2 2-2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M14 17.5h7M17.5 14v7"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  folder: '<path d="M3 8V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10H3Z"/>',
  book: '<path d="M4 4h7a3 3 0 0 1 3 3v14a4 4 0 0 0-3-1H4ZM20 4h-3a3 3 0 0 0-3 3v14a4 4 0 0 1 3-1h3Z"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  bell: '<path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5ZM10 21h4"/>',
  device:
    '<rect x="3" y="3" width="13" height="11" rx="2"/><path d="M6 18h8M10 14v4"/><rect x="17" y="10" width="5" height="11" rx="1"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3"/>',
  up: '<path d="m6 11 6-6 6 6M12 5v14"/>',
  down: '<path d="m6 9 6 6 6-6M12 15V4"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" stroke="none"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v12h5"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  settings: '<path d="m9 3-1 3-3 1-2 5 3 2 1 4 5 3 3-3 4-1 2-5-3-2-1-4-5-3Z"/><circle cx="12" cy="12" r="3"/>',
  pin: '<path d="m9 3 12 12-5 1-3 5-3-7-7-3ZM10 14l-7 7"/>',
  archive: '<path d="M4 8h16v13H4Z"/><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M9 12h6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  edit: '<path d="m4 16-1 5 5-1L21 7l-4-4ZM14 6l4 4"/>',
  file: '<path d="M5 2h9l5 5v15H5ZM14 2v6h5M8 13h8M8 17h6"/>',
  plug: '<path d="m8 4 12 12-4 4L4 8ZM6 6 3 3M18 18l3 3M10 12l-5 5M12 10l5-5"/>',
  star: '<path d="m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1Z"/>',
  refresh: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2"/>',
  logout: '<path d="M10 3H3v18h7M8 12h13m-5-5 5 5-5 5"/>',
  code: '<path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 3l-4 18"/>',
  shield: '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z"/><path d="m8 12 3 3 5-6"/>',
  spark: '<path d="m12 2 2 7 8 3-8 2-2 8-3-8-7-2 7-3ZM20 2v4M18 4h4"/>',
};
export function icon(name, cls = "") {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
}
export function paintIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon));
    delete el.dataset.icon;
  });
}
