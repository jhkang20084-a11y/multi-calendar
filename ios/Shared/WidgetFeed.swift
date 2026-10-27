import Foundation

/// 서버(widgetFeed)가 보내 주는 위젯 데이터. functions/widget.js 의 buildWidgetFeed 와 같은 모양.
struct WidgetFeed: Codable {
    struct CalendarInfo: Codable {
        let name: String
        let color: String
    }

    struct Item: Codable, Hashable {
        let title: String
        let allDay: Bool
        let color: String
        let done: Bool
        let calendar: String
        let time: String?
        let endTime: String?
        let span: String?
    }

    struct Day: Codable, Hashable {
        let date: String
        let holiday: String?
        let items: [Item]
        let more: Int
    }

    struct DDay: Codable, Hashable {
        let title: String
        let color: String
        let count: String
        let next: String
        let date: String
    }

    let generatedAt: String
    let timeZone: String
    let today: String
    let calendar: CalendarInfo?
    let days: [Day]
    let ddays: [DDay]
}

/// 앱과 위젯이 함께 쓰는 저장소(App Group). 위젯 피드 주소(비밀 토큰 포함)와 마지막으로 받은 데이터를 둔다.
enum SharedStore {
    private static let feedURLKey = "feedURL"
    private static let feedDataKey = "feedData"

    static var groupID: String {
        Bundle.main.object(forInfoDictionaryKey: "AppGroupID") as? String ?? ""
    }

    static var defaults: UserDefaults {
        UserDefaults(suiteName: groupID) ?? .standard
    }

    static var feedURL: URL? {
        get { defaults.string(forKey: feedURLKey).flatMap(URL.init(string:)) }
        set {
            if let newValue { defaults.set(newValue.absoluteString, forKey: feedURLKey) } else { defaults.removeObject(forKey: feedURLKey) }
        }
    }

    static func cachedFeed() -> WidgetFeed? {
        guard let data = defaults.data(forKey: feedDataKey) else { return nil }
        return try? JSONDecoder().decode(WidgetFeed.self, from: data)
    }

    /// 로그아웃: 위젯에서 일정을 지운다
    static func clear() {
        defaults.removeObject(forKey: feedURLKey)
        defaults.removeObject(forKey: feedDataKey)
    }

    enum FetchError: Error {
        case notLinked
        case revoked
        case server(Int)
    }

    /// 서버에서 새 데이터를 받아 저장한다. 연결이 끊겼으면(401) 저장된 것도 지운다.
    @discardableResult
    static func refresh() async throws -> WidgetFeed {
        guard let url = feedURL else { throw FetchError.notLinked }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 {
            clear()
            throw FetchError.revoked
        }
        guard status == 200 else { throw FetchError.server(status) }
        let feed = try JSONDecoder().decode(WidgetFeed.self, from: data)
        defaults.set(data, forKey: feedDataKey)
        return feed
    }
}
