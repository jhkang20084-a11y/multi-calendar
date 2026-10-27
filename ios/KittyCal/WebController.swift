import AuthenticationServices
import SwiftUI
import WebKit
import WidgetKit

/// 웹앱(Firebase Hosting)을 앱 안에서 띄우고, 웹앱과 메시지를 주고받는다.
///  웹 → 앱: login(구글 로그인 창), widget(위젯 피드 주소), widgetRefresh, signedOut
///  앱 → 웹: window.__kittyNative(앱 표시), window.__kittyAuthResult(로그인 결과), window.__kittyOpenDate(위젯에서 고른 날짜)
/// 웹 쪽 코드는 src/nativeBridge.js, src/native.js 참고.
final class WebController: NSObject, ObservableObject {
    @Published private(set) var firstLoadDone = false
    @Published private(set) var failed = false

    let webView: WKWebView
    let appURL: URL
    private var authSession: ASWebAuthenticationSession?
    private var pendingDate: String?

    override init() {
        let urlString = Bundle.main.object(forInfoDictionaryKey: "AppURL") as? String ?? ""
        appURL = URL(string: urlString) ?? URL(string: "https://multi-calendar-2c53f.firebaseapp.com")!

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // 로그인·오프라인 데이터 유지
        config.allowsInlineMediaPlayback = true
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1"
        let marker = WKUserScript(
            source: "window.__kittyNative = { platform: 'ios', version: '\(version)' };",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(marker)

        webView = WKWebView(frame: .zero, configuration: config)
        super.init()

        config.userContentController.add(WeakMessageHandler(self), name: "kittyNative")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never // 웹이 safe-area(env)로 직접 여백을 둔다
        webView.allowsBackForwardNavigationGestures = false
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true } // 맥 Safari > 개발자용 메뉴로 확인
        #endif
        reload()
    }

    func reload() {
        failed = false
        webView.load(URLRequest(url: appURL))
    }

    // MARK: 위젯

    private func refreshWidgets() {
        Task {
            _ = try? await SharedStore.refresh() // 위젯이 열리기 전에 미리 받아 둔다
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    /// 위젯 피드 주소는 우리 서버 함수 주소만 받는다
    private func isAllowedFeedURL(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        if url.scheme == "https" && host.hasSuffix(".cloudfunctions.net") { return true }
        #if DEBUG
        if url.scheme == "http" && (host == "127.0.0.1" || host == "localhost") { return true }
        #endif
        return false
    }

    // MARK: 위젯에서 앱 열기 (kittycal://day/2026-10-27)

    func handleOpenURL(_ url: URL) {
        guard url.scheme == "kittycal", url.host == "day" else { return }
        let date = url.lastPathComponent
        guard date.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return }
        pendingDate = date
        deliverPendingDate()
    }

    private func deliverPendingDate() {
        guard let date = pendingDate, firstLoadDone else { return }
        pendingDate = nil
        webView.evaluateJavaScript("window.__kittyPendingDate = '\(date)'; window.__kittyOpenDate && window.__kittyOpenDate('\(date)');")
    }

    // MARK: 구글 로그인 (구글은 앱 안 웹뷰 로그인을 막으므로 Safari 로그인 창을 쓴다)

    private func startLogin() {
        guard authSession == nil else { return }
        var components = URLComponents(url: appURL, resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "nativeLogin", value: "1")]
        guard let url = components?.url else { return sendAuthResult(["error": "failed"]) }
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "kittycal") { [weak self] callbackURL, error in
            DispatchQueue.main.async { self?.finishLogin(callbackURL: callbackURL, error: error) }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false // Safari 에 로그인된 구글 계정을 그대로 고를 수 있게
        authSession = session
        if !session.start() {
            authSession = nil
            sendAuthResult(["error": "failed"])
        }
    }

    private func finishLogin(callbackURL: URL?, error: Error?) {
        authSession = nil
        if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
            return sendAuthResult(["error": "cancelled"])
        }
        let items = callbackURL.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems } ?? []
        guard let idToken = items.first(where: { $0.name == "id_token" })?.value, !idToken.isEmpty else {
            return sendAuthResult(["error": "failed"])
        }
        let accessToken = items.first(where: { $0.name == "access_token" })?.value ?? ""
        sendAuthResult(["idToken": idToken, "accessToken": accessToken])
    }

    private func sendAuthResult(_ result: [String: String]) {
        guard let data = try? JSONSerialization.data(withJSONObject: result),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.__kittyAuthResult && window.__kittyAuthResult(\(json));")
    }

    // MARK: 주소 판별

    fileprivate func isAppPage(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        if host == appURL.host?.lowercased() { return true }
        if host.hasSuffix(".firebaseapp.com") || host.hasSuffix(".web.app") { return true }
        #if DEBUG
        if host == "127.0.0.1" || host == "localhost" { return true }
        #endif
        return false
    }

    fileprivate func handle(message: WKScriptMessage) {
        // 우리 웹앱의 메인 화면에서 온 메시지만 받는다
        guard message.frameInfo.isMainFrame,
              let url = webView.url, isAppPage(url),
              let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }
        switch type {
        case "login":
            startLogin()
        case "widget":
            if let string = body["feedUrl"] as? String, let url = URL(string: string), isAllowedFeedURL(url) {
                SharedStore.feedURL = url
                refreshWidgets()
            }
        case "widgetRefresh":
            refreshWidgets()
        case "signedOut":
            SharedStore.clear()
            WidgetCenter.shared.reloadAllTimelines()
        default:
            break
        }
    }
}

// MARK: - 웹 메시지 (WKUserContentController 가 강하게 잡지 않도록 약한 참조로 감싼다)

private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var owner: WebController?
    init(_ owner: WebController) { self.owner = owner }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.handle(message: message)
    }
}

// MARK: - 페이지 이동

extension WebController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, let scheme = url.scheme?.lowercased() else { return decisionHandler(.cancel) }
        if ["about", "blob", "data"].contains(scheme) { return decisionHandler(.allow) }
        let isMainFrame = action.targetFrame?.isMainFrame ?? false
        if scheme == "http" || scheme == "https" {
            // 로그인 처리용 숨은 창(iframe) 등은 그대로, 다른 사이트로 가는 화면 이동은 밖(Safari·지도 앱)에서 연다
            if !isMainFrame || isAppPage(url) { return decisionHandler(.allow) }
        }
        UIApplication.shared.open(url) // 네이버 지도, 전화, 메일, 카카오톡 공유 등
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        failed = false
        if !firstLoadDone {
            // 첫 화면이 그려질 시간을 조금 준다(깜빡임 방지)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                self?.firstLoadDone = true
                self?.deliverPendingDate()
            }
        } else {
            deliverPendingDate()
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showFailure(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showFailure(error)
    }

    private func showFailure(_ error: Error) {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
        if nsError.domain == "WebKitErrorDomain" && nsError.code == 102 { return } // 밖에서 연 주소(정책으로 취소)
        if !firstLoadDone { failed = true }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload() // 메모리 부족 등으로 웹 화면이 꺼지면 다시 띄운다
    }
}

// MARK: - 새 창, 알림창(alert/confirm/prompt)

extension WebController: WKUIDelegate {
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        // target="_blank" 링크(지도 등)는 밖에서 연다
        if let url = action.request.url { UIApplication.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler() })
        present(alert, orElse: completionHandler)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler(true) })
        present(alert) { completionHandler(false) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
        present(alert) { completionHandler(nil) }
    }

    private func present(_ alert: UIAlertController, orElse fallback: @escaping () -> Void) {
        guard var top = keyWindow()?.rootViewController else { return fallback() }
        while let next = top.presentedViewController { top = next }
        top.present(alert, animated: true)
    }
}

// MARK: - 로그인 창을 띄울 화면

extension WebController: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        keyWindow() ?? ASPresentationAnchor()
    }
}

private func keyWindow() -> UIWindow? {
    UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap(\.windows)
        .first(where: \.isKeyWindow)
}
