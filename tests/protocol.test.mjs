/**
 * [INPUT]: 依赖 node:test、node:assert 与 lib/protocol.mjs。
 * [OUTPUT]: 提供协议边界测试。
 * [POS]: tests 的验证入口，与真实通道实测互补。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readCommand, summarize, unwrapReply, cloudDisabled} from '../lib/protocol.mjs';

test('只读入口拒绝写入动作及无效会话 ID', () => {
  assert.throws(() => readCommand('send', 'abc'));
  assert.throws(() => readCommand('get', '../../secret'));
  assert.throws(() => readCommand('history'));
  assert.equal(readCommand('list').type, 'wb:conversations:list');
});
test('摘要不会输出会话正文、身份或令牌', () => {
  const result = summarize({items: [{content: 'private'}], token: 'secret', total: 1});
  assert.equal(result.itemsCount, 1);
  assert.equal(result.total, 1);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
test('权限拒绝不能被当作空会话列表', () => {
  assert.throws(() => unwrapReply({payload: {success: false, code: 'PERMISSION_DENIED'}}));
  assert.deepEqual(unwrapReply({payload: {success: true, result: []}}), []);
});
test('SDK 云任务适配器明确拒绝执行', async () => {
  await assert.rejects(cloudDisabled.getSandboxInfo());
  await assert.rejects(cloudDisabled.sendAcpRequest());
});
