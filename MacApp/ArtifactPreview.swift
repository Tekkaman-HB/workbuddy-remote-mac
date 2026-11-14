/**
 * [INPUT]: 依赖 AppKit、WebKit、preview-theme.js 和已获取的产物原始字节。
 * [OUTPUT]: 提供隔离的右侧网页/文本/PDF/图片预览、主题同步、展开阅读和原文件保存。
 * [POS]: MacApp 的产物展示层；无账号存储、原生消息桥或远端文件系统权限。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import AppKit
import WebKit

@MainActor
final class ArtifactPreview: NSObject, WKNavigationDelegate {
    let view = NSView()
    private let web: WKWebView
    private let title = NSTextField(labelWithString: "文件预览")
    private let save = NSButton()
    private let expand = NSButton()
    private var bytes: Data?
    private var filename = "报告.html"
    private var dark = false
    private let header = NSView()
    var onClose: (() -> Void)?
    var onExpand: (() -> Bool)?

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        web = WKWebView(frame: .zero, configuration: config)
        super.init()
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        view.wantsLayer = true; header.wantsLayer = true
        title.textColor = .labelColor
        title.font = .systemFont(ofSize: 13, weight: .medium)
        title.lineBreakMode = .byTruncatingMiddle
        save.image = NSImage(systemSymbolName: "square.and.arrow.down", accessibilityDescription: "保存到本机")
        save.target = self; save.action = #selector(saveFile); save.bezelStyle = .texturedRounded
        save.toolTip = "保存到本机"; save.isEnabled = false
        let close = NSButton(image: NSImage(systemSymbolName: "xmark", accessibilityDescription: "关闭预览")!, target: self, action: #selector(closePreview))
        close.bezelStyle = .texturedRounded; close.toolTip = "关闭预览"
        expand.image = NSImage(systemSymbolName: "arrow.up.left.and.arrow.down.right", accessibilityDescription: "展开预览")
        expand.target = self; expand.action = #selector(toggleWidth); expand.bezelStyle = .texturedRounded
        expand.toolTip = "展开预览"
        let row = NSStackView(views: [title, save, expand, close]); row.spacing = 10
        row.distribution = .fill
        title.setContentHuggingPriority(NSLayoutConstraint.Priority(1), for: .horizontal)
        [header, web].forEach { $0.translatesAutoresizingMaskIntoConstraints = false; view.addSubview($0) }
        row.translatesAutoresizingMaskIntoConstraints = false; header.addSubview(row)
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: view.topAnchor), header.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor), header.heightAnchor.constraint(equalToConstant: 72),
            row.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 16), row.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -12),
            row.bottomAnchor.constraint(equalTo: header.bottomAnchor, constant: -12),
            web.topAnchor.constraint(equalTo: header.bottomAnchor), web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor), web.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        [save, expand, close].forEach { $0.contentTintColor = .secondaryLabelColor }
        setDark(false)
    }

    func setDark(_ value: Bool) {
        dark = value
        view.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        let background = NSColor(white: dark ? 29.0 / 255 : 1, alpha: 1)
        view.layer?.backgroundColor = background.cgColor
        header.layer?.backgroundColor = background.cgColor
        updateDocumentTheme()
    }
    private var paper: String {dark ? "#1d1d1d" : "#fff"}
    private var ink: String {dark ? "#ececec" : "#171717"}
    private func updateDocumentTheme() {
        web.evaluateJavaScript("document.documentElement.style.colorScheme='\(dark ? "dark" : "light")';document.body.style.backgroundColor='\(paper)';document.body.style.color='\(ink)';document.querySelector('iframe')?.contentWindow.postMessage({type:'workbuddy-preview-theme',dark:\(dark)},'*');", completionHandler: nil)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {updateDocumentTheme()}

    func loading(_ name: String) {
        filename = URL(fileURLWithPath: name).lastPathComponent
        title.stringValue = filename; title.toolTip = filename
        bytes = nil; save.isEnabled = false
        setExpanded(false)
        status("正在获取远端文件…")
    }
    func status(_ text: String) {
        web.loadHTMLString("<html style='color-scheme:\(dark ? "dark" : "light")'><meta charset='utf-8'><body style='font:14px -apple-system;background:\(paper);color:#888;padding:28px'>\(Self.escape(text))</body></html>", baseURL: nil)
    }
    func display(_ data: Data, mime: String) {
        bytes = data; save.isEnabled = true
        let ext = (filename as NSString).pathExtension.lowercased()
        if ["html", "htm"].contains(ext) || mime.lowercased().hasPrefix("text/html") {
            guard let html = String(data: data, encoding: .utf8) else {status("文件编码无法预览，请保存到本机查看。"); return}
            // -- CSP 先于报告执行；报告保留脚本绘图能力，不持有登录态或原生桥 --
            let policy = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com https://cdn.bootcdn.net; style-src 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; img-src data: https:; font-src data: https://fonts.gstatic.com; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"
            let sourceURL = Bundle.main.url(forResource: "preview-theme", withExtension: "js", subdirectory: "UI")
            let themeSource = sourceURL.flatMap { try? String(contentsOf: $0, encoding: .utf8) }?.replacingOccurrences(of: "export function ", with: "function ") ?? ""
            let document = "<meta charset='utf-8'><meta http-equiv='Content-Security-Policy' content=\"\(policy)\">" + "<script>" + themeSource + ";installPreviewTheme(\(dark));</script>" + html
            // -- 不授予 same-origin，隔离报告存储与页面间访问 --
            web.loadHTMLString("<html style='color-scheme:\(dark ? "dark" : "light")'><body style='margin:0;background:\(paper)'><iframe sandbox='allow-scripts' referrerpolicy='no-referrer' style='display:block;border:0;width:100%;height:100vh' srcdoc=\"\(Self.escape(document))\"></iframe></body></html>", baseURL: URL(string: "https://preview.invalid/"))
        } else if mime == "application/pdf" || mime.hasPrefix("image/") {
            web.load(data, mimeType: mime, characterEncodingName: "utf-8", baseURL: URL(string: "https://preview.invalid/")!)
        } else if mime.hasPrefix("text/") || ["md", "json", "csv", "txt"].contains(ext), let text = String(data: data, encoding: .utf8) {
            web.loadHTMLString("<meta charset='utf-8'><pre style='font:13px/1.7 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;padding:20px'>\(Self.escape(text))</pre>", baseURL: nil)
        } else {status("此格式可保存到本机查看。")}
    }
    func clear() {bytes = nil; save.isEnabled = false; web.loadHTMLString("", baseURL: nil)}
    private func setExpanded(_ expanded: Bool) {
        expand.image = NSImage(systemSymbolName: expanded ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right", accessibilityDescription: expanded ? "收起预览" : "展开预览")
        expand.toolTip = expanded ? "收起预览" : "展开预览"
    }
    @objc private func toggleWidth() {setExpanded(onExpand?() ?? false)}
    @objc private func closePreview() {onClose?()}
    @objc private func saveFile() {
        guard let bytes, let window = view.window else {return}
        let panel = NSSavePanel(); panel.nameFieldStringValue = filename
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let url = panel.url else {return}
            do {try bytes.write(to: url, options: .atomic)}
            catch {let alert = NSAlert(error: error); alert.beginSheetModal(for: window)}
        }
    }
    private static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // -- 允许隔离的 srcdoc 子框架，阻止报告自行跳转和新开登录窗口 --
        if action.navigationType == .linkActivated {decisionHandler(.cancel); return}
        let url = action.request.url
        decisionHandler(url?.scheme == "about" || url?.host == "preview.invalid" ? .allow : .cancel)
    }
}
