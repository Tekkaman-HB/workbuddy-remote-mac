/**
 * [INPUT]: 无外部依赖。
 * [OUTPUT]: 自绘 SVG 图标、统一下拉箭头与按钮图标填充。
 * [POS]: UI 的统一线性图标字典。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const paths = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  new: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/>',
  search: '<circle cx="10.7" cy="10.7" r="6.7"/><path d="m16 16 4.5 4.5"/>',
  filter: '<path d="M4 5h16l-6.5 7.5V19l-3 1v-7.5Z"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
  rightPanel:
    '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/>',
  owl: '<path d="m5 5 4 2h6l4-2v9a7 7 0 0 1-14 0Z"/><path d="M9 10v3m6-3v3m-5 3 2 1.5 2-1.5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M14 17.5h7M17.5 14v7"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  folder: '<path d="M3 8V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10H3Z"/>',
  book: '<path d="M4 4h7a3 3 0 0 1 3 3v14a4 4 0 0 0-3-1H4ZM20 4h-3a3 3 0 0 0-3 3v14a4 4 0 0 1 3-1h3Z"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  bell: '<path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5ZM10 21h4"/>',
  device:
    '<rect x="2.5" y="3.5" width="13" height="10" rx="2"/><path d="M6 17h4m-2-3.5V17"/><rect x="11" y="10" width="10.5" height="8.5" rx="1.7"/><path d="M16.2 18.5v3m-3 0h6"/>',
  desktop:
    '<rect x="3" y="4" width="18" height="13" rx="2.5"/><path d="M12 17v4m-4 0h8"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3"/>',
  up: '<path d="m6 11 6-6 6 6M12 5v14"/>',
  down: '<path d="m6 9 6 6 6-6M12 15V4"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" stroke="none"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2.5"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  chevronDown: '<path d="m7 10 5 5 5-5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  settings:
    '<path d="M9.5 3h5l.6 2.5 1.7 1 2.5-.7 2.5 4.4-1.9 1.8v2l1.9 1.8-2.5 4.3-2.5-.7-1.7 1-.6 2.6h-5l-.6-2.6-1.7-1-2.5.7-2.5-4.3L4.1 14v-2l-1.9-1.8 2.5-4.4 2.5.7 1.7-1Z" transform="translate(0 -1) scale(1 .96)"/><circle cx="12" cy="11.5" r="3"/>',
  pin: '<path d="m15 3 6 6-4.5.6-3.5 6.9-5.5-5.5 6.9-3.5Z"/><path d="m9 15-6 6"/>',
  archive:
    '<path d="M4 8h16v13H4Z"/><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M9 12h6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  edit: '<path d="m4 16-1 5 5-1L21 7l-4-4ZM14 6l4 4"/>',
  file: '<path d="M5 2h9l5 5v15H5ZM14 2v6h5M8 13h8M8 17h6"/>',
  plug: '<path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0Zm6 9v4"/>',
  star: '<path d="m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1Z"/>',
  refresh: '<path d="M20 7a8 8 0 1 0 .6 9M20 3v5h-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2"/>',
  logout: '<path d="M10 3H3v18h7M8 12h13m-5-5 5 5-5 5"/>',
  code: '<path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 3l-4 18"/>',
  shield:
    '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z"/><path d="m8 12 3 3 5-6"/>',
  spark: '<path d="m12 2 2 7 8 3-8 2-2 8-3-8-7-2 7-3ZM20 2v4M18 4h4"/>',
};
export function icon(name, cls = "") {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || paths.file}</svg>`;
}
export function paintIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon));
    delete el.dataset.icon;
    if (el.getAttribute("aria-label") && !el.title)
      el.title = el.getAttribute("aria-label");
  });
}
