// Original Margin notebook mark. Rebuild with: swift scripts/render-icon.swift
import AppKit
let size = 256
let bitmap = NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:size,pixelsHigh:size,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
let context = NSGraphicsContext(bitmapImageRep:bitmap)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.imageInterpolation = .high
NSColor(calibratedRed:0.094,green:0.129,blue:0.176,alpha:1).setFill()
NSBezierPath(roundedRect:NSRect(x:0,y:0,width:256,height:256),xRadius:48,yRadius:48).fill()
NSColor(calibratedRed:0.94,green:0.92,blue:0.86,alpha:1).setFill()
NSBezierPath(roundedRect:NSRect(x:60,y:44,width:140,height:168),xRadius:14,yRadius:14).fill()
NSColor(calibratedRed:0.80,green:0.34,blue:0.27,alpha:1).setFill()
NSBezierPath(rect:NSRect(x:83,y:44,width:6,height:168)).fill()
NSColor(calibratedRed:0.094,green:0.129,blue:0.176,alpha:0.7).setFill()
for (y,width) in [(164,70),(139,70),(114,48)] {
 NSBezierPath(roundedRect:NSRect(x:108,y:y,width:width,height:7),xRadius:3,yRadius:3).fill()
}
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:"assets/icon.png"))
