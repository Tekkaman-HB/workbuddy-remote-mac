/**
 * [INPUT]: 依赖 AppKit、WebKit、SessionBridge、ArtifactPreview、ArtifactDownload 和内置 UI 资源。
 * [OUTPUT]: 独立窗口、受限顶部拖动/双击缩放、官方登录、主题同步及点击附件后直接验证/获取/预览的原生桥。
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
final class RemoteDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSSplitViewDelegate {
    private let bridge = SessionBridge()
    private var window: NSWindow!
    private var page: WKWebView!
    private var loginWindow: NSWindow?
    private let loginNotice = NSTextField(labelWithString: "请完成官方账号登录，再点击下方按钮。")
    private var targets: [[String: Any]] = []
    private var pageReady = false
    private let split = NSSplitView()
    private let preview = ArtifactPreview()
    private var previewRevision = 0
    private var cachedArtifact: (key: String, bytes: Data, mime: String)?
    private var mouseDownMonitor: Any?
    private var windowMouseDown: NSEvent?

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        if let iconURL = Bundle.main.url(forResource: "WorkBuddyRemote", withExtension: "icns"),
           let icon = NSImage(contentsOf: iconURL) {
            NSApplication.shared.applicationIconImage = icon
        }
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
        // WKWebView 会消耗标题区鼠标事件；保留真实按下事件，供受限页面入口启动 AppKit 拖动。
        mouseDownMonitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
            if event.window === self?.window { self?.windowMouseDown = event }
            return event
        }
        window.minSize = NSSize(width: 900, height: 600)
        window.backgroundColor = NSColor(white: 0.97, alpha: 1)
        split.isVertical = true; split.dividerStyle = .thin; split.delegate = self
        split.addArrangedSubview(page)
        window.contentView = split
        preview.onClose = { [weak self] in self?.closePreview() }
        preview.onExpand = { [weak self] in
            guard let self else {return false}
            if self.page.superview != nil {self.page.removeFromSuperview(); self.split.adjustSubviews(); return true}
            self.split.insertArrangedSubview(self.page, at: 0); self.split.adjustSubviews()
            self.split.setPosition(self.split.bounds.width * 0.53, ofDividerAt: 0)
            return false
        }
        window.center()
        if let file = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "UI") {
            page.loadFileURL(file, allowingReadAccessTo: file.deletingLastPathComponent())
        }
        bridge.onPageReady = { [weak self] in self?.event("authReady", [:]) }
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        if let mouseDownMonitor { NSEvent.removeMonitor(mouseDownMonitor) }
    }

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
            catch {
                if bridge.authStatus == "signedOut" {event("authState", ["status": "signedOut", "profile": [:]])}
                reply(id, error: error.localizedDescription)
            }
        }
    }

    private func handle(_ action: String, _ args: [String: Any]) async throws -> Any {
        switch action {
        case "dragWindow":
            guard let event = windowMouseDown, event.window === window,
                  NSEvent.pressedMouseButtons & 1 == 1,
                  ProcessInfo.processInfo.systemUptime - event.timestamp < 1 else { return false }
            let point = page.convert(event.locationInWindow, from: nil)
            let fromTop = page.isFlipped ? point.y : page.bounds.height - point.y
            guard (0...58).contains(fromTop) else { return false }
            windowMouseDown = nil
            if event.clickCount == 2 { window.performZoom(nil) }
            else { window.performDrag(with: event) }
            return true
        case "appearance":
            guard let theme = args["theme"] as? String, ["light", "dark"].contains(theme) else {throw RemoteFailure.message("主题格式错误")}
            let preference = args["preference"] as? String ?? theme
            guard ["system", "light", "dark"].contains(preference) else {throw RemoteFailure.message("主题格式错误")}
            // -- 跟随系统时解除窗口覆盖，避免 WebKit 把上次手选外观误认成系统主题 --
            window.appearance = preference == "system" ? nil : NSAppearance(named: preference == "dark" ? .darkAqua : .aqua)
            let dark = preference == "system" ? NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua : preference == "dark"
            window.backgroundColor = NSColor(white: dark ? 29.0 / 255 : 1, alpha: 1)
            preview.setDark(dark)
            return ["theme": dark ? "dark" : "light"]
        case "ready":
            pageReady = true
            return ["preferredDevice": UserDefaults.standard.string(forKey: "preferredRemoteDevice") ?? ""]
        case "authStatus":
            return ["status": bridge.authStatus, "profile": bridge.profile]
        case "devices":
            targets = try await bridge.devices()
            return ["items": targets, "profile": bridge.profile]
        case "artifactClose": closePreview(); return true
        case "artifactOpen": return try await openArtifact(args)
        case "connect":
            cachedArtifact = nil
            closePreview()
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
            cachedArtifact = nil
            closePreview()
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

    func splitView(_ splitView: NSSplitView, constrainSplitPosition proposedPosition: CGFloat, ofSubviewAt dividerIndex: Int) -> CGFloat {
        min(max(400, proposedPosition), splitView.bounds.width - 321)
    }

    private func closePreview() {
        previewRevision += 1
        preview.clear(); preview.view.removeFromSuperview()
        if page.superview == nil {split.addArrangedSubview(page)}
        split.adjustSubviews()
        event("artifactPreview", ["open": false])
    }

    private func openArtifact(_ args: [String: Any]) async throws -> Bool {
        guard let conversation = args["conversationId"] as? String,
              let artifactID = args["artifactId"] as? String else {throw RemoteFailure.message("缺少文件标识")}
        closePreview()
        let revision = previewRevision, target = bridge.targetID
        let result = try await bridge.invoke("wb:artifacts:list", [["conversationId": conversation]])["result"]
        let items = (result as? [[String: Any]]) ?? (result as? [String: Any])?["items"] as? [[String: Any]] ?? []
        guard revision == previewRevision, target == bridge.targetID else {return false}
        guard let item = items.first(where: {($0["id"] as? String ?? $0["artifactId"] as? String) == artifactID}) else {
            throw RemoteFailure.message("文件已不在当前任务中，请刷新文件列表")
        }
        let cacheKey = target + "|" + conversation + "|" + artifactID + "|" + String(describing: item["updatedAt"] ?? "")
        let name = item["title"] as? String ?? item["name"] as? String ?? "文件"
        let mime = item["mimeType"] as? String ?? item["contentType"] as? String ?? "application/octet-stream"
        preview.loading(name)
        split.addArrangedSubview(preview.view); split.adjustSubviews()
        event("artifactPreview", ["open": true])
        split.setPosition(max(400, split.bounds.width * 0.53), ofDividerAt: 0)
        if let cached = cachedArtifact, cached.key == cacheKey {
            preview.display(cached.bytes, mime: cached.mime); return true
        }
        do {
            let detail = try await bridge.invoke("wb:artifacts:get", [["artifactId": artifactID]])["result"] as? [String: Any] ?? [:]
            guard revision == previewRevision, target == bridge.targetID else {return false}
            if let content = detail["content"] as? String, !content.isEmpty,
               !mime.hasPrefix("text/html") || content.range(of: "<(?:!doctype|html)", options: [.regularExpression, .caseInsensitive]) != nil {
                let data = Data(content.utf8)
                cachedArtifact = (cacheKey, data, mime)
                preview.display(data, mime: mime); return true
            }
            let location = try await bridge.invoke("wb:artifacts:locate", [["artifactId": artifactID]], allowArtifactTransfer: true)["result"] as? [String: Any]
            guard revision == previewRevision, target == bridge.targetID else {return false}
            guard let url = location?["url"] as? String else {throw RemoteFailure.message("远端未返回可下载的文件地址")}
            let data = try await ArtifactDownload().fetch(url)
            guard revision == previewRevision, target == bridge.targetID else {return false}
            let resolvedMime = location?["contentType"] as? String ?? mime
            cachedArtifact = (cacheKey, data, resolvedMime)
            preview.display(data, mime: resolvedMime)
            return true
        } catch {
            if revision == previewRevision {preview.status(error.localizedDescription)}
            throw error
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
            } catch {
                event("authState", ["status": bridge.authStatus, "profile": bridge.profile])
                loginNotice.stringValue = bridge.authStatus == "signedOut" ? "请先完成上方的账号登录和账号选择，再读取设备。" : "读取失败：" + error.localizedDescription
            }
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
