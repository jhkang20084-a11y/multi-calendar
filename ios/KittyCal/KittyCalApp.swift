import SwiftUI
import WidgetKit

@main
struct KittyCalApp: App {
    @StateObject private var web = WebController()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView(web: web)
                .onOpenURL { web.handleOpenURL($0) }
        }
        .onChange(of: scenePhase) { _, phase in
            // 앱을 닫을 때 위젯도 최신으로
            if phase == .background { WidgetCenter.shared.reloadAllTimelines() }
        }
    }
}
