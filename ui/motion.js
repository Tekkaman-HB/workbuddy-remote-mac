/**
 * [INPUT]: 依赖原生 Web Animations、matchMedia 与现有页面节点。
 * [OUTPUT]: 提供可中断的显示/隐藏、内容入场、侧栏切换、可见焦点恢复和布局位移动效。
 * [POS]: UI 唯一动效协调器，按 motion-match 的 Focus Field、Sliding Content Tabs、Toast Overshoot 适配。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const playing = new WeakMap();
const easing = "cubic-bezier(.22,1,.36,1)";
const reduceMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
  false;
function cancel(element) {
  const previous = playing.get(element);
  playing.delete(element);
  previous?.cancel();
}
function play(element, frames, { duration = 200, ease = easing } = {}, complete = () => {}) {
  cancel(element);
  if (reduceMotion() || !element.animate || duration === 0) {
    complete();
    return Promise.resolve();
  }
  const animation = element.animate(frames, { duration, easing: ease, fill: "none" });
  playing.set(element, animation);
  return animation.finished
    .catch(() => {})
    .then(() => {
      if (playing.get(element) !== animation) return;
      playing.delete(element);
      complete();
    });
}
function transforms(kind, exit = false) {
  const offset = exit ? 5 : 8;
  if (kind === "backdrop") return exit ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }];
  if (kind === "toast")
    return exit
      ? [
          { opacity: 1, transform: "translate(-50%,0) scale(1)" },
          { opacity: 0, transform: `translate(-50%,${offset}px) scale(.98)` },
        ]
      : [
          { opacity: 0, transform: `translate(-50%,${offset}px) scale(.98)` },
          { opacity: 1, transform: "translate(-50%,0) scale(1)" },
        ];
  const translate = kind === "drawer" ? `translateX(${offset * 2}px)` : `translateY(${offset}px)`;
  return exit
    ? [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: translate + " scale(.99)" },
      ]
    : [
        { opacity: 0, transform: translate + " scale(.985)" },
        { opacity: 1, transform: "none" },
      ];
}
export function reveal(element, { kind = "popover", immediate = false } = {}) {
  element.hidden = false;
  element.inert = false;
  element.setAttribute("aria-hidden", "false");
  return play(element, transforms(kind), { duration: immediate ? 0 : kind === "backdrop" ? 160 : 220 });
}
export function dismiss(element, { kind = "popover", immediate = false, onHidden = () => {} } = {}) {
  if (element.hidden) {
    cancel(element);
    onHidden();
    return Promise.resolve();
  }
  element.inert = true;
  element.setAttribute("aria-hidden", "true");
  return play(element, transforms(kind, true), { duration: immediate ? 0 : 130 }, () => {
    element.hidden = true;
    element.inert = false;
    onHidden();
  });
}
export function enter(element, { distance = 5, duration = 220 } = {}) {
  if (!element || element.hidden) return Promise.resolve();
  return play(
    element,
    [
      { opacity: 0, transform: `translateY(${distance}px)` },
      { opacity: 1, transform: "none" },
    ],
    { duration },
  );
}
export function layoutChange(change, selectors = ["#messages", "#composer-wrap"]) {
  const elements = selectors.map((s) => document.querySelector(s)).filter(Boolean);
  const rects = elements.map((el) => el.getBoundingClientRect());
  change();
  elements.forEach((el, i) => {
    const dx = rects[i].left - el.getBoundingClientRect().left;
    if (Math.abs(dx) > 1) play(el, [{ transform: `translateX(${dx}px)` }, { transform: "none" }], { duration: 260 });
  });
}
export function toggleSidebar() {
  const sidebar = document.querySelector("#sidebar");
  layoutChange(() => {
    const collapsed = document.body.classList.toggle("collapsed");
    sidebar.inert = collapsed;
    sidebar.setAttribute("aria-hidden", String(collapsed));
    document
      .querySelectorAll('[data-action="collapse"]')
      .forEach((button) => button.setAttribute("aria-expanded", String(!collapsed)));
    document.querySelector(collapsed ? "#expand" : '#sidebar [data-action="collapse"]')?.focus({ preventScroll: true });
  }, ["#main"]);
}
