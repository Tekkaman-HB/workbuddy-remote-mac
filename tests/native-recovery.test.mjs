/**
 * [INPUT]: Node test、xcrun swiftc 和实际 SessionBridge.swift 的恢复策略。
 * [OUTPUT]: 验证只读网络故障最多重试一次，写操作/业务拒绝不重发。
 * [POS]: tests 的原生恢复边界回归，不启动 WebKit 或访问真实账号。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
test('原生恢复只重试一次只读传输故障，写操作和业务拒绝保持单次调用', {skip:process.platform!=='darwin'}, async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'wb-recovery-test-'));
  try {
    const source=path.join(dir,'RecoveryCheck.swift'), binary=path.join(dir,'check');
    await writeFile(source, `
import AppKit
import WebKit
@main struct RecoveryCheck {
 @MainActor static func main() async throws {
  for code in ["CHANNEL_CLOSED", "PUBLISH_NETWORK_FAILED", "PUBLISH_TIMEOUT", "PUBLISH_HTTP_503", "CREDENTIALS_NETWORK_FAILED"] {
   var attempts=0, recoveries=0
   let result: Int = try await RemoteRequestRecovery.perform(readOnly:true, operation:{
    attempts += 1
    if attempts==1 {throw RemoteFailure.message("Error: " + code)}
    return 42
   }, beforeRetry:{recoveries += 1})
   precondition(result==42 && attempts==2 && recoveries==1)
  }
  for (readOnly,code,expected) in [(false,"PUBLISH_NETWORK_FAILED",1),(true,"REMOTE_REJECTED",1),(true,"PUBLISH_NETWORK_FAILED",2)] {
   var attempts=0, recoveries=0
   do {
    let _: Int = try await RemoteRequestRecovery.perform(readOnly:readOnly,operation:{
     attempts += 1; throw RemoteFailure.message(code)
    },beforeRetry:{recoveries += 1})
    preconditionFailure("must fail")
   } catch {precondition(attempts==expected && recoveries==expected-1)}
  }
  print("native recovery passed")
 }
}`);
    await exec('xcrun',['swiftc','-parse-as-library','-module-cache-path','work/swift-module-cache','-framework','AppKit','-framework','WebKit','MacApp/SessionBridge.swift',source,'-o',binary],{cwd:fileURLToPath(new URL('..',import.meta.url))});
    const {stdout}=await exec(binary,[]);
    assert.match(stdout,/native recovery passed/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
