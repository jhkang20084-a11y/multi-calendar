import SwiftUI
import WebKit

struct ContentView: View {
    @ObservedObject var web: WebController

    var body: some View {
        ZStack {
            Color("LaunchBackground").ignoresSafeArea()
            WebView(webView: web.webView)
                .ignoresSafeArea()
                .opacity(web.firstLoadDone ? 1 : 0)
            if !web.firstLoadDone && !web.failed {
                VStack(spacing: 14) {
                    Image("Kitty")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 120, height: 120)
                    ProgressView()
                }
            }
            if web.failed {
                VStack(spacing: 16) {
                    Image("Kitty")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 110, height: 110)
                    Text("인터넷에 연결할 수 없어요")
                        .font(.system(.headline, design: .rounded))
                        .foregroundStyle(Theme.ink)
                    Text("연결을 확인한 뒤 다시 시도해 주세요.")
                        .font(.system(.subheadline, design: .rounded))
                        .foregroundStyle(Theme.soft)
                    Button("다시 시도") { web.reload() }
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.accent)
                }
                .padding(32)
            }
        }
    }
}

/// WKWebView 를 SwiftUI 에 붙이는 껍데기. 웹뷰는 WebController 가 만들고 계속 들고 있다.
struct WebView: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
