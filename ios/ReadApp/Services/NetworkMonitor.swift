import Foundation
import Network
import WebKit

final class NetworkMonitor {
    static let shared = NetworkMonitor()
    
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.readapp.networkmonitor")
    
    private(set) var isOnline: Bool = true
    private(set) var isExpensive: Bool = false
    
    weak var webView: WKWebView? {
        didSet {
            // 当绑定的 webView 准备好时，立即推送一次当前网络状态
            notifyWebView()
        }
    }
    
    private var isStarted = false
    
    private init() {}
    
    func startMonitoring() {
        guard !isStarted else { return }
        isStarted = true
        
        monitor.pathUpdateHandler = { [weak self] path in
            guard let self = self else { return }
            let online = (path.status == .satisfied)
            let expensive = path.isExpensive
            
            let statusChanged = (self.isOnline != online)
            self.isOnline = online
            self.isExpensive = expensive
            
            if statusChanged {
                LogManager.shared.log("网络状态变更: \(online ? "已联网" : "已离线/飞行模式") (蜂窝/热点: \(expensive))", category: "网络")
                self.notifyWebView()
            }
        }
        monitor.start(queue: queue)
    }
    
    func stopMonitoring() {
        guard isStarted else { return }
        monitor.cancel()
        isStarted = false
    }
    
    func notifyWebView() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let webView = self.webView else { return }
            let script = "if (window.__onNativeNetworkChange) { window.__onNativeNetworkChange(\(self.isOnline)); }"
            webView.evaluateJavaScript(script, completionHandler: nil)
        }
    }
}
