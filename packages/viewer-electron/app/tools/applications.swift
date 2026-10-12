import AppKit
import Foundation

struct Application: Codable {
    let path: String
    let name: String
    let `default`: Bool
}
struct Choices: Encodable {
    let applications: [Application]
    let defaultName: String?
    let supported = true
}
struct TerminalApplication: Encodable { let path: String; let name: String; let running: Bool }
if CommandLine.arguments.contains("--terminals") {
    let workspace = NSWorkspace.shared
    let running = Set(workspace.runningApplications.compactMap { $0.bundleIdentifier })
    let ids = ["com.googlecode.iterm2", "com.apple.Terminal", "com.mitchellh.ghostty", "net.kovidgoyal.kitty", "com.github.wez.wezterm", "org.alacritty"]
    let apps = ids.compactMap { id -> TerminalApplication? in
        guard let url = workspace.urlForApplication(withBundleIdentifier: id) else { return nil }
        let bundle = Bundle(url: url)
        let name = bundle?.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? bundle?.object(forInfoDictionaryKey: "CFBundleName") as? String ?? url.deletingPathExtension().lastPathComponent
        return TerminalApplication(path: url.path, name: name, running: running.contains(id))
    }
    FileHandle.standardOutput.write(try! JSONEncoder().encode(apps))
    exit(0)
}
do {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    let paths = try JSONDecoder().decode([String].self, from: data)
    guard !paths.isEmpty, paths.count <= 2000 else {
        throw NSError(domain: "Viewer", code: 1, userInfo: [NSLocalizedDescriptionKey: "Select files to open."])
    }
    let workspace = NSWorkspace.shared
    var common: Set<URL>?
    var defaults = Set<URL>()
    var defaultCount = 0
    for path in paths {
        let file = URL(fileURLWithPath: path)
        let apps = Set(workspace.urlsForApplications(toOpen: file))
        common = common.map { $0.intersection(apps) } ?? apps
        if let app = workspace.urlForApplication(toOpen: file) {
            defaults.insert(app)
            defaultCount += 1
        }
    }
    let defaultApp = defaults.count == 1 && defaultCount == paths.count ? defaults.first : nil
    func name(_ url: URL) -> String {
        let bundle = Bundle(url: url)
        return bundle?.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
            ?? bundle?.object(forInfoDictionaryKey: "CFBundleName") as? String
            ?? url.deletingPathExtension().lastPathComponent
    }
    let applications = Array(common ?? []).map {
        Application(path: $0.path, name: name($0), default: $0 == defaultApp)
    }.sorted {
        if $0.default != $1.default { return $0.default }
        return $0.name.localizedStandardCompare($1.name) == .orderedAscending
    }
    let result = Choices(applications: Array(applications.prefix(128)), defaultName: defaultApp.map(name))
    FileHandle.standardOutput.write(try JSONEncoder().encode(result))
} catch {
    FileHandle.standardError.write(Data(error.localizedDescription.utf8))
    exit(1)
}
