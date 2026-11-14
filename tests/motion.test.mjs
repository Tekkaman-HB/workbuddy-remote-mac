/**
 * [INPUT]: 依赖 Node test、jsdom 和实际 motion.js。
 * [OUTPUT]: 验证动画中断、关闭不可交互、减少动态效果及后台入场不冻结在透明帧。
 * [POS]: tests 的动效生命周期回归，不测试装饰样式。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<body></body>");
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
window.matchMedia = () => ({ matches: false });
const { reveal, dismiss, enter } = await import("../ui/motion.js");
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
