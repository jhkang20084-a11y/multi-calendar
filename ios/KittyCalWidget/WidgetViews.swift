import SwiftUI
import WidgetKit

struct ScheduleWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ScheduleEntry

    var body: some View {
        content
            .containerBackground(for: .widget) {
                if family == .accessoryRectangular || family == .accessoryInline {
                    Color.clear
                } else {
                    LinearGradient(colors: [Theme.pinkTop, Theme.pinkBottom], startPoint: .top, endPoint: .bottom)
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch (entry.state, entry.feed) {
        case (.ok, let feed?):
            switch family {
            case .systemSmall: SmallView(feed: feed, now: entry.date)
            case .systemMedium: MediumView(feed: feed, now: entry.date)
            case .systemLarge: LargeView(feed: feed, now: entry.date)
            case .accessoryRectangular: LockRectangularView(feed: feed, now: entry.date)
            case .accessoryInline: LockInlineView(feed: feed, now: entry.date)
            default: SmallView(feed: feed, now: entry.date)
            }
        default:
            MessageView(state: entry.state, family: family)
        }
    }
}

// MARK: - 공통 조각

private let rounded = Font.Design.rounded

struct ItemRow: View {
    let item: WidgetFeed.Item
    var compact = false

    var body: some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Color(hex: item.color))
                .frame(width: 3.5, height: compact ? 12 : 14)
            Text(timeLabel)
                .font(.system(size: compact ? 9.5 : 10.5, weight: .medium, design: rounded))
                .monospacedDigit()
                .foregroundStyle(Theme.soft)
                .frame(minWidth: compact ? 26 : 30, alignment: .leading)
            Text(item.title)
                .font(.system(size: compact ? 11.5 : 12.5, weight: .semibold, design: rounded))
                .foregroundStyle(item.done ? Theme.soft : Theme.ink)
                .strikethrough(item.done, color: Theme.soft)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
    }

    private var timeLabel: String {
        if item.allDay { return item.span.map { "\($0)일" } ?? "종일" }
        if let t = item.time, !t.isEmpty { return t }
        return "계속"
    }
}

struct KittyBadge: View {
    var size: CGFloat = 36

    var body: some View {
        Image("Kitty")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .widgetAccentable(false)
    }
}

struct DateBlock: View {
    let info: DayInfo
    let holiday: String?
    var big: CGFloat = 30

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(info.weekday)
                .font(.system(size: 11, weight: .bold, design: rounded))
                .foregroundStyle(holiday != nil ? Theme.holiday : Theme.accent)
            Text(info.dayNumber)
                .font(.system(size: big, weight: .heavy, design: rounded))
                .foregroundStyle(holiday != nil ? Theme.holiday : Theme.ink)
                .minimumScaleFactor(0.7)
            if let holiday {
                Text(holiday)
                    .font(.system(size: 9.5, weight: .semibold, design: rounded))
                    .foregroundStyle(Theme.holiday)
                    .lineLimit(1)
            }
        }
    }
}

struct EmptyLine: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .medium, design: rounded))
            .foregroundStyle(Theme.soft)
    }
}

struct MoreLine: View {
    let count: Int

    var body: some View {
        if count > 0 {
            Text("+\(count)개 더")
                .font(.system(size: 9.5, weight: .semibold, design: rounded))
                .foregroundStyle(Theme.accent)
        }
    }
}

struct DDayChip: View {
    let dday: WidgetFeed.DDay

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "heart.fill")
                .font(.system(size: 8))
                .foregroundStyle(Color(hex: dday.color))
            Text(dday.title)
                .font(.system(size: 10, weight: .semibold, design: rounded))
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
            Text(dday.count)
                .font(.system(size: 10, weight: .heavy, design: rounded))
                .foregroundStyle(Theme.accent)
                .lineLimit(1)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(Capsule().fill(.white.opacity(0.65)))
    }
}

// MARK: - 작은 위젯: 오늘

struct SmallView: View {
    let feed: WidgetFeed
    let now: Date

    var body: some View {
        let todayISO = feed.todayISO(at: now)
        let today = feed.days.first { $0.date == todayISO }
        let items = today?.items ?? []
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top) {
                DateBlock(info: feed.info(for: todayISO), holiday: today?.holiday, big: 28)
                Spacer(minLength: 0)
                KittyBadge(size: 40)
            }
            if items.isEmpty {
                EmptyLine(text: "오늘은 쉬는 날 ♡")
            } else {
                ForEach(Array(items.prefix(3).enumerated()), id: \.offset) { _, item in
                    ItemRow(item: item, compact: true)
                }
                MoreLine(count: max(0, items.count - 3) + (today?.more ?? 0))
            }
            Spacer(minLength: 0)
        }
        .widgetURL(URL(string: "kittycal://day/\(todayISO)"))
    }
}

// MARK: - 중간 위젯: 오늘 + 다가오는 일정

struct MediumView: View {
    let feed: WidgetFeed
    let now: Date

    var body: some View {
        let todayISO = feed.todayISO(at: now)
        let today = feed.days.first { $0.date == todayISO }
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                DateBlock(info: feed.info(for: todayISO), holiday: today?.holiday, big: 34)
                Spacer(minLength: 0)
                KittyBadge(size: 54)
            }
            .frame(width: 92, alignment: .leading)
            VStack(alignment: .leading, spacing: 3) {
                UpcomingList(feed: feed, now: now, maxRows: 5, compact: true)
                Spacer(minLength: 0)
            }
        }
        .widgetURL(URL(string: "kittycal://day/\(todayISO)"))
    }
}

/// 날짜별 머리글 + 일정 (최대 maxRows 줄)
struct UpcomingList: View {
    let feed: WidgetFeed
    let now: Date
    let maxRows: Int
    var compact = false

    private struct Row: Identifiable {
        let id: Int
        let header: WidgetFeed.Day?
        let item: WidgetFeed.Item?
    }

    private var rows: [Row] {
        var out: [Row] = []
        var used = 0
        for day in feed.upcomingDays(at: now) where !day.items.isEmpty {
            if used + 2 > maxRows { break } // 머리글만 덩그러니 남지 않게
            out.append(Row(id: out.count, header: day, item: nil))
            used += 1
            for item in day.items {
                if used >= maxRows { break }
                out.append(Row(id: out.count, header: nil, item: item))
                used += 1
            }
        }
        return out
    }

    var body: some View {
        let list = rows
        if list.isEmpty {
            EmptyLine(text: "다가오는 2주 동안 일정이 없어요 ♡")
        } else {
            ForEach(list) { row in
                if let day = row.header {
                    Link(destination: URL(string: "kittycal://day/\(day.date)")!) {
                        HStack(spacing: 4) {
                            Text(feed.relativeLabel(day.date, at: now))
                                .font(.system(size: compact ? 10 : 11, weight: .heavy, design: rounded))
                                .foregroundStyle(day.holiday != nil ? Theme.holiday : Theme.accent)
                            if let holiday = day.holiday {
                                Text(holiday)
                                    .font(.system(size: 9, weight: .semibold, design: rounded))
                                    .foregroundStyle(Theme.holiday)
                                    .lineLimit(1)
                            }
                        }
                        .padding(.top, row.id == 0 ? 0 : 2)
                    }
                } else if let item = row.item {
                    ItemRow(item: item, compact: compact)
                }
            }
        }
    }
}

// MARK: - 큰 위젯: 앞으로 일정 + 기념일

struct LargeView: View {
    let feed: WidgetFeed
    let now: Date

    var body: some View {
        let todayISO = feed.todayISO(at: now)
        let info = feed.info(for: todayISO)
        let today = feed.days.first { $0.date == todayISO }
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center, spacing: 10) {
                DateBlock(info: info, holiday: today?.holiday, big: 34)
                VStack(alignment: .leading, spacing: 1) {
                    Text(info.monthName)
                        .font(.system(size: 13, weight: .bold, design: rounded))
                        .foregroundStyle(Theme.ink)
                    if let name = feed.calendar?.name {
                        Text(name)
                            .font(.system(size: 10.5, weight: .medium, design: rounded))
                            .foregroundStyle(Theme.soft)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                KittyBadge(size: 62)
            }
            Divider().overlay(Theme.accent.opacity(0.35))
            UpcomingList(feed: feed, now: now, maxRows: feed.ddays.isEmpty ? 12 : 10)
            Spacer(minLength: 0)
            if !feed.ddays.isEmpty {
                HStack(spacing: 6) {
                    ForEach(feed.ddays.prefix(2), id: \.self) { DDayChip(dday: $0) }
                }
            }
        }
        .widgetURL(URL(string: "kittycal://day/\(todayISO)"))
    }
}

// MARK: - 잠금 화면

struct LockRectangularView: View {
    let feed: WidgetFeed
    let now: Date

    var body: some View {
        if let next = feed.nextItem(at: now) {
            VStack(alignment: .leading, spacing: 1) {
                Text("\(feed.relativeLabel(next.day.date, at: now)) \(next.item.allDay ? "종일" : (next.item.time ?? ""))")
                    .font(.system(size: 12, weight: .semibold, design: rounded))
                    .widgetAccentable()
                Text(next.item.title)
                    .font(.system(size: 15, weight: .bold, design: rounded))
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            Text("다가오는 일정이 없어요")
                .font(.system(size: 13, weight: .semibold, design: rounded))
        }
    }
}

struct LockInlineView: View {
    let feed: WidgetFeed
    let now: Date

    var body: some View {
        if let next = feed.nextItem(at: now) {
            Text("\(next.item.allDay ? feed.relativeLabel(next.day.date, at: now) : (next.item.time ?? "")) \(next.item.title)")
        } else {
            Text("일정 없음 ♡")
        }
    }
}

// MARK: - 연결 안 됨 / 오류

struct MessageView: View {
    let state: ScheduleEntry.State
    let family: WidgetFamily

    private var text: String {
        state == .notLinked ? "앱을 열어 로그인하면\n일정이 보여요" : "일정을 불러오지 못했어요"
    }

    var body: some View {
        if family == .accessoryInline || family == .accessoryRectangular {
            Text(state == .notLinked ? "앱에서 로그인해 주세요" : "불러오지 못함")
        } else {
            VStack(spacing: 6) {
                KittyBadge(size: family == .systemSmall ? 52 : 64)
                Text(text)
                    .font(.system(size: 11.5, weight: .semibold, design: rounded))
                    .foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

#Preview(as: .systemMedium) {
    ScheduleWidget()
} timeline: {
    ScheduleEntry(date: .now, feed: .sample, state: .ok)
}

#Preview(as: .systemLarge) {
    ScheduleWidget()
} timeline: {
    ScheduleEntry(date: .now, feed: .sample, state: .ok)
}
