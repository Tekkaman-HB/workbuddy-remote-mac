/**
 * [INPUT]: 依赖 AppKit 的矢量绘制和 PNG 编码，接收输出目录参数。
 * [OUTPUT]: 生成 WorkBuddyRemote.iconset 与 app-icon.png，不读取原版图标。
 * [POS]: tools 的应用图标生成器，与 UI brand-mark.svg 使用相同双屏与双眼意象。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import AppKit

let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let iconset = output.appendingPathComponent("WorkBuddyRemote.iconset", isDirectory: true)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 255)/255, green: CGFloat((hex >> 8) & 255)/255,
            blue: CGFloat(hex & 255)/255, alpha: alpha)
}
func rounded(_ rect: NSRect, _ radius: CGFloat, fill: NSColor) {
    fill.setFill(); NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
}
func drawIcon() {
    // -- 底板：保留 macOS 图标透明安全边距 --
    let plate = NSBezierPath(roundedRect: NSRect(x: 96, y: 96, width: 832, height: 832), xRadius: 186, yRadius: 186)
    NSGraphicsContext.saveGraphicsState()
    let shadow = NSShadow(); shadow.shadowColor = color(0x063F36, 0.19)
    shadow.shadowBlurRadius = 30; shadow.shadowOffset = NSSize(width: 0, height: -12); shadow.set()
    color(0x08AD94).setFill(); plate.fill()
    NSGraphicsContext.restoreGraphicsState()
    NSGradient(starting: color(0x24D3B0), ending: color(0x00947F))!.draw(in: plate, angle: -65)
    let edge = NSBezierPath(roundedRect: NSRect(x: 100, y: 100, width: 824, height: 824), xRadius: 182, yRadius: 182)
    color(0xFFFFFF, 0.25).setStroke(); edge.lineWidth = 4; edge.stroke()
    // -- 后屏：另一台 Mac；轻描边保持小尺寸可辨识 --
    let back = NSBezierPath(roundedRect: NSRect(x: 232, y: 448, width: 442, height: 294), xRadius: 47, yRadius: 47)
    color(0xFFFFFF, 0.12).setFill(); back.fill()
    color(0xE9FFF9, 0.85).setStroke(); back.lineWidth = 25; back.stroke()
    rounded(NSRect(x: 411, y: 400, width: 78, height: 39), 11, fill: color(0xE9FFF9, 0.85))
    // -- 前屏：屏幕双眼与 WorkBuddy 的助理意象呼应 --
    NSGraphicsContext.saveGraphicsState()
    let panelShadow = NSShadow(); panelShadow.shadowColor = color(0x004437, 0.24)
    panelShadow.shadowBlurRadius = 22; panelShadow.shadowOffset = NSSize(width: 0, height: -13); panelShadow.set()
    rounded(NSRect(x: 350, y: 291, width: 447, height: 326), 53, fill: color(0xF4FFFB))
    NSGraphicsContext.restoreGraphicsState()
    rounded(NSRect(x: 371, y: 333, width: 405, height: 263), 34, fill: color(0x123D3A))
    rounded(NSRect(x: 480, y: 411, width: 35, height: 96), 17.5, fill: color(0x5EE8C4))
    rounded(NSRect(x: 633, y: 411, width: 35, height: 96), 17.5, fill: color(0x5EE8C4))
    rounded(NSRect(x: 541, y: 236, width: 67, height: 58), 10, fill: color(0xF4FFFB))
    rounded(NSRect(x: 477, y: 218, width: 195, height: 25), 12.5, fill: color(0xF4FFFB))
}
func png(_ pixels: Int) throws -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    let context = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.current = context; context.imageInterpolation = .high
    context.cgContext.clear(CGRect(x: 0, y: 0, width: pixels, height: pixels))
    context.cgContext.scaleBy(x: CGFloat(pixels)/1024, y: CGFloat(pixels)/1024)
    drawIcon()
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}
for size in [16, 32, 128, 256, 512] {
    try png(size).write(to: iconset.appendingPathComponent("icon_\(size)x\(size).png"))
    try png(size*2).write(to: iconset.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
try png(1024).write(to: output.appendingPathComponent("app-icon.png"))
