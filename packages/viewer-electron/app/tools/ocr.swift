import Foundation
import PDFKit
import Vision
import AppKit
let arguments = CommandLine.arguments
if arguments.count < 2 { exit(1) }
guard let document = PDFDocument(url: URL(fileURLWithPath: arguments[1])) else { exit(2) }
let count = min(document.pageCount, min(Int(arguments.count > 2 ? arguments[2] : "16") ?? 16, 64))
var pages: [[String: Any]] = []
for index in 0..<count {
    guard let page = document.page(at: index) else { continue }
    let image = page.thumbnail(of: NSSize(width: 2048, height: 2048), for: .mediaBox)
    guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    do {
        try VNImageRequestHandler(cgImage: cgImage).perform([request])
        let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
        pages.append(["page": index + 1, "text": text])
    } catch { pages.append(["page": index + 1, "text": ""]) }
}
let data = try JSONSerialization.data(withJSONObject: pages)
FileHandle.standardOutput.write(data)
