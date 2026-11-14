/**
 * [INPUT]: 依赖 WebSocket、Web Crypto、服务端签发的当前用户通道凭证。
 * [OUTPUT]: 提供 RemoteChannel、加密/验签与范围校验；区分发布网络/超时/响应故障，不重发命令。
 * [POS]: lib 的独立协议实现，可在 Node 或 WKWebView 运行，不依赖 WorkBuddy 安装。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const bytes = value => new TextEncoder().encode(value);
const text = value => new TextDecoder('utf-8', {fatal: true}).decode(value);
const base64 = value => btoa(Array.from(value, x => String.fromCharCode(x)).join(''));
const unbase64 = value => Uint8Array.from(atob(value), x => x.charCodeAt(0));
const macOrder = ['v', 'msgId', 'partIndex', 'partTotal', 'eventId', 'seq', 'ts', 'iv', 'ciphertext', 'tag', 'keyVersion', 'senderDeviceId', 'eventType'];
const signedBytes = envelope => bytes(JSON.stringify(Object.fromEntries(macOrder
  .filter(key => envelope[key] !== undefined).map(key => [key, envelope[key]]))));
const aad = e => bytes(`${e.msgId}|${e.partIndex}|${e.partTotal}|${e.keyVersion}`);
const MAX_FRAGMENT_COUNT = 1024;
const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
const MAX_BUFFERED_BYTES = 64 * 1024 * 1024;
const concat = parts => {
  const out = new Uint8Array(parts.reduce((sum, item) => sum + item.length, 0));
  let offset = 0;
  for (const part of parts) {out.set(part, offset); offset += part.length;}
  return out;
};
const importKey = (value, algorithm, usage) => crypto.subtle.importKey('raw', unbase64(value), algorithm, false, usage);

export function scopeKey(table, channel) {
  if (table[channel]) return table[channel];
  const colon = channel.indexOf(':'), hash = channel.indexOf('#');
  if (hash > colon && colon > 0 && table[channel.slice(0, colon + 1) + channel.slice(hash)]) {
    return table[channel.slice(0, colon + 1) + channel.slice(hash)];
  }
  const wildcard = channel.slice(0, channel.lastIndexOf(':') + 1) + '*';
  if (table[wildcard]) return table[wildcard];
  throw new Error('CHANNEL_SCOPE_NOT_GRANTED');
}

export async function packEnvelope(payload, credentials, channel, deviceId) {
  const raw = bytes(JSON.stringify(payload));
  if (raw.length > 16000) throw new Error('PROTOTYPE_PAYLOAD_LIMIT');
  const env = {v: 1, msgId: crypto.randomUUID(), partIndex: 0, partTotal: 1,
    eventId: crypto.randomUUID(), ts: Date.now(), iv: base64(crypto.getRandomValues(new Uint8Array(12))),
    keyVersion: credentials.keyVersion, senderDeviceId: deviceId};
  const key = await importKey(scopeKey(credentials.encryptionKeys, channel), 'AES-GCM', ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM',
    iv: unbase64(env.iv), additionalData: aad(env), tagLength: 128}, key, raw));
  env.ciphertext = base64(cipher.slice(0, -16));
  env.tag = base64(cipher.slice(-16));
  const signing = await importKey(scopeKey(credentials.signingKeys, channel), {name: 'HMAC', hash: 'SHA-256'}, ['sign']);
  env.sig = base64(new Uint8Array(await crypto.subtle.sign('HMAC', signing, signedBytes(env))));
  return env;
}

export async function unpackEnvelope(envelope, credentials, channel) {
  if (envelope.v !== 1 || envelope.keyVersion !== credentials.keyVersion ||
      !Number.isInteger(envelope.partTotal) || envelope.partTotal < 1 || envelope.partTotal > MAX_FRAGMENT_COUNT ||
      !Number.isInteger(envelope.partIndex) || envelope.partIndex < 0 || envelope.partIndex >= envelope.partTotal) {
    throw new Error('INVALID_ENVELOPE');
  }
  if (typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length > 2_000_000) throw new Error('ENVELOPE_TOO_LARGE');
  const signing = await importKey(scopeKey(credentials.signingKeys, channel), {name: 'HMAC', hash: 'SHA-256'}, ['verify']);
  if (!await crypto.subtle.verify('HMAC', signing, unbase64(envelope.sig), signedBytes(envelope))) {
    throw new Error('INVALID_SIGNATURE');
  }
  const key = await importKey(scopeKey(credentials.encryptionKeys, channel), 'AES-GCM', ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv: unbase64(envelope.iv),
    additionalData: aad(envelope), tagLength: 128}, key, concat([unbase64(envelope.ciphertext), unbase64(envelope.tag)])));
}

export class RemoteChannel {
  constructor(config) {
    this.config = config;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.fragments = new Map();
  }
  async connect() {
    const url = new URL(this.config.credentials.cfWsUrl);
    if (url.protocol !== 'wss:' || url.hostname !== 'www.workbuddy.cn') throw new Error('UNTRUSTED_CHANNEL_HOST');
    this.socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {this.socket.close(); reject(new Error('CONNECT_TIMEOUT'));}, 12000);
      this.socket.addEventListener('open', () => {clearTimeout(timer); resolve();}, {once: true});
      this.socket.addEventListener('error', () => {clearTimeout(timer); reject(new Error('WEBSOCKET_FAILED'));}, {once: true});
    });
    this.socket.addEventListener('message', event => {
      this.receive(event.data).catch(error => {
        const code = /^[A-Z][A-Z0-9_]{2,47}$/.test(error?.message ?? '') ? error.message : 'DECODE_FAILED';
        this.close(new Error('INVALID_CHANNEL_MESSAGE:' + code));
      });
    });
    this.socket.addEventListener('close', () => {
      const error = new Error('CHANNEL_CLOSED');
      this.rejectPending(error);
      for (const listener of this.listeners.values()) listener.reject(error);
      this.fragments.clear();
    });
    await this.rpc('connect', {token: this.config.credentials.connectToken,
      data: {deviceId: this.config.deviceId, clientType: 'web'}});
  }
  rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => {this.pending.delete(id); reject(new Error('RPC_TIMEOUT'));}, 12000);
      this.pending.set(id, {resolve, reject, timer});
      try {this.socket.send(JSON.stringify({id, [method]: params}));}
      catch (error) {clearTimeout(timer); this.pending.delete(id); reject(error);}
    });
  }
  async receive(raw) {
    if (typeof raw !== 'string') throw new Error('NON_JSON_FRAME');
    for (const line of raw.split('\n').filter(Boolean)) {
      if (line.length > 4_000_000) throw new Error('FRAME_TOO_LARGE');
      const frame = JSON.parse(line);
      if (Object.keys(frame).length === 0) {this.socket.send('{}'); continue;}
      if (frame.id) {
        const pending = this.pending.get(frame.id);
        if (!pending) continue;
        clearTimeout(pending.timer); this.pending.delete(frame.id);
        if (frame.error) pending.reject(new Error(`CHANNEL_RPC_${frame.error.code}`));
        else pending.resolve(frame);
      }
      const push = frame.push;
      if (push?.pub?.data && this.listeners.has(push.channel)) {
        const envelope = push.pub.data;
        const plain = await unpackEnvelope(envelope, this.config.credentials, push.channel);
        const key = `${push.channel}/${envelope.msgId}`;
        let record = this.fragments.get(key);
        if (!record) {
          if (this.fragments.size >= 32) throw new Error('TOO_MANY_MESSAGES');
          record = {parts: new Map(), total: envelope.partTotal, size: 0};
          this.fragments.set(key, record);
        }
        if (record.total !== envelope.partTotal) throw new Error('PART_COUNT_CHANGED');
        if (!record.parts.has(envelope.partIndex)) {record.parts.set(envelope.partIndex, plain); record.size += plain.length;}
        if (record.size > MAX_MESSAGE_BYTES) throw new Error('MESSAGE_TOO_LARGE');
        if (Array.from(this.fragments.values()).reduce((sum, item) => sum + item.size, 0) > MAX_BUFFERED_BYTES) {
          throw new Error('BUFFER_CAPACITY_EXCEEDED');
        }
        if (record.parts.size === record.total) {
          const payload = JSON.parse(text(concat(Array.from({length: record.total}, (_, i) => record.parts.get(i)))));
          this.fragments.delete(key);
          this.listeners.get(push.channel)?.resolve(payload);
        }
      }
    }
  }
  async request(command, timeoutMs = 20000) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('CHANNEL_CLOSED');
    const channel = `executor:${this.config.targetDeviceId}`;
    const requestId = crypto.randomUUID();
    const replyChannel = `reply:${requestId}#${this.config.userId}`;
    let timer, received = false, receivedReply;
    const response = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('REMOTE_TIMEOUT')), timeoutMs);
      this.listeners.set(replyChannel, {resolve: value => {received = true; receivedReply = value; resolve(value);}, reject});
    });
    // 回包可能在 HTTP publish 完成前到达；立即安装 rejection handler。
    response.catch(() => {});
    try {
      await this.rpc('subscribe', {channel: replyChannel});
      const env = await packEnvelope({...command, requestId, replyChannel}, this.config.credentials, channel, this.config.deviceId);
      const url = new URL(this.config.credentials.apisixPublishUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'www.workbuddy.cn') throw new Error('UNTRUSTED_PUBLISH_HOST');
      let body;
      try {
        const result = await fetch(url, {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
          headers: {'Content-Type': 'application/json', 'X-Channel': channel, 'X-Channel-Scope': 'executor',
            'X-User-Id': this.config.userId, Authorization: `Bearer ${this.config.credentials.publishToken}`},
          body: JSON.stringify({channel, data: env})});
        if (!result.ok) throw new Error(`PUBLISH_HTTP_${result.status}`);
        body = await result.json();
      } catch (error) {
        // 已验签的真实回包可能先于 HTTP 发布确认到达，以回包为准，不重复执行。
        if (received) return receivedReply;
        if (error instanceof TypeError) throw new Error('PUBLISH_NETWORK_FAILED');
        if (['TimeoutError', 'AbortError'].includes(error?.name)) throw new Error('PUBLISH_TIMEOUT');
        if (error instanceof SyntaxError) throw new Error('PUBLISH_INVALID_RESPONSE');
        throw error;
      }
      if (body.error || (body.code !== undefined && body.code !== 0)) throw new Error('PUBLISH_REJECTED');
      return await response;
    } finally {
      clearTimeout(timer); this.listeners.delete(replyChannel);
      for (const key of this.fragments.keys()) if (key.startsWith(replyChannel + '/')) this.fragments.delete(key);
      if (this.socket.readyState === WebSocket.OPEN) this.rpc('unsubscribe', {channel: replyChannel}).catch(() => {});
    }
  }
  rejectPending(error) {
    for (const item of this.pending.values()) {clearTimeout(item.timer); item.reject(error);}
    this.pending.clear();
  }
  close(error = new Error('CHANNEL_CLOSED')) {
    this.rejectPending(error);
    for (const listener of this.listeners.values()) listener.reject(error);
    this.socket?.close(); this.listeners.clear(); this.fragments.clear();
  }
}
