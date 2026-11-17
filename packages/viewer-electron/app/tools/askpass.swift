import Darwin
import Foundation

// viewer-askpass: OpenSSH runs it as SSH_ASKPASS with the question as its one argument. It hands
// the question to Viewer over the private socket of one clicked sign-in and prints the answer on
// stdout, OpenSSH's private pipe. It shows nothing itself and keeps nothing.

let promptBytes = 8192
let replyBytes = 65536

/// The question, cut to 8 KiB at a character boundary.
func boundedPrompt(_ text: String) -> String {
    var prompt = ""
    var bytes = 0
    for scalar in text.unicodeScalars {
        bytes += String(scalar).utf8.count
        if bytes > promptBytes { break }
        prompt.unicodeScalars.append(scalar)
    }
    return prompt
}

func connectSocket(_ socketPath: String) -> Int32? {
    let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    guard descriptor >= 0 else { return nil }
    // Viewer gives up on a question after 120 seconds; so does the relay.
    var timeout = timeval(tv_sec: 120, tv_usec: 0)
    let size = socklen_t(MemoryLayout<timeval>.size)
    setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, size)
    setsockopt(descriptor, SOL_SOCKET, SO_SNDTIMEO, &timeout, size)
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    let pathBytes = Array(socketPath.utf8)
    guard socketPath.hasPrefix("/"),
          pathBytes.count < MemoryLayout.size(ofValue: address.sun_path)
    else {
        Darwin.close(descriptor)
        return nil
    }
    withUnsafeMutableBytes(of: &address.sun_path) { target in
        target.initializeMemory(as: UInt8.self, repeating: 0)
        target.copyBytes(from: pathBytes)
    }
    let connected = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            Darwin.connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
    guard connected == 0 else {
        Darwin.close(descriptor)
        return nil
    }
    return descriptor
}

func send(_ data: Data, to descriptor: Int32) -> Bool {
    data.withUnsafeBytes { raw -> Bool in
        var offset = 0
        while offset < raw.count {
            let count = Darwin.write(descriptor, raw.baseAddress!.advanced(by: offset), raw.count - offset)
            if count <= 0 { return false }
            offset += count
        }
        return true
    }
}

func receiveLine(from descriptor: Int32) -> Data? {
    var response = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while response.count <= replyBytes {
        let count = Darwin.read(descriptor, &buffer, buffer.count)
        if count <= 0 { return nil }
        response.append(contentsOf: buffer.prefix(count))
        if response.contains(10) { return response }
    }
    return nil
}

func relay() -> Bool {
    let environment = ProcessInfo.processInfo.environment
    guard let socketPath = environment["VIEWER_ASKPASS_SOCKET"],
          let token = environment["VIEWER_ASKPASS_TOKEN"],
          token.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
          CommandLine.arguments.count == 2
    else { return false }
    // OpenSSH sets this to "confirm" for a yes or no question and "none" for a notice it ends
    // itself, such as a request to touch a security key.
    var request: [String: String] = ["token": token, "prompt": boundedPrompt(CommandLine.arguments[1])]
    if let hint = environment["SSH_ASKPASS_PROMPT"], hint == "confirm" || hint == "none" {
        request["hint"] = hint
    }
    guard let descriptor = connectSocket(socketPath) else { return false }
    defer { Darwin.close(descriptor) }
    guard var line = try? JSONSerialization.data(withJSONObject: request) else { return false }
    line.append(10)
    guard send(line, to: descriptor),
          let response = receiveLine(from: descriptor),
          let object = try? JSONSerialization.jsonObject(with: response) as? [String: Any],
          let answer = object["answer"] as? String
    else { return false }
    FileHandle.standardOutput.write(Data((answer + "\n").utf8))
    return true
}

exit(relay() ? 0 : 1)
