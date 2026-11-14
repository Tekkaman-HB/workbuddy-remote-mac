/**
 * [INPUT]: 依赖 Node test、jsdom、真实 Markdown 和产物匹配实现。
 * [OUTPUT]: 验证文件入口安全性、重名歧义及只匹配当前列表。
 * [POS]: tests 的报告引用回归，不调用远端定位或创建分享。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { matchArtifacts } from '../ui/artifacts.js';
const dom = new JSDOM('');
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
const { markdown } = await import('../ui/render.js');

test('报告文件名和本地 Markdown 链接可预览，代码块和外部链接保留原行为', () => {
  const holder = document.createElement('div');
  holder.innerHTML = markdown('报告：`hotspot-review-20261113.html`\n\n[查看](./report.html)\n\n[网页](https://example.com/report.html)\n\n```\nreport.html\n```');
  assert.deepEqual([...holder.querySelectorAll('.artifact-reference')].map(x => x.dataset.artifactName), ['hotspot-review-20261113.html', 'report.html']);
  assert.equal(holder.querySelectorAll('pre code').length, 1);
  assert.equal(holder.querySelectorAll('a[href^="https:"]').length, 1);
});

test('引用不能注入原生动作或匹配未知文件，重名不自动猜测', () => {
  const items = [{id:'a',title:'report.html'}, {id:'b',title:'/other/report.html'}, {id:'c',title:'report-old.html'}];
  assert.equal(matchArtifacts(items, '/workspace/report.html').length, 2);
  assert.equal(matchArtifacts(items, 'unknown.html').length, 0);
  assert.equal(matchArtifacts(items, 'https://example.com/report.html').length, 0);
  const holder = document.createElement('div');
  holder.innerHTML = markdown('`<button data-action="delete">x</button>.html`');
  assert.equal(holder.querySelector('[data-action]'), null);
  assert.equal(holder.querySelector('.artifact-reference')?.textContent, '<button data-action="delete">x</button>.html');
});
