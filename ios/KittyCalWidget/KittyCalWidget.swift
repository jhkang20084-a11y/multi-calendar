import SwiftUI
import WidgetKit

@main
struct KittyCalWidgetBundle: WidgetBundle {
    var body: some Widget {
        ScheduleWidget()
    }
}

struct ScheduleWidget: Widget {
    let kind = "ScheduleWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ScheduleProvider()) { entry in
            ScheduleWidgetView(entry: entry)
        }
        .configurationDisplayName("함께 캘린더")
        .description("오늘과 다가오는 일정, 기념일을 보여 줘요.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: - 데이터

struct ScheduleEntry: TimelineEntry {
    enum State {
        case ok
        case notLinked
        case failed
    }

    let date: Date
    let feed: WidgetFeed?
    let state: State
}

struct ScheduleProvider: TimelineProvider {
    func placeholder(in context: Context) -> ScheduleEntry {
        ScheduleEntry(date: .now, feed: .sample, state: .ok)
    }

    func getSnapshot(in context: Context, completion: @escaping (ScheduleEntry) -> Void) {
        if context.isPreview {
            completion(ScheduleEntry(date: .now, feed: SharedStore.cachedFeed() ?? .sample, state: .ok))
            return
        }
        Task { completion(await Self.loadEntry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ScheduleEntry>) -> Void) {
        Task {
            let entry = await Self.loadEntry()
            var entries = [entry]
            // 자정이 지나면 "오늘"이 바뀌도록 다음 날 0시에도 한 번 그린다
            if let midnight = Self.nextMidnight(timeZone: entry.feed?.timeZone) {
                entries.append(ScheduleEntry(date: midnight, feed: entry.feed, state: entry.state))
            }
            // 30분마다 새로 받기 (앱에서 일정을 바꾸면 앱이 바로 새로 고침을 요청한다)
            completion(Timeline(entries: entries, policy: .after(Date.now.addingTimeInterval(30 * 60))))
        }
    }

    static func loadEntry() async -> ScheduleEntry {
        guard SharedStore.feedURL != nil else { return ScheduleEntry(date: .now, feed: nil, state: .notLinked) }
        do {
            let feed = try await SharedStore.refresh()
            return ScheduleEntry(date: .now, feed: feed, state: .ok)
        } catch SharedStore.FetchError.revoked {
            return ScheduleEntry(date: .now, feed: nil, state: .notLinked)
        } catch {
            // 인터넷이 안 되면 마지막으로 받은 일정을 보여 준다
            if let cached = SharedStore.cachedFeed() { return ScheduleEntry(date: .now, feed: cached, state: .ok) }
            return ScheduleEntry(date: .now, feed: nil, state: .failed)
        }
    }

    static func nextMidnight(timeZone: String?) -> Date? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone.flatMap(TimeZone.init(identifier:)) ?? .current
        return calendar.nextDate(after: .now, matching: DateComponents(hour: 0, minute: 0, second: 5), matchingPolicy: .nextTime)
    }
}

// MARK: - 날짜 도우미

struct DayInfo {
    let iso: String
    let date: Date
    let timeZone: TimeZone

    private func format(_ pattern: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ko_KR")
        f.timeZone = timeZone
        f.dateFormat = pattern
        return f.string(from: date)
    }

    var dayNumber: String { format("d") }
    var weekday: String { format("EEEE") }
    var weekdayShort: String { format("E") }
    var monthDay: String { format("M월 d일") }
    var monthName: String { format("LLLL") }
}

extension WidgetFeed {
    /// 위젯을 그리는 시점 기준 오늘 날짜(YYYY-MM-DD)
    func todayISO(at date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: timeZone) ?? .current
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    func info(for iso: String) -> DayInfo {
        let tz = TimeZone(identifier: timeZone) ?? .current
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = tz
        f.dateFormat = "yyyy-MM-dd HH:mm"
        return DayInfo(iso: iso, date: f.date(from: "\(iso) 12:00") ?? .now, timeZone: tz)
    }

    /// 오늘부터의 날들 (지난 날은 뺀다)
    func upcomingDays(at date: Date) -> [Day] {
        let today = todayISO(at: date)
        return days.filter { $0.date >= today }
    }

    /// 오늘·내일·모레, 그 뒤는 "10월 30일 (금)"
    func relativeLabel(_ iso: String, at date: Date) -> String {
        let today = todayISO(at: date)
        let info = info(for: iso)
        let todayInfo = self.info(for: today)
        let diff = Calendar(identifier: .gregorian).dateComponents([.day], from: todayInfo.date, to: info.date).day ?? 0
        switch diff {
        case 0: return "오늘"
        case 1: return "내일"
        case 2: return "모레"
        default: return "\(info.monthDay) (\(info.weekdayShort))"
        }
    }

    /// 지금 이후의 첫 일정 (잠금 화면용)
    func nextItem(at date: Date) -> (day: Day, item: Item)? {
        let today = todayISO(at: date)
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: timeZone) ?? .current
        f.dateFormat = "HH:mm"
        let now = f.string(from: date)
        for day in upcomingDays(at: date) {
            for item in day.items where !item.done {
                if day.date == today, !item.allDay, let end = item.endTime, !end.isEmpty, end <= now { continue }
                return (day, item)
            }
        }
        return nil
    }

    static let sample = WidgetFeed(
        generatedAt: "",
        timeZone: TimeZone.current.identifier,
        today: "",
        calendar: CalendarInfo(name: "우리 캘린더", color: "#E26D93"),
        days: {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.dateFormat = "yyyy-MM-dd"
            let today = Date.now
            let d0 = f.string(from: today)
            let d1 = f.string(from: today.addingTimeInterval(86400))
            return [
                Day(date: d0, holiday: nil, items: [
                    Item(title: "카페 데이트", allDay: false, color: "#E26D93", done: false, calendar: "우리", time: "14:00", endTime: "16:00", span: nil),
                    Item(title: "저녁 약속", allDay: false, color: "#6F95C4", done: false, calendar: "우리", time: "19:00", endTime: "20:30", span: nil),
                ], more: 0),
                Day(date: d1, holiday: nil, items: [
                    Item(title: "제주 여행", allDay: true, color: "#E6A157", done: false, calendar: "우리", time: nil, endTime: nil, span: "1/3"),
                ], more: 0),
            ]
        }(),
        ddays: [DDay(title: "사귄 날", color: "#E26D93", count: "100일째", next: "1주년 D-265", date: "")]
    )
}
