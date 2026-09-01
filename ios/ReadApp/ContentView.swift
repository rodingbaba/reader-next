import SwiftUI
import WebKit
import AVFoundation

struct ContentView: View {
    var body: some View {
        HybridWebView()
            .edgesIgnoringSafeArea(.all)
    }
}

struct HybridWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let preferences = WKPreferences()
        
        let webConfiguration = WKWebViewConfiguration()
        webConfiguration.preferences = preferences
        webConfiguration.allowsInlineMediaPlayback = true
        webConfiguration.mediaTypesRequiringUserActionForPlayback = []
        
        let userContentController = WKUserContentController()
        userContentController.add(context.coordinator, name: "ttsControl")
        userContentController.add(context.coordinator, name: "dataControl")
        userContentController.add(context.coordinator, name: "syncControl")
        webConfiguration.userContentController = userContentController
        
        let webView = WKWebView(frame: .zero, configuration: webConfiguration)
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor.clear
        
        if let bundlePath = Bundle.main.path(forResource: "www", ofType: nil),
           let htmlPath = Bundle.main.path(forResource: "index", ofType: "html", inDirectory: "www") {
            let url = URL(fileURLWithPath: htmlPath)
            let readAccessUrl = URL(fileURLWithPath: bundlePath)
            webView.loadFileURL(url, allowingReadAccessTo: readAccessUrl)
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
                    if let text = payload?["text"] as? String {
                        LogManager.shared.log("JS Bridge Play TTS", category: "Hybrid")
                        // In a full implementation, we'd pass chapters and trigger startReading.
                        // Here we just resume or restart.
                        TTSManager.shared.resume() 
                    }
                case "pause":
                    TTSManager.shared.pause()
                case "resume":
                    TTSManager.shared.resume()
                case "stop":
                    TTSManager.shared.stop(clearQueue: true)
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
