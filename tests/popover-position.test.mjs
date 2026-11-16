/**
 * [INPUT]: 依赖 Node test 和实际菜单定位函数。
 * [OUTPUT]: 验证异步增高、窗口边缘、窄视口与尺寸变化后的菜单边界。
 * [POS]: tests 的弹层裁剪回归，不访问用户账号。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {popoverBounds} from '../ui/popover-position.js';
test('底部空列表加载成长列表后自动翻转到按钮上方', () => {
  const a={top:690,bottom:722,right:1100};
  assert.equal(popoverBounds(a,14,{width:1280,height:770},340).placement,'below');
  const b=popoverBounds(a,900,{width:1280,height:770},340,440);
  assert.equal(b.placement,'above');
  assert.equal(b.top+b.maxHeight,682);
});
test('小窗口和分屏中，长菜单限高并始终保留视口边距', () => {
  for (const viewport of [{width:260,height:300},{width:600,height:500},{width:900,height:600}]) {
    for (const a of [{top:40,bottom:72,right:150},{top:viewport.height-80,bottom:viewport.height-48,right:viewport.width-20}]) {
      const b=popoverBounds(a,1200,viewport,340,440);
      assert.ok(b.top>=12 && b.top+b.maxHeight<=viewport.height-12);
      assert.ok(b.left>=12 && b.left+b.width<=viewport.width-12);
    }
  }
});
