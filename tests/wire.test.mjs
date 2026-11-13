/**
 * [INPUT]: 依赖 node:test、node:assert 和 lib/wire.mjs。
 * [OUTPUT]: 提供远程会话密码协议的完整性与范围测试。
 * [POS]: tests 的独立通道测试入口。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {packEnvelope, unpackEnvelope, scopeKey, RemoteChannel} from '../lib/wire.mjs';
const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
const credentials = {keyVersion: 1, encryptionKeys: {'executor:mac': key, 'reply:#user': key},
  signingKeys: {'executor:mac': key, 'reply:#user': key}};

test('独立通道加密内容可验证解密，不传递明文', async () => {
  const payload = {type: 'wb:conversations:list', args: [{title: '中文内容'}]};
  const envelope = await packEnvelope(payload, credentials, 'executor:mac', 'client');
  assert.equal(JSON.stringify(envelope).includes('中文内容'), false);
  const plain = await unpackEnvelope(envelope, credentials, 'executor:mac');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(plain)), payload);
});
test('正文、目标身份和分片序号被篡改时拒绝', async () => {
  const envelope = await packEnvelope({text: 'secret'}, credentials, 'executor:mac', 'client');
  for (const patch of [{ciphertext: 'AAAA'}, {senderDeviceId: 'attacker'}, {partTotal: 2}]) {
    await assert.rejects(unpackEnvelope({...envelope, ...patch}, credentials, 'executor:mac'));
  }
});
test('签名失败、旧版本和非法分片边界被拒绝', async () => {
  const envelope = await packEnvelope({}, credentials, 'executor:mac', 'client');
  for (const patch of [{sig: key}, {keyVersion: 2}, {partIndex: -1}, {partTotal: 1025}]) {
    await assert.rejects(unpackEnvelope({...envelope, ...patch}, credentials, 'executor:mac'));
  }
});
test('回包密钥只在已授权用户范围内解析', () => {
  assert.equal(scopeKey(credentials.encryptionKeys, 'reply:request#user'), key);
  assert.throws(() => scopeKey(credentials.encryptionKeys, 'reply:request#someone-else'));
  assert.throws(() => scopeKey(credentials.encryptionKeys, 'executor:other-mac'));
});
test('断开状态的请求立即失败，不尝试发布', async () => {
  const client = new RemoteChannel({});
  await assert.rejects(client.request({type: 'wb:conversations:list'}), /CHANNEL_CLOSED/);
});
test('等待回包期间断线立即结束请求，避免持续挂起', async t => {
  let published;
  const ready = new Promise(resolve => {published = resolve;});
  t.mock.method(globalThis, 'fetch', async () => {published(); return new Response('{"code":0}');});
  const client = new RemoteChannel({userId: 'user', deviceId: 'client', targetDeviceId: 'mac',
    credentials: {...credentials, apisixPublishUrl: 'https://www.workbuddy.cn/test', publishToken: 'test-only'}});
  client.socket = {readyState: WebSocket.OPEN, close() {this.readyState = WebSocket.CLOSED;}};
  client.rpc = async () => ({});
  const pending = client.request({type: 'wb:conversations:list'});
  pending.catch(() => {});
  await ready;
  client.close();
  await assert.rejects(pending, /CHANNEL_CLOSED/);
});

test('大型目录的 129 个乱序分片可以完整重组', async () => {
  const {createCipheriv, createHmac, randomBytes}=await import('node:crypto');
  const channel='reply:catalog#user';
  const payload={items:[{name:'中文目录🙂'.repeat(2000)}]};
  const raw=Buffer.from(JSON.stringify(payload));
  const count=129, size=Math.ceil(raw.length/count), messageId=crypto.randomUUID();
  const fields=['v','msgId','partIndex','partTotal','eventId','seq','ts','iv','ciphertext','tag','keyVersion','senderDeviceId','eventType'];
  const frames=[];
  for(let i=0;i<count;i++){
    const iv=randomBytes(12);
    const envelope={v:1,msgId:messageId,partIndex:i,partTotal:count,keyVersion:1,iv:iv.toString('base64')};
    const cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'base64'),iv);
    cipher.setAAD(Buffer.from(`${messageId}|${i}|${count}|1`));
    envelope.ciphertext=Buffer.concat([cipher.update(raw.subarray(i*size,Math.min((i+1)*size,raw.length))),cipher.final()]).toString('base64');
    envelope.tag=cipher.getAuthTag().toString('base64');
    envelope.sig=createHmac('sha256',Buffer.from(key,'base64')).update(JSON.stringify(Object.fromEntries(fields.filter(k=>envelope[k]!==undefined).map(k=>[k,envelope[k]])))).digest('base64');
    frames.unshift(JSON.stringify({push:{channel,pub:{data:envelope}}}));
  }
  const client=new RemoteChannel({credentials});
  let received;
  client.listeners.set(channel,{resolve:value=>{received=value;},reject:error=>{throw error;}});
  await Promise.all(frames.map(frame=>client.receive(frame)));
  assert.deepEqual(received,payload);
  assert.equal(client.fragments.size,0);
});
