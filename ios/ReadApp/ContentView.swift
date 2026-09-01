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
                switch action {
                case "play":
                    if let text = payload?["text"] as? String,
                       let currentIndex = payload?["currentIndex"] as? Int,
                       let bookUrl = payload?["bookUrl"] as? String,
                       let bookTitle = payload?["bookTitle"] as? String {
                        var parsedChapters = [BookChapter]()
                        if let chaptersData = payload?["chapters"] as? [[String: Any]] {
                            for c in chaptersData {
                                if let name = c["name"] as? String,
                                   let url = c["url"] as? String,
                                   let idx = c["index"] as? Int {
                                    parsedChapters.append(BookChapter(name: name, url: url, index: idx, cacheStatus: c["cacheStatus"] as? Int))
                                }
                            }
                        }
                        TTSManager.shared.startReading(
                            text: text,
                            chapters: parsedChapters,
                            currentIndex: currentIndex,
                            bookUrl: bookUrl,
                            bookSourceUrl: payload?["bookSourceUrl"] as? String,
                            bookTitle: bookTitle,
                            coverUrl: payload?["coverUrl"] as? String,
                            onChapterChange: { [weak self] newChapterIndex in
                                DispatchQueue.main.async {
                                    self?.webView?.evaluateJavaScript("window.__nativeBridgeTTSChapterChange && window.__nativeBridgeTTSChapterChange(\(newChapterIndex))")
                                }
                            }
                        )
                        LogManager.shared.log("JS Bridge Play TTS Started", category: "Hybrid")
                    }
                case "pause":
                    TTSManager.shared.pause()
                case "resume":
                    TTSManager.shared.resume()
                case "stop":
                    TTSManager.shared.stop()
                case "setConfig":
                    if let config = payload, let speakerId = config["speakerId"] as? String {
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
        
        private func handleSyncControl(action: String, payload: [String: Any]?) {}
        
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
