import AppKit
let target = CommandLine.arguments[1]
let image = NSImage(size: NSSize(width: 1024, height: 1024))
image.lockFocus()
let tile = NSBezierPath(roundedRect: NSRect(x: 40, y: 40, width: 944, height: 944), xRadius: 220, yRadius: 220)
tile.addClip()
NSGradient(starting: NSColor(red: 0.12, green: 0.60, blue: 0.55, alpha: 1), ending: NSColor(red: 0.035, green: 0.16, blue: 0.24, alpha: 1))!.draw(in: tile, angle: -45)
for (offset, alpha) in [(CGFloat(-155), CGFloat(0.35)), (CGFloat(0), CGFloat(0.65)), (CGFloat(155), CGFloat(1))] {
    let p = NSBezierPath()
    p.move(to: NSPoint(x: 245, y: 490 + offset)); p.line(to: NSPoint(x: 512, y: 625 + offset)); p.line(to: NSPoint(x: 779, y: 490 + offset)); p.line(to: NSPoint(x: 512, y: 355 + offset)); p.close()
    NSColor.white.withAlphaComponent(alpha).setStroke(); p.lineWidth = 32; p.lineJoinStyle = .round; p.stroke()
}
image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: target))
