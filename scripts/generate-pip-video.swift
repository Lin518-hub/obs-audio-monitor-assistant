import AVFoundation
import CoreGraphics
import CoreText
import CoreVideo
import Foundation

let arguments = Array(CommandLine.arguments.dropFirst())
let outputPath = arguments.first
  ?? "remote-server/public/assets/pip-audio-threshold-55.mp4"
let configuredThresholdDb = Int(arguments.dropFirst().first ?? "") ?? -55
let thresholdDb = max(-90, min(-5, configuredThresholdDb))
let outputURL = URL(fileURLWithPath: outputPath)
let width = 640
let height = 240
let framesPerSecond: Int32 = 10
let levelSteps = 40
let modeCount = 7
let framesPerCell = 2
let cellCount = modeCount * (levelSteps + 1)
let frameCount = cellCount * framesPerCell

try? FileManager.default.removeItem(at: outputURL)
try FileManager.default.createDirectory(
  at: outputURL.deletingLastPathComponent(),
  withIntermediateDirectories: true
)

let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
let input = AVAssetWriterInput(
  mediaType: .video,
  outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [
      AVVideoAverageBitRateKey: 260_000,
      AVVideoProfileLevelKey: AVVideoProfileLevelH264BaselineAutoLevel,
      AVVideoMaxKeyFrameIntervalKey: framesPerCell * 5,
      AVVideoAllowFrameReorderingKey: false
    ]
  ]
)
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(
  assetWriterInput: input,
  sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height
  ]
)
guard writer.canAdd(input) else { fatalError("Unable to add video input") }
writer.add(input)
guard writer.startWriting() else { throw writer.error ?? NSError(domain: "pip-video", code: 1) }
writer.startSession(atSourceTime: .zero)

func color(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat, _ alpha: CGFloat = 1) -> CGColor {
  CGColor(red: red, green: green, blue: blue, alpha: alpha)
}

let modeColors: [(CGFloat, CGFloat, CGFloat)] = [
  (0.39, 0.45, 0.55),
  (0.13, 0.78, 0.37),
  (0.22, 0.70, 0.42),
  (0.78, 0.68, 0.28),
  (0.91, 0.65, 0.10),
  (0.95, 0.46, 0.12),
  (0.94, 0.27, 0.27)
]
let modeTitles = [
  "等待音频",
  "正在讲话",
  "静音计时",
  "静音计时",
  "静音预警",
  "即将报警",
  "检查麦克风"
]
let modeHints = [
  "等待电脑端开始检测",
  "音频正常",
  "正在确认麦克风状态",
  "请留意麦克风声音",
  "静音时间已过半",
  "请尽快检查麦克风",
  "已触发静音报警"
]

func drawText(
  _ context: CGContext,
  _ text: String,
  x: CGFloat,
  baselineFromTop: CGFloat,
  size: CGFloat,
  weight: String,
  color textColor: CGColor
) {
  let font = CTFontCreateWithName(weight as CFString, size, nil)
  let attributes: [NSAttributedString.Key: Any] = [
    NSAttributedString.Key(kCTFontAttributeName as String): font,
    NSAttributedString.Key(kCTForegroundColorAttributeName as String): textColor
  ]
  let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
  context.saveGState()
  context.textMatrix = .identity
  context.textPosition = CGPoint(x: x, y: CGFloat(height) - baselineFromTop)
  CTLineDraw(line, context)
  context.restoreGState()
}

func textWidth(_ text: String, size: CGFloat, weight: String) -> CGFloat {
  let font = CTFontCreateWithName(weight as CFString, size, nil)
  let line = CTLineCreateWithAttributedString(NSAttributedString(
    string: text,
    attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font]
  ))
  return CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
}

for frame in 0..<frameCount {
  while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.002) }
  guard let pool = adaptor.pixelBufferPool else { fatalError("Pixel buffer pool unavailable") }
  var optionalBuffer: CVPixelBuffer?
  guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &optionalBuffer) == kCVReturnSuccess,
        let buffer = optionalBuffer else { fatalError("Unable to create pixel buffer") }

  CVPixelBufferLockBaseAddress(buffer, [])
  defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
  guard let context = CGContext(
    data: CVPixelBufferGetBaseAddress(buffer),
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
  ) else { fatalError("Unable to create drawing context") }

  let cell = frame / framesPerCell
  let levelIndex = cell % (levelSteps + 1)
  let mode = min(modeCount - 1, cell / (levelSteps + 1))
  let level = CGFloat(levelIndex) / CGFloat(levelSteps)
  let localProgress = CGFloat(frame % framesPerCell) / CGFloat(max(1, framesPerCell - 1))
  let modeColor = modeColors[mode]
  let threshold = max(0, min(1, CGFloat(thresholdDb + 90) / 85))
  let levelDb = -90 + level * 85

  context.setFillColor(color(0.055, 0.071, 0.102))
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  let background = CGGradient(
    colorsSpace: CGColorSpaceCreateDeviceRGB(),
    colors: [color(modeColor.0, modeColor.1, modeColor.2, mode == 0 ? 0.22 : 0.48), color(0.04, 0.08, 0.12, 0)] as CFArray,
    locations: [0, 1]
  )!
  context.drawLinearGradient(
    background,
    start: CGPoint(x: 0, y: height),
    end: CGPoint(x: CGFloat(width) * 0.72, y: 0),
    options: []
  )

  let cardRect = CGRect(x: 20, y: 18, width: 600, height: 204)
  context.setFillColor(color(1, 1, 1, 0.075))
  context.addPath(CGPath(roundedRect: cardRect, cornerWidth: 18, cornerHeight: 18, transform: nil))
  context.fillPath()
  context.setStrokeColor(color(1, 1, 1, 0.15))
  context.setLineWidth(1.5)
  context.addPath(CGPath(roundedRect: cardRect, cornerWidth: 18, cornerHeight: 18, transform: nil))
  context.strokePath()

  context.setFillColor(color(modeColor.0, modeColor.1, modeColor.2))
  context.fillEllipse(in: CGRect(x: 38, y: CGFloat(height) - 49, width: 13, height: 13))
  drawText(context, "音频守护", x: 64, baselineFromTop: 48, size: 20, weight: "PingFangSC-Semibold", color: color(0.96, 0.98, 1))

  drawText(context, modeTitles[mode], x: 40, baselineFromTop: 97, size: 36, weight: "PingFangSC-Semibold", color: color(0.98, 0.99, 1))
  let dbText = mode == 0 ? "-- dB" : String(format: "%.1f dB", levelDb)
  let dbWidth = textWidth(dbText, size: 31, weight: "PingFangSC-Semibold")
  drawText(context, dbText, x: 600 - dbWidth, baselineFromTop: 96, size: 31, weight: "PingFangSC-Semibold", color: color(0.98, 0.99, 1))

  let trackRect = CGRect(x: 40, y: 84, width: 560, height: 15)
  context.setFillColor(color(0.18, 0.21, 0.26))
  context.addPath(CGPath(roundedRect: trackRect, cornerWidth: 7.5, cornerHeight: 7.5, transform: nil))
  context.fillPath()

  if level > 0 {
    let fillRect = CGRect(x: trackRect.minX, y: trackRect.minY, width: max(7.5, trackRect.width * level), height: trackRect.height)
    context.saveGState()
    context.addPath(CGPath(roundedRect: fillRect, cornerWidth: 7.5, cornerHeight: 7.5, transform: nil))
    context.clip()
    let meterGradient = CGGradient(
      colorsSpace: CGColorSpaceCreateDeviceRGB(),
      colors: [color(0.13, 0.78, 0.37), color(0.98, 0.80, 0.08), color(0.97, 0.39, 0.35)] as CFArray,
      locations: [0, 0.72, 1]
    )!
    context.drawLinearGradient(
      meterGradient,
      start: CGPoint(x: trackRect.minX, y: trackRect.midY),
      end: CGPoint(x: trackRect.maxX, y: trackRect.midY),
      options: []
    )
    let scanX = fillRect.minX - 55 + (fillRect.width + 110) * localProgress
    let sheen = CGGradient(
      colorsSpace: CGColorSpaceCreateDeviceRGB(),
      colors: [color(1, 1, 1, 0), color(1, 1, 1, 0.25), color(1, 1, 1, 0)] as CFArray,
      locations: [0, 0.5, 1]
    )!
    context.drawLinearGradient(
      sheen,
      start: CGPoint(x: scanX - 42, y: trackRect.midY),
      end: CGPoint(x: scanX + 42, y: trackRect.midY),
      options: []
    )
    context.restoreGState()
  }

  let thresholdX = trackRect.minX + trackRect.width * threshold
  context.setFillColor(color(0.90, 0.94, 0.97, 0.92))
  context.fill(CGRect(x: thresholdX - 1.25, y: trackRect.minY - 6, width: 2.5, height: trackRect.height + 12))

  drawText(context, "当前麦克风", x: 40, baselineFromTop: 181, size: 13, weight: "PingFangSC-Medium", color: color(0.63, 0.70, 0.78))
  drawText(context, modeHints[mode], x: 40, baselineFromTop: 205, size: 15, weight: "PingFangSC-Medium", color: color(modeColor.0, modeColor.1, modeColor.2))
  let thresholdText = "阈值 \(thresholdDb) dB"
  let thresholdWidth = textWidth(thresholdText, size: 13, weight: "PingFangSC-Medium")
  drawText(context, thresholdText, x: 600 - thresholdWidth, baselineFromTop: 181, size: 13, weight: "PingFangSC-Medium", color: color(0.63, 0.70, 0.78))

  let presentationTime = CMTime(value: CMTimeValue(frame), timescale: framesPerSecond)
  guard adaptor.append(buffer, withPresentationTime: presentationTime) else {
    throw writer.error ?? NSError(domain: "pip-video", code: 2)
  }
}

input.markAsFinished()
let finished = DispatchSemaphore(value: 0)
writer.finishWriting { finished.signal() }
finished.wait()
guard writer.status == .completed else {
  throw writer.error ?? NSError(domain: "pip-video", code: 3)
}
print(outputURL.path)
