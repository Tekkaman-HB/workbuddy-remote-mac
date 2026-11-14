/**
 * [INPUT]: 依赖 Node test、jsdom 和实际 motion.js。
 * [OUTPUT]: 验证动画中断、关闭不可交互、减少动态效果及后台入场/布局位移不冻结。
 * [POS]: tests 的动效生命周期回归，不测试装饰样式。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<body></body>");
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
window.matchMedia = () => ({ matches: false });
const { reveal, dismiss, enter, layoutChange } = await import("../ui/motion.js");
function animatedElement() {
  const element = document.createElement("div");
  document.body.append(element);
  const animations = [];
  element.animate = () => {
    let resolve, reject;
    const finished = new Promise((a, b) => {
      resolve = a;
      reject = b;
    });
    const animation = { finished, cancel: () => reject(new Error("cancelled")), finish: () => resolve() };
    animations.push(animation);
    return animation;
  };
  return { element, animations };
}
test("关闭未完成时重新打开，不会被旧动画隐藏或清空", async () => {
  const { element, animations } = animatedElement();
  element.textContent = "新菜单";
  let cleared = false;
  const closing = dismiss(element, {
    onHidden: () => {
      cleared = true;
      element.replaceChildren();
    },
  });
  const opening = reveal(element);
  animations.at(-1).finish();
  await Promise.all([closing, opening]);
  assert.equal(element.hidden, false);
  assert.equal(element.inert, false);
  assert.equal(cleared, false);
  assert.equal(element.textContent, "新菜单");
  assert.equal(element.getAttribute("aria-hidden"), "false");
});
test("关闭期间立即退出交互与辅助技术焦点，动画结束再移除", async () => {
  const { element, animations } = animatedElement();
  const closing = dismiss(element);
  assert.equal(element.hidden, false);
  assert.equal(element.inert, true);
  assert.equal(element.getAttribute("aria-hidden"), "true");
  animations.at(-1).finish();
  await closing;
  assert.equal(element.hidden, true);
});
test("减少动态效果时直接完成显示与关闭，不等待动画", async () => {
  window.matchMedia = () => ({ matches: true });
  try {
    const { element, animations } = animatedElement();
    await reveal(element);
    await dismiss(element);
    assert.equal(animations.length, 0);
    assert.equal(element.hidden, true);
  } finally {
    window.matchMedia = () => ({ matches: false });
  }
});
test("后台内容入场不创建可能被冻结的透明动画", async () => {
  const {element, animations} = animatedElement();
  const originalFocus = document.hasFocus;
  document.hasFocus = () => false;
  try {
    const pending = enter(element);
    assert.equal(animations.length, 0);
    await pending;
  } finally { document.hasFocus = originalFocus; }
});
test("后台布局直接到位并取消旧动画，前台仍保留布局过渡", async () => {
  const {element, animations} = animatedElement();
  element.id = 'layout-target';
  let left = 0;
  element.getBoundingClientRect = () => ({left});
  const originalFocus = document.hasFocus;
  const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  try {
    document.hasFocus = () => true;
    Object.defineProperty(document, 'visibilityState', {configurable:true, value:'visible'});
    layoutChange(() => {left = 100;}, ['#layout-target']);
    assert.equal(animations.length, 1);
    let cancelled = false;
    const cancel = animations[0].cancel;
    animations[0].cancel = () => {cancelled = true; cancel();};
    document.hasFocus = () => false;
    layoutChange(() => {left = 0;}, ['#layout-target']);
    assert.equal(left, 0);
    assert.equal(cancelled, true);
    assert.equal(animations.length, 1);
    document.hasFocus = () => true;
    Object.defineProperty(document, 'visibilityState', {configurable:true, value:'hidden'});
    layoutChange(() => {left = 50;}, ['#layout-target']);
    assert.equal(left, 50);
    assert.equal(animations.length, 1);
  } finally {
    document.hasFocus = originalFocus;
    if (visibility) Object.defineProperty(document, 'visibilityState', visibility);
    else delete document.visibilityState;
    element.remove();
  }
});
