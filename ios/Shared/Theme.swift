import SwiftUI

/// 키티 분홍 테마 색
enum Theme {
    static let pinkTop = Color(hex: "#FFEAF1")
    static let pinkBottom = Color(hex: "#FBD3E0")
    static let ink = Color(hex: "#4A3640")
    static let soft = Color(hex: "#9A7884")
    static let accent = Color(hex: "#E26D93")
    static let holiday = Color(hex: "#D9534F")
}

extension Color {
    /// "#RRGGBB" 또는 "RRGGBB". 잘못된 값이면 분홍.
    init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        var value: UInt64 = 0
        guard s.count == 6, Scanner(string: s).scanHexInt64(&value) else {
            self.init(red: 0.91, green: 0.54, blue: 0.65)
            return
        }
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
