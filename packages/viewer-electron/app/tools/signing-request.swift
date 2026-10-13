import Foundation
import Security

// Generate only a public PKCS#10 request. The permanent RSA
// private key stays in this Mac's Keychain and is reused by its exact tag.
// No password, private-key file, certificate revocation or Store upload occurs.
func der(_ tag: UInt8, _ contents: Data) -> Data {
    var length = Data()
    if contents.count < 128 {
        length.append(UInt8(contents.count))
    } else {
        var value = contents.count
        while value > 0 {
            length.insert(UInt8(value & 255), at: 0)
            value >>= 8
        }
        length.insert(0x80 | UInt8(length.count), at: 0)
    }
    return Data([tag]) + length + contents
}
func sequence(_ contents: Data) -> Data { der(0x30, contents) }
func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

guard CommandLine.arguments.count == 4 else {
    fail("Usage: signing-request TEAM_ID application|installer OUTPUT_DIRECTORY")
}
let team = CommandLine.arguments[1]
let kind = CommandLine.arguments[2]
guard team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil,
      ["application", "installer"].contains(kind) else { fail("Invalid signing team or kind.") }
let output = URL(fileURLWithPath: CommandLine.arguments[3], isDirectory: true)
let tag = Data("com.pluridviewer.app.store-signing.\(team).\(kind).v1".utf8)
let query: [String: Any] = [
    kSecClass as String: kSecClassKey,
    kSecAttrApplicationTag as String: tag,
    kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
    kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
    kSecReturnRef as String: true,
]
var reference: CFTypeRef?
let status = SecItemCopyMatching(query as CFDictionary, &reference)
let key: SecKey
let reused: Bool
if status == errSecSuccess {
    guard let reference else { fail("Keychain returned no signing key.") }
    key = reference as! SecKey
    reused = true
} else if status == errSecItemNotFound {
    var error: Unmanaged<CFError>?
    guard let created = SecKeyCreateRandomKey([
        kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
        kSecAttrKeySizeInBits as String: 2048,
        kSecPrivateKeyAttrs as String: [
            kSecAttrIsPermanent as String: true,
            kSecAttrApplicationTag as String: tag,
            kSecAttrLabel as String: "Viewer \(team) Mac Store \(kind)",
        ],
    ] as CFDictionary, &error) else {
        fail("Could not create a signing key in Keychain: \(String(describing: error?.takeRetainedValue()))")
    }
    key = created
    reused = false
} else {
    fail("Could not access the selected Keychain key (status \(status)).")
}
guard let publicKey = SecKeyCopyPublicKey(key) else { fail("Could not read the public key.") }
var error: Unmanaged<CFError>?
guard let publicBytes = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
    fail("Could not encode the public key.")
}
// rsaEncryption OID; SecKey exposes a PKCS#1 public key, wrapped as SPKI.
let rsa = sequence(Data([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]))
let spki = sequence(rsa + der(0x03, Data([0]) + publicBytes))
let commonName = "Viewer Mac Store \(kind)"
let subject = sequence(der(0x31, sequence(Data([0x06, 0x03, 0x55, 0x04, 0x03]) + der(0x0c, Data(commonName.utf8)))))
let request = sequence(Data([0x02, 0x01, 0x00]) + subject + spki + Data([0xa0, 0x00]))
guard let signature = SecKeyCreateSignature(key, .rsaSignatureMessagePKCS1v15SHA256, request as CFData, &error) as Data? else {
    fail("Could not sign the public request in Keychain.")
}
guard SecKeyVerifySignature(publicKey, .rsaSignatureMessagePKCS1v15SHA256, request as CFData, signature as CFData, &error) else {
    fail("The request signature did not verify.")
}
let algorithm = sequence(Data([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b, 0x05, 0x00]))
let csr = sequence(request + algorithm + der(0x03, Data([0]) + signature))
let pem = "-----BEGIN CERTIFICATE REQUEST-----\n" + csr.base64EncodedString(options: [.lineLength64Characters, .endLineWithLineFeed]) + "\n-----END CERTIFICATE REQUEST-----\n"
do {
    try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
    let file = output.appendingPathComponent("Viewer_\(kind).certSigningRequest")
    try Data(pem.utf8).write(to: file, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    print("Public CSR: \(file.path); team: \(team); existing key: \(reused); private key: retained in Keychain; signature: verified")
} catch { fail("Could not save the public request: \(error.localizedDescription)") }
