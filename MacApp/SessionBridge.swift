/**
 * [INPUT]: 依赖 WebKit 的独立浏览器会话和 lib/wire.mjs。
 * [OUTPUT]: 提供登录/设备、网络阶段错误、单飞连接检查与只读瞬断单次恢复、已读回执、受限调用和模型展示字段及点击附件后的产物定位。
 * [POS]: MacApp 的账号与协议边界，被原生入口和本地页面桥使用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import AppKit
import WebKit

enum RemoteFailure: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}

// -- 只读恢复边界：网络故障最多重试一次，写入与业务拒绝不自动重发 --
@MainActor
enum RemoteRequestRecovery {
    static func perform<Value>(readOnly: Bool, operation: () async throws -> Value,
        beforeRetry: () async throws -> Void = { try await Task.sleep(nanoseconds: 300_000_000) }) async throws -> Value {
        do { return try await operation() }
        catch {
            let transient = ["CHANNEL_CLOSED", "PUBLISH_NETWORK_FAILED", "PUBLISH_TIMEOUT",
                "PUBLISH_HTTP_502", "PUBLISH_HTTP_503", "PUBLISH_HTTP_504",
                "CREDENTIALS_NETWORK_FAILED", "CREDENTIALS_TIMEOUT"]
            guard readOnly, transient.contains(where: { error.localizedDescription.contains($0) }) else { throw error }
            try await beforeRetry()
            return try await operation()
        }
    }
}

@MainActor
final class SessionBridge: NSObject, WKNavigationDelegate, WKUIDelegate {
    let web: WKWebView
    private(set) var userID = ""
    private(set) var targetID = ""
    private(set) var profile: [String: Any] = [:]
    var onPageReady: (() -> Void)?
    private var wireReady = false
    private var targetInfo: [String: Any]?
    private var expiresAt = Date.distantPast
    private var renewal: Task<Void, Error>?
    private let deviceID: String

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        web = WKWebView(frame: .zero, configuration: config)
        let key = "remoteClientDeviceID"
        let stored = UserDefaults.standard.string(forKey: key) ?? UUID().uuidString.lowercased()
        UserDefaults.standard.set(stored, forKey: key)
        deviceID = stored
        super.init()
        web.navigationDelegate = self
        web.uiDelegate = self
        web.load(URLRequest(url: URL(string: "https://www.workbuddy.cn/app")!))
    }

    private func run(_ script: String, _ args: [String: Any] = [:]) async throws -> Any? {
        guard web.url?.scheme == "https", web.url?.host == "www.workbuddy.cn" else {
            throw RemoteFailure.message("请先在官方登录页完成登录，返回 WorkBuddy 页面后再读取设备。")
        }
        do {
            return try await web.callAsyncJavaScript(script, arguments: args, in: nil, contentWorld: .page)
        } catch {
            let info = (error as NSError).userInfo
            let detail = info["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription
            throw RemoteFailure.message(String(detail.prefix(240)))
        }
    }

    private func http(_ route: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        let allowed = ["/console/accounts", "/console/as/conversation-sync/devices/online", "/edge-cloud/credentials"]
        guard allowed.contains(route) else { throw RemoteFailure.message("未允许的接口") }
        let script = """
        const headers = {'Accept':'application/json'};
        if (uid) headers['X-User-Id'] = uid;
        const options = {method: body ? 'POST' : 'GET', credentials:'include', headers};
        if (body) {headers['Content-Type']='application/json'; options.body=JSON.stringify(body);}
        const stage = route === '/edge-cloud/credentials' ? 'CREDENTIALS' : 'API';
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        options.signal = controller.signal;
        try {
          const response = await fetch(route, options);
          if (!response.ok) throw new Error('HTTP_'+response.status);
          const payload = await response.json();
          if (payload.code !== undefined && payload.code !== 0) throw new Error('API_'+payload.code);
          return payload.data ?? payload;
        } catch (error) {
          if (error.name === 'AbortError') throw new Error(stage+'_TIMEOUT');
          if (error instanceof TypeError) throw new Error(stage+'_NETWORK_FAILED');
          throw error;
        } finally { clearTimeout(timer); }
        """
        guard let value = try await run(script, ["route": route, "uid": userID, "body": body.map { $0 as Any } ?? NSNull()]) as? [String: Any] else {
            throw RemoteFailure.message("接口返回格式不符合预期")
        }
        return value
    }

    func devices() async throws -> [[String: Any]] {
        let account = try await http("/console/accounts")
        let accounts = account["accounts"] as? [[String: Any]] ?? []
        guard let selected = accounts.first(where: {($0["type"] as? String) == "personal"}) ?? accounts.first,
              let uid = selected["uid"] as? String, !uid.isEmpty else {
            throw RemoteFailure.message("尚未取得账号，请完成官网扫码登录和账号选择。")
        }
        userID = uid
        profile = Dictionary(uniqueKeysWithValues: ["uid", "name", "nickname", "displayName", "avatar", "avatarUrl"].compactMap { key in
            selected[key].map { (key, $0) }
        })
        let data = try await http("/console/as/conversation-sync/devices/online")
        return (data["devices"] as? [[String: Any]] ?? []).filter {($0["deviceType"] as? String) == "local"}
    }

    func connect(_ target: [String: Any]) async throws {
        guard let id = target["deviceId"] as? String else {throw RemoteFailure.message("缺少设备标识")}
        let enabled = (target["remoteViewFlag"] as? NSNumber)?.intValue ?? 0
        guard enabled == 1 else {throw RemoteFailure.message("请在目标 Mac 的 WorkBuddy 中允许移动端连接此设备。")}
        let body: [String: Any] = ["userId": userID, "deviceId": deviceID, "clientType": "web",
            "deviceName": Host.current().localizedName.map {"Remote · " + $0} ?? "WorkBuddy Remote",
            "useDefaultScopes": true, "scopes": ["executor:" + id], "chSdkVersion": "2.3.1"]
        let credentials = try await http("/edge-cloud/credentials", body: body)
        if !wireReady {
            guard let file = Bundle.main.url(forResource: "wire", withExtension: "mjs") else {
                throw RemoteFailure.message("缺少通道模块")
            }
            let source = try String(contentsOf: file, encoding: .utf8).replacingOccurrences(of: "export ", with: "")
            _ = try await run("(function(){" + source + ";window.WBRemoteChannel=RemoteChannel;})();return true;")
            wireReady = true
        }
        let config: [String: Any] = ["userId": userID, "deviceId": deviceID, "targetDeviceId": id, "credentials": credentials]
        _ = try await run("window.wbRemote?.close();window.wbRemote=new window.WBRemoteChannel(config);await window.wbRemote.connect();return true;", ["config": config])
        targetID = id
        targetInfo = target
        expiresAt = Date().addingTimeInterval(TimeInterval(credentials["expiresIn"] as? Int ?? 1800))
    }

    func request(_ method: String, _ args: [Any]) async throws -> [String: Any] {
        try await invoke("wb:conversations:" + method, args)
    }

    func invoke(_ method: String, _ args: [Any], allowArtifactTransfer: Bool = false) async throws -> [String: Any] {
        guard !targetID.isEmpty else {throw RemoteFailure.message("请先连接目标 Mac")}
        let requestedTarget = targetID
        let conversations = ["list", "get", "requests", "markRead", "sendPrompt", "cancel",
            "create", "rename", "pin", "unpin", "archive", "delete", "configSetModel", "configSetMode", "configSetExpert",
            "configSetPermissionMode"]
        let catalogs = ["wb:models:list", "wb:models:customs", "wb:experts:list", "wb:skills:installed", "wb:connectors:list",
            "wb:workspaces:list", "wb:artifacts:list", "wb:artifacts:get", "wb:automations:list",
            "wb:automations:listRecords", "wb:automations:getRecordDetail"]
        guard conversations.map({"wb:conversations:" + $0}).contains(method) || catalogs.contains(method) || (method == "wb:artifacts:locate" && allowArtifactTransfer) else {
            throw RemoteFailure.message("此远程动作尚未接入")
        }
        let command: [String: Any] = ["type": method, "args": args]
        let send = {
            try await self.ensureConnection()
            guard self.targetID == requestedTarget else { throw RemoteFailure.message("目标设备已切换，请在当前设备重新操作。") }
            return try await self.run("const reply=await window.wbRemote.request(command);if(!reply.success)throw new Error(reply.code ?? 'REMOTE_REJECTED');return {result:reply.result ?? null};", ["command": command]) as? [String: Any]
        }
        let readOnly = catalogs.contains(method) || ["list", "get", "requests"].contains(where: {method == "wb:conversations:" + $0})
        let value = try await RemoteRequestRecovery.perform(readOnly: readOnly, operation: send)
        if ["wb:models:list", "wb:models:customs"].contains(method), let result = value?["result"] {
            let items = (result as? [String: Any])?["items"] as? [[String: Any]] ?? result as? [[String: Any]]
            guard let items else { throw RemoteFailure.message("模型列表格式无法识别") }
            // -- 只将名称、标识与状态交给界面；端点、密钥和自定义请求头留在通道侧 --
            let fields = ["id", "name", "label", "displayName", "vendor", "version", "family", "model", "key",
                "custom", "trustLevel", "tags", "disabled", "disabledReason"]
            let models = items.map { item in Dictionary(uniqueKeysWithValues: fields.compactMap { key in
                item[key].map { (key, $0) }
            }) }
            return ["result": ["items": models]]
        }
        return value ?? [:]
    }

    private func ensureConnection() async throws {
        if let renewal { try await renewal.value; return }
        // 将异步状态检查也放入单飞任务，避免多个调用拿旧的 closed 结果重复重连。
        let task = Task {
            let open = (try? await self.run("return window.wbRemote?.socket?.readyState === WebSocket.OPEN;")) as? Bool ?? false
            if !open || self.expiresAt.timeIntervalSinceNow < 60 {
                guard let target = self.targetInfo else { throw RemoteFailure.message("请重新连接目标 Mac") }
                try await self.connect(target)
            }
        }
        renewal = task
        defer { renewal = nil }
        try await task.value
    }

    func disconnect() async {
        _ = try? await run("window.wbRemote?.close();return true;")
        targetID = ""
        targetInfo = nil
    }

    func clearLogin() async {
        await disconnect()
        userID = ""
        profile = [:]
        wireReady = false
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        await web.configuration.websiteDataStore.removeData(ofTypes: types, modifiedSince: .distantPast)
        web.load(URLRequest(url: URL(string: "https://www.workbuddy.cn/app")!))
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        wireReady = false
        targetID = ""
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        onPageReady?()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {decisionHandler(.cancel); return}
        if url.scheme == "https" || url.absoluteString == "about:blank" {decisionHandler(.allow)}
        else {decisionHandler(.cancel)}
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil {webView.load(navigationAction.request)}
        return nil
    }
}
