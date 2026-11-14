/**
 * [INPUT]: 依赖 Foundation 的临时 URLSession 和官方产物定位所得 HTTPS URL。
 * [OUTPUT]: 限制大小、禁止降级重定向且不携带登录 Cookie 的原文件下载。
 * [POS]: MacApp 产物传输边界，被 RemoteDelegate 使用，不记录签名链接。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import Foundation

final class ArtifactDownload: NSObject, URLSessionDownloadDelegate {
    static let maximumSize: Int64 = 100 * 1024 * 1024
    private var oversized = false
    func fetch(_ raw: String) async throws -> Data {
        guard let url = URL(string: raw), Self.allowed(url) else {throw RemoteFailure.message("产物下载地址无效")}
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false; config.httpCookieStorage = nil; config.urlCredentialStorage = nil
        config.timeoutIntervalForRequest = 60; config.timeoutIntervalForResource = 90
        let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        defer {session.invalidateAndCancel()}
        do {
            let (file, response) = try await session.download(for: URLRequest(url: url))
            defer {try? FileManager.default.removeItem(at: file)}
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {throw RemoteFailure.message("文件下载失败，请重新获取")}
            let size = (try file.resourceValues(forKeys: [.fileSizeKey])).fileSize ?? 0
            guard size <= Self.maximumSize else {throw RemoteFailure.message("文件超过 100 MB，无法预览")}
            return try Data(contentsOf: file)
        } catch {
            if oversized {throw RemoteFailure.message("文件超过 100 MB，无法预览")}
            if error is RemoteFailure {throw error}
            throw RemoteFailure.message("下载中断，请检查网络后重试")
        }
    }
    static func allowed(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https", let host = url.host?.lowercased(), url.user == nil, url.password == nil else {return false}
        return host != "localhost" && host != "::1" && !host.hasPrefix("127.") && !host.hasSuffix(".local")
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url.map(Self.allowed) == true ? request : nil)
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        if totalBytesWritten > Self.maximumSize || totalBytesExpectedToWrite > Self.maximumSize {oversized = true; downloadTask.cancel()}
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {}
}
