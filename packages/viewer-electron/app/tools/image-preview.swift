import AppKit
import Darwin
import Foundation
import ImageIO
import UniformTypeIdentifiers

// One read-only, disposable decoder. It never invokes Quick Look or opens a
// source by pathname. The desktop owns coordination, the descriptor and timeout.
var cpu = rlimit(rlim_cur: 8, rlim_max: 10)
guard setrlimit(RLIMIT_CPU, &cpu) == 0 else { exit(2) }
let arguments = CommandLine.arguments
guard arguments.count == 3, let size = Int(arguments[2]), (1...4096).contains(size) else { exit(2) }

func writePNG(_ image: CGImage) {
    let data = NSMutableData()
    guard let output = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else { exit(3) }
    CGImageDestinationAddImage(output, image, nil)
    guard CGImageDestinationFinalize(output), data.length <= 32 * 1024 * 1024 else { exit(3) }
    FileHandle.standardOutput.write(data as Data)
}

if arguments[1] == "icon" {
    // NSWorkspace reads a bundle's icon. Unlike thumbnail generation, it does
    // not submit arbitrary document/image decoding to Finder's shared worker.
    guard size <= 256,
          let data = try? FileHandle.standardInput.read(upToCount: 16_385),
          data.count <= 16_384,
          let file = try? JSONDecoder().decode(String.self, from: data),
          file.hasPrefix("/"), !file.contains("\0") else { exit(2) }
    let image = NSWorkspace.shared.icon(forFile: file)
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: size * 4, bitsPerPixel: 32
    ), let context = NSGraphicsContext(bitmapImageRep: bitmap) else { exit(3) }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    image.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
    NSGraphicsContext.restoreGraphicsState()
    guard let result = bitmap.cgImage else { exit(3) }
    writePNG(result)
    exit(0)
}

guard arguments[1] == "image" else { exit(2) }
var info = stat()
guard fstat(3, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
      info.st_size > 0, info.st_size <= 256 * 1024 * 1024 else { exit(2) }
let source = FileHandle(fileDescriptor: 3, closeOnDealloc: false)
var bytes = Data()
do {
    try source.seek(toOffset: 0)
    while let chunk = try source.read(upToCount: 1_048_576), !chunk.isEmpty {
        guard bytes.count + chunk.count <= 256 * 1024 * 1024 else { exit(2) }
        bytes.append(chunk)
    }
} catch { exit(3) }
guard let imageSource = CGImageSourceCreateWithData(bytes as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
      let typeName = CGImageSourceGetType(imageSource),
      let type = UTType(typeName as String), !type.conforms(to: .rawImage),
      let properties = CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
      let height = properties[kCGImagePropertyPixelHeight] as? NSNumber,
      width.doubleValue > 0, height.doubleValue > 0,
      width.doubleValue * height.doubleValue <= 100_000_000 else { exit(3) }
let options: [CFString: Any] = [
    kCGImageSourceCreateThumbnailFromImageAlways: true,
    kCGImageSourceCreateThumbnailWithTransform: true,
    kCGImageSourceThumbnailMaxPixelSize: size,
    kCGImageSourceShouldCacheImmediately: true,
]
guard let image = CGImageSourceCreateThumbnailAtIndex(imageSource, 0, options as CFDictionary),
      image.width > 0, image.height > 0,
      image.width <= size, image.height <= size else { exit(3) }
writePNG(image)
