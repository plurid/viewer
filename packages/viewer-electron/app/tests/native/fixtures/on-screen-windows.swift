import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 2,
      let owner = Int32(CommandLine.arguments[1]),
      owner > 0 else {
    exit(2)
}

guard let windows = CGWindowListCopyWindowInfo(
    [.optionOnScreenOnly, .excludeDesktopElements],
    kCGNullWindowID
) as? [[String: Any]] else {
    exit(3)
}

let identifiers = windows.compactMap { window -> UInt32? in
    guard let pid = window[kCGWindowOwnerPID as String] as? NSNumber,
          pid.int32Value == owner,
          let identifier = window[kCGWindowNumber as String] as? NSNumber else {
        return nil
    }
    return identifier.uint32Value
}.sorted()

let output = try JSONSerialization.data(withJSONObject: identifiers)
FileHandle.standardOutput.write(output)
