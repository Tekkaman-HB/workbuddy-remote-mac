/**
 * [INPUT]: 依赖远端命令响应与 CLI 参数。
 * [OUTPUT]: 提供 readCommand、summarize、unwrapReply、cloudDisabled。
 * [POS]: lib 的协议边界，被 channel.mjs 和测试消费。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export function readCommand(action, sessionId) {
  if (action === 'list') return {type: 'wb:conversations:list', args: [{page: 1, size: 20}]};
  if (!sessionId || !/^[a-zA-Z0-9_-]{1,160}$/.test(sessionId)) {
    throw new Error('读取详情需要有效的会话 ID');
  }
  if (action === 'get') return {type: 'wb:conversations:get', args: [sessionId]};
  if (action === 'history') return {type: 'wb:conversations:requests', args: [sessionId, {byteLength: 262144, resultScope: 'page'}]};
  throw new Error('未允许的只读动作');
}

export function unwrapReply(reply) {
  const value = reply?.payload;
  if (!value || value.success !== true) {
    const code = typeof value?.code === 'string' ? value.code : 'NO_SUCCESS_REPLY';
    throw new Error(`远端未接受命令：${code}`);
  }
  return value.result;
}

export function summarize(value) {
  if (Array.isArray(value)) return {kind: 'array', count: value.length};
  if (!value || typeof value !== 'object') return {kind: typeof value};
  const result = {kind: 'object', keys: Object.keys(value)};
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) result[`${key}Count`] = item.length;
    if (['total', 'hasMore', 'partial'].includes(key)) result[key] = item;
  }
  return result;
}

const rejectCloud = async () => {throw new Error('此验证器仅支持远端 Mac，云端任务已禁用');};
// ---- SDK 要求 web 端提供云任务适配器；所有云任务调用均明确失败 ----
export const cloudDisabled = {
  getSandboxInfo: rejectCloud,
  sendAcpRequest: rejectCloud,
  openAcpStream: rejectCloud,
};
