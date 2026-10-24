import AppKit
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 2,
      let owner = Int32(CommandLine.arguments[1]),
      owner > 0,
      let target = NSRunningApplication(processIdentifier: owner) else {
    exit(2)
}

guard let windows = CGWindowListCopyWindowInfo(
    [.optionOnScreenOnly, .excludeDesktopElements],
    kCGNullWindowID
) as? [[String: Any]] else {
    exit(4)
}

let visible = windows.filter { window in
    (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == owner
}
let output = try JSONSerialization.data(withJSONObject: [
    "pid": owner,
    "hidden": target.isHidden,
    "onScreenWindows": visible.count,
])
FileHandle.standardOutput.write(output)
