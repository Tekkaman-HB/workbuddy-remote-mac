/**
 * [INPUT]: 依赖 Node test、jsdom 和真实预览主题脚本。
 * [OUTPUT]: 验证深色阅读、主题恢复、语义色及图表主题切换幂等。
 * [POS]: tests 的隔离报告配色回归，不访问网络或改写报告文件。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installPreviewTheme} from '../ui/preview-theme.js';

test('深色适配报告纸面和卡片，保留语义色，浅色切回原始样式', async () => {
  const dom = new JSDOM(`<html><head><style>body{background:#f6f7fb;color:#171717}.card{background:white;border:1px solid #e5e5e5}.up{color:rgb(217,48,44);background:#fff0f0}</style></head><body><div class="card">正文 <span class="up">上涨</span></div><div _echarts_instance_="1"></div></body></html>`,{pretendToBeVisual:true});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,parent:dom.window,MutationObserver:dom.window.MutationObserver,requestAnimationFrame:fn=>dom.window.requestAnimationFrame(fn),getComputedStyle:dom.window.getComputedStyle.bind(dom.window)});
  const updates=[];
  const original={xAxis:[{}],yAxis:[{}],title:[{}],legend:[{}],tooltip:[{}],series:[{itemStyle:{color:'#d9302c'}}]};
  window.echarts={getInstanceByDom:()=>({})};
  const chart={getOption:()=>original,setOption:patch=>updates.push(patch)};
  window.echarts.getInstanceByDom=()=>chart;
  const card=document.querySelector('.card'), up=document.querySelector('.up');
  const settle=()=>new Promise(resolve=>setTimeout(resolve,50));
  installPreviewTheme(true);
  await settle();
  assert.equal(document.body.style.backgroundColor,'rgb(29, 29, 29)');
  assert.equal(card.style.backgroundColor,'rgb(37, 37, 37)');
  const color=getComputedStyle(up).color.match(/\d+/g).map(Number);
  assert.ok(color[0]>color[1] && color[0]>color[2]);
  assert.equal(up.textContent,'上涨');
  assert.equal(up.style.filter,'');
  assert.equal(updates.length,1);
  assert.equal(updates[0].series[0].itemStyle,undefined);
  document.body.append(document.createElement('span'));
  await settle();
  assert.equal(updates.length,1);
  window.dispatchEvent(new window.MessageEvent('message',{source:window,data:{type:'workbuddy-preview-theme',dark:false}}));
  await settle();
  assert.equal(card.getAttribute('style'),'');
  assert.equal(getComputedStyle(document.body).backgroundColor,'rgb(246, 247, 251)');
  assert.equal(getComputedStyle(up).color,'rgb(217, 48, 44)');
  assert.equal(updates[1],original);
  await settle();
  assert.equal(updates.length,2);
  dom.window.close();
});
