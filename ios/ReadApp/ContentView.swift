import SwiftUI
import WebKit
import AVFoundation

struct ContentView: View {
    var body: some View {
        HybridWebView()
            .edgesIgnoringSafeArea(.all)
    }
}

class LocalSchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(NSError(domain: "LocalScheme", code: -1, userInfo: nil))
            return
        }
        
        var path = url.path
        if path.isEmpty || path == "/" {
            path = "/index.html"
        }
        if path.hasPrefix("/") {
            path.removeFirst()
        }
        
        guard let bundlePath = Bundle.main.path(forResource: "www", ofType: nil) else {
            urlSchemeTask.didFailWithError(NSError(domain: "LocalScheme", code: -1, userInfo: nil))
            return
        }
        
        let fileUrl = URL(fileURLWithPath: bundlePath).appendingPathComponent(path)
        
        do {
            let data = try Data(contentsOf: fileUrl)
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": getMimeType(for: path), "Access-Control-Allow-Origin": "*"])!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            let indexUrl = URL(fileURLWithPath: bundlePath).appendingPathComponent("index.html")
            if let indexData = try? Data(contentsOf: indexUrl) {
                let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "text/html", "Access-Control-Allow-Origin": "*"])!
                urlSchemeTask.didReceive(response)
                urlSchemeTask.didReceive(indexData)
                urlSchemeTask.didFinish()
            } else {
                urlSchemeTask.didFailWithError(error)
            }
        }
    }
    
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
    
    private func getMimeType(for path: String) -> String {
        if path.hasSuffix(".html") { return "text/html" }
        if path.hasSuffix(".css") { return "text/css" }
        if path.hasSuffix(".js") { return "application/javascript" }
        if path.hasSuffix(".svg") { return "image/svg+xml" }
        if path.hasSuffix(".png") { return "image/png" }
        if path.hasSuffix(".ico") { return "image/x-icon" }
        if path.hasSuffix(".json") { return "application/json" }
        return "application/octet-stream"
    }
}

struct HybridWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let webConfiguration = WKWebViewConfiguration()
        webConfiguration.allowsInlineMediaPlayback = true
        webConfiguration.mediaTypesRequiringUserActionForPlayback = []
        webConfiguration.setURLSchemeHandler(LocalSchemeHandler(), forURLScheme: "readapp")
        
        let userContentController = WKUserContentController()
        userContentController.add(context.coordinator, name: "ttsControl")
        userContentController.add(context.coordinator, name: "dataControl")
        userContentController.add(context.coordinator, name: "syncControl")
        webConfiguration.userContentController = userContentController
        
        let webView = WKWebView(frame: .zero, configuration: webConfiguration)
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor.clear
        webView.uiDelegate = context.coordinator
        context.coordinator.webView = webView
        
        if let url = URL(string: "readapp://localhost/index.html") {
            webView.load(URLRequest(url: url))
        }
        return webView
    }
    
    func updateUIView(_ uiView: WKWebView, context: Context) {}
    
    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    class Coordinator: NSObject, WKScriptMessageHandler, WKUIDelegate {
        var parent: HybridWebView
        weak var webView: WKWebView?
        
        init(_ parent: HybridWebView) {
            self.parent = parent
            super.init()
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(onTTSProgress(_:)),
                name: NSNotification.Name("TTSProgressChanged"),
                object: nil
            )
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(onTTSState(_:)),
                name: NSNotification.Name("TTSStateChanged"),
                object: nil
            )
        }
        
        deinit {
            NotificationCenter.default.removeObserver(self)
        }
        
        @objc private func onTTSProgress(_ notification: Notification) {
            guard let index = notification.userInfo?["index"] as? Int else { return }
            DispatchQueue.main.async { [weak self] in
                self?.webView?.evaluateJavaScript("window.__nativeBridgeTTSProgress && window.__nativeBridgeTTSProgress(\(index))")
            }
        }
        
        @objc private func onTTSState(_ notification: Notification) {
            guard let state = notification.userInfo?["state"] as? String else { return }
            DispatchQueue.main.async { [weak self] in
                self?.webView?.evaluateJavaScript("window.__nativeBridgeTTSStateChange && window.__nativeBridgeTTSStateChange('\(state)')")
            }
        }
        
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let dict = message.body as? [String: Any],
                  let action = dict["action"] as? String else { return }
            let payload = dict["payload"] as? [String: Any]
            let callbackId = dict["callbackId"] as? String
            switch message.name {
            case "ttsControl":
                handleTTSControl(action: action, payload: payload)
            case "dataControl":
                handleDataControl(action: action, payload: payload, callbackId: callbackId, webView: message.webView)
            case "syncControl":
                handleSyncControl(action: action, payload: payload)
            default:
                break
            }
        }
        
        private func handleTTSControl(action: String, payload: [String: Any]?) {
            DispatchQueue.main.async {
                LogManager.shared.log("接收到 TTS 控制指令: action=\(action), payload=\(String(describing: payload))", category: "Hybrid")
                switch action {
                case "play":
                    let text = payload?["text"] as? String
                    let currentIndex = (payload?["currentIndex"] as? Int) ?? (payload?["currentIndex"] as? Double).map { Int($0) }
                    let bookUrl = payload?["bookUrl"] as? String
                    let bookTitle = payload?["bookTitle"] as? String ?? "未知书名"
                    
                    guard let validText = text,
                          let validIndex = currentIndex,
                          let validBookUrl = bookUrl else {
                        LogManager.shared.log("❌ 朗读功能启动失败：缺少必要参数。text=\(text != nil), index=\(currentIndex != nil), bookUrl=\(bookUrl != nil)", category: "TTS错误")
                        return
                    }
                    
                    var parsedChapters = [BookChapter]()
                    if let chaptersData = payload?["chapters"] as? [[String: Any]] {
                        for c in chaptersData {
                            if let name = (c["name"] as? String) ?? (c["title"] as? String),
                               let idx = (c["index"] as? Int) ?? (c["index"] as? Double).map({ Int($0) }) {
                                parsedChapters.append(BookChapter(title: name, url: url, index: idx, isVolume: nil, isPay: nil))
                            }
                        }
                    }
                    
                    TTSManager.shared.startReading(
                        text: validText,
                        chapters: parsedChapters,
                        currentIndex: validIndex,
                        bookUrl: validBookUrl,
                        bookSourceUrl: payload?["bookSourceUrl"] as? String,
                        bookTitle: bookTitle,
                        coverUrl: payload?["coverUrl"] as? String,
                        onChapterChange: { [weak self] newChapterIndex in
                            DispatchQueue.main.async {
                                self?.webView?.evaluateJavaScript("window.__nativeBridgeTTSChapterChange && window.__nativeBridgeTTSChapterChange(\(newChapterIndex))")
                            }
                        }
                    )
                    LogManager.shared.log("✅ JS Bridge Play TTS Started", category: "Hybrid")
                case "pause":
                    TTSManager.shared.pause()
                case "resume":
                    TTSManager.shared.resume()
                case "stop":
                    TTSManager.shared.stop()
                case "setConfig":
                    if let config = payload {
                        let speakerId: String?
                        if let s = config["speakerId"] as? String {
                            speakerId = s
                        } else if let n = config["speakerId"] as? Int {
                            speakerId = String(n)
                        } else if let d = config["speakerId"] as? Double {
                            speakerId = String(Int(d))
                        } else {
                            speakerId = nil
                        }
                        
                        if let speakerId = speakerId {
                            UserPreferences.shared.selectedTTSId = speakerId
                            if let preload = config["preloadCount"] as? Int {
                                UserPreferences.shared.setPreloadCount(preload, for: speakerId)
                            }
                            if let gap = config["gapReduction"] as? Double {
                                UserPreferences.shared.setGapReduction(gap, for: speakerId)
                            }
                            if let rate = config["speechRate"] as? Double {
                                UserPreferences.shared.setSpeechRate(rate, for: speakerId)
                            }
                        }
                        
                        if let url = config["serverURL"] as? String, !url.isEmpty {
                            UserPreferences.shared.serverURL = url
                        }
                        if let token = config["accessToken"] as? String, !token.isEmpty {
                            UserPreferences.shared.accessToken = token
                        }
                    }
                default:
                    break
                }
            }
        }
        
        private func handleDataControl(action: String, payload: [String: Any]?, callbackId: String?, webView: WKWebView?) {
            if let callbackId = callbackId {
                let js = "window.__nativeBridgeCallback('\(callbackId)', null, null);"
                DispatchQueue.main.async {
                    webView?.evaluateJavaScript(js)
                }
            }
        }
        
        private func handleSyncControl(action: String, payload: [String: Any]?) {
            LogManager.shared.log("接收到 Sync 控制指令: action=\(action), payload=\(String(describing: payload))", category: "Hybrid")
            if action == "saveProgress" {
                guard let p = payload, let url = p["bookUrl"] as? String else {
                    LogManager.shared.log("❌ 进度同步失败：缺少 bookUrl", category: "网络")
                    return
                }
                guard let index = (p["chapterIndex"] as? Int) ?? (p["chapterIndex"] as? Double).map({ Int($0) }) ?? (p["index"] as? Int) ?? (p["index"] as? Double).map({ Int($0) }) else {
                    LogManager.shared.log("❌ 进度同步失败：缺少或无效的 chapterIndex/index", category: "网络")
                    return
                }
                if let url = p["serverURL"] as? String, !url.isEmpty {
                    UserPreferences.shared.serverURL = url
                }
                if let token = p["accessToken"] as? String, !token.isEmpty {
                    UserPreferences.shared.accessToken = token
                }
                let pos = p["chapterPos"] as? Double ?? p["position"] as? Double ?? 0
                Task {
                    do {
                        try await APIService.shared.saveBookProgress(bookUrl: url, index: index, pos: pos, title: nil)
                        LogManager.shared.log("✅ 进度同步成功", category: "网络")
                    } catch {
                        LogManager.shared.log("❌ 进度同步失败: \(error.localizedDescription)", category: "网络")
                    }
                }
            } else if action == "exportLogs" {
                DispatchQueue.main.async {
                    if let url = LogManager.shared.exportLogs() {
                        let activityVC = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                           let rootViewController = windowScene.windows.first?.rootViewController {
                            var topController = rootViewController
                            while let presented = topController.presentedViewController { topController = presented }
                            if let popover = activityVC.popoverPresentationController {
                                popover.sourceView = topController.view
                                popover.sourceRect = CGRect(x: topController.view.bounds.midX, y: topController.view.bounds.midY, width: 0, height: 0)
                                popover.permittedArrowDirections = []
                            }
                            topController.present(activityVC, animated: true, completion: nil)
                        }
                    }
                }
            }
        }
        
        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            let alert = UIAlertController(title: "提示", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "取消", style: .cancel, handler: { _ in completionHandler(false) }))
            alert.addAction(UIAlertAction(title: "确定", style: .default, handler: { _ in completionHandler(true) }))
            if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
               let rootViewController = windowScene.windows.first?.rootViewController {
                var topController = rootViewController
                while let presented = topController.presentedViewController { topController = presented }
                topController.present(alert, animated: true, completion: nil)
            } else {
                completionHandler(false)
            }
        }
        
        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            let alert = UIAlertController(title: "提示", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "确定", style: .default, handler: { _ in completionHandler() }))
            if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
               let rootViewController = windowScene.windows.first?.rootViewController {
                var topController = rootViewController
                while let presented = topController.presentedViewController { topController = presented }
                topController.present(alert, animated: true, completion: nil)
            } else {
                completionHandler()
            }
        }
    }
}
