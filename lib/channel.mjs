/**
 * [INPUT]: 依赖本机安装包中的通道 SDK、短期私有凭证与 protocol.mjs。
 * [OUTPUT]: 执行远端列表、详情、历史读取，输出匿名统计。
 * [POS]: lib 的通道验证入口；只在内存装载安装包，不修改应用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import {readCommand, summarize, unwrapReply, cloudDisabled} from './protocol.mjs';

const [privateDir, action = 'list', sessionId] = process.argv.slice(2);
if (!privateDir) throw new Error('用法：node lib/channel.mjs 私有目录 [list|get|history] [会话ID]');
const command = readCommand(action, sessionId);
const credentialFile = path.join(privateDir, 'channel.json');
const info = fs.statSync(credentialFile);
if ((info.mode & 0o077) !== 0 || info.uid !== process.getuid()) {
  throw new Error('凭证文件须属于当前用户且权限为 0600');
}
const config = JSON.parse(fs.readFileSync(credentialFile, 'utf8'));
const app = process.env.WBREMOTE_APP || '/Applications/WorkBuddy.app';
const filename = path.join(app, 'Contents/Resources/app.asar.unpacked/resources/extensions/edge-sync/server/index.cjs');
const source = fs.readFileSync(filename, 'utf8');
if (!source.includes('var lib_exports = {}') || !source.includes('function init_lib()') && !source.includes('var init_lib =')) {
  throw new Error('当前安装包 SDK 结构未验证，请重新检查版本');
}
// ---- 仅临时暴露 SDK；不复制厂商 bundle 到交付物 ----
const installed = new Module(filename);
installed.paths = Module._nodeModulePaths(path.dirname(filename));
installed._compile(source + '\ninit_lib();module.exports.__remoteLab=lib_exports;', filename);
const api = installed.exports.__remoteLab;
if (api.SDK_VERSION !== '2.3.1') throw new Error('当前验证器仅验证过 SDK 2.3.1');
let sdk;
const timeout = setTimeout(() => {process.stderr.write('验证超时\n'); process.exit(2);}, 35_000);
try {
  ({sdk} = await api.handshake({
    userId: config.userId, deviceId: config.deviceId, clientType: 'web',
    fetchCredentials: async () => config.credentials,
    acpProvider: cloudDisabled,
    onMetric() {}, onTrace() {},
    logger: {debug() {}, info() {}, error() {}}, logLevel: 'error',
  }));
  const reply = await sdk.request('executor:' + config.targetDeviceId, command, {timeoutMs: 15_000});
  const result = unwrapReply(reply);
  fs.writeFileSync(path.join(privateDir, `${action}-reply.json`), JSON.stringify(reply), {mode: 0o600});
  process.stdout.write(JSON.stringify({ok: true, sdkVersion: api.SDK_VERSION, action,
                                      result: summarize(result)}) + '\n');
} catch (error) {
  // 错误消息可能包含 SDK 的完整身份上下文，仅输出稳定错误码。
  process.stderr.write(JSON.stringify({ok: false, action, name: error.name,
    code: error.code || 'VALIDATION_FAILED', reason: error.message?.startsWith('远端未接受命令') ? error.message : '通道验证失败，详见协议检查'}) + '\n');
  process.exitCode = 1;
} finally {
  if (sdk) await sdk.close();
  clearTimeout(timeout);
}
