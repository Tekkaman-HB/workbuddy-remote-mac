/**
 * [INPUT]: 依赖 AppKit、WebKit、SessionBridge 和内置 UI 资源。
 * [OUTPUT]: 提供独立应用窗口、官方登录窗口及受限原生消息桥。
 * [POS]: MacApp 的原生入口，界面由 ui/ 渲染，账号凭证仅留在 SessionBridge。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import AppKit
import WebKit

@main
enum RemoteMain {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = RemoteDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
        _ = delegate
    }
}

@MainActor
final class RemoteDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    private let bridge = SessionBridge()
    private var window: NSWindow!
    private var page: WKWebView!
    private var loginWindow: NSWindow?
    private let loginNotice = NSTextField(labelWithString: "请完成官方账号登录，再点击下方按钮。")
    private var targets: [[String: Any]] = []
    private var pageReady = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(self, name: "native")
        page = WKWebView(frame: .zero, configuration: config)
        page.navigationDelegate = self
        page.setValue(false, forKey: "drawsBackground")
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 770),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = "WorkBuddy Remote"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = false
        window.minSize = NSSize(width: 900, height: 600)
        window.backgroundColor = NSColor(white: 0.97, alpha: 1)
        window.contentView = page
        window.center()
        if let file = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "UI") {
            page.loadFileURL(file, allowingReadAccessTo: file.deletingLastPathComponent())
        }
        bridge.onPageReady = { [weak self] in self?.event("authReady", [:]) }
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    private func buildMenu() {
        let menu = NSMenu(); let item = NSMenuItem(); menu.addItem(item)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "设置…", action: #selector(settings), keyEquivalent: ",")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "退出 WorkBuddy Remote", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.submenu = appMenu
        let edit = NSMenuItem(); menu.addItem(edit); let editMenu = NSMenu(title: "编辑")
        for (title, action, key) in [("撤销", "undo:", "z"), ("剪切", "cut:", "x"), ("拷贝", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        edit.submenu = editMenu; NSApplication.shared.mainMenu = menu
    }

    @objc private func settings() {event("settings", [:])}

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.isFileURL == true,
              let body = message.body as? [String: Any], let id = body["id"] as? String,
              let action = body["action"] as? String else {return}
        let args = body["args"] as? [String: Any] ?? [:]
        Task {
            do {reply(id, value: try await handle(action, args))}
            catch {reply(id, error: error.localizedDescription)}
        }
    }

    private func handle(_ action: String, _ args: [String: Any]) async throws -> Any {
        switch action {
        case "ready":
            pageReady = true
            return ["preferredDevice": UserDefaults.standard.string(forKey: "preferredRemoteDevice") ?? ""]
        case "devices":
            targets = try await bridge.devices()
            return ["items": targets, "profile": bridge.profile]
        case "connect":
            guard let id = args["deviceId"] as? String, let device = targets.first(where: {($0["deviceId"] as? String) == id}) else {
                throw RemoteFailure.message("请刷新设备列表后重试")
            }
            try await bridge.connect(device)
            UserDefaults.standard.set(id, forKey: "preferredRemoteDevice")
            return device
        case "rpc":
            guard let method = args["method"] as? String, let values = args["values"] as? [Any] else {throw RemoteFailure.message("请求格式错误")}
            return try await bridge.invoke(method, values)["result"] ?? NSNull()
        case "login": showLogin(); return true
        case "logout":
            await bridge.clearLogin(); targets = []
            UserDefaults.standard.removeObject(forKey: "preferredRemoteDevice")
            return true
        case "copy":
            guard let text = args["text"] as? String else {return false}
            NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string)
            return true
        case "open":
            guard let raw = args["url"] as? String, let url = URL(string: raw), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
                throw RemoteFailure.message("仅支持打开 HTTP 或 HTTPS 链接")
            }
            NSWorkspace.shared.open(url); return true
        default: throw RemoteFailure.message("未知界面动作")
        }
    }

    private func reply(_ id: String, value: Any = NSNull(), error: String? = nil) {
        evaluate("nativeReply", ["id": id, "value": value, "error": error.map {$0 as Any} ?? NSNull()])
    }
    private func event(_ type: String, _ data: [String: Any]) {
        guard pageReady else {return}
        evaluate("nativeEvent", ["type": type, "data": data])
    }
    private func evaluate(_ name: String, _ value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
              let json = String(data: data, encoding: .utf8) else {return}
        page.evaluateJavaScript("window.\(name)?.(\(json))", completionHandler: nil)
    }

    @objc private func showLogin() {
        if let panel = loginWindow {panel.makeKeyAndOrderFront(nil); return}
        let panel = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 960, height: 690),
            styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        panel.title = "使用普通 WorkBuddy 账号登录 · 官方网页"; panel.isReleasedWhenClosed = false
        let stack = NSStackView(); stack.orientation = .vertical; stack.spacing = 8
        stack.addArrangedSubview(loginNotice); stack.addArrangedSubview(bridge.web)
        stack.addArrangedSubview(NSButton(title: "登录完成，读取设备", target: self, action: #selector(finishLogin)))
        panel.contentView = stack
        bridge.web.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        bridge.web.heightAnchor.constraint(greaterThanOrEqualToConstant: 500).isActive = true
        loginWindow = panel; panel.center(); panel.makeKeyAndOrderFront(nil)
    }
    @objc private func finishLogin() {
        loginNotice.stringValue = "正在读取设备…"
        Task {
            do {
                targets = try await bridge.devices()
                loginWindow?.orderOut(nil); window.makeKeyAndOrderFront(nil)
                loginNotice.stringValue = "已登录。"
                event("signedIn", ["items": targets, "profile": bridge.profile])
            } catch {loginNotice.stringValue = "读取失败：" + error.localizedDescription}
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url {
            if ["http", "https"].contains(url.scheme ?? "") {NSWorkspace.shared.open(url)}
            decisionHandler(.cancel); return
        }
        decisionHandler(navigationAction.request.url?.isFileURL == true ? .allow : .cancel)
    }
}
