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
            // Fallback to index.html for SPA router
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
    
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Task cancelled, no-op
    }
    
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
        
        // Use custom URL scheme to bypass file:// CORS and ES module restrictions
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
        
        // Load using our custom scheme
        if let url = URL(string: "readapp://localhost/index.html") {
            webView.load(URLRequest(url: url))
        }
        
        return webView
    }
    
    func updateUIView(_ uiView: WKWebView, context: Context) {}
    
    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    class Coordinator: NSObject, WKScriptMessageHandler {
        var parent: HybridWebView
        
        init(_ parent: HybridWebView) {
            self.parent = parent
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
                    if payload?["text"] is String {
                        LogManager.shared.log("JS Bridge Play TTS", category: "Hybrid")
                        TTSManager.shared.resume() 
                    }
                case "pause":
                    TTSManager.shared.pause()
                case "resume":
                    TTSManager.shared.resume()
                case "stop":
                    TTSManager.shared.stop()
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
            // sync placeholder
        }
    }
}
