import { createHash } from 'node:crypto';
import type { Sample } from '../types';
import type { DistinguishedName } from '../keys';
import { sample } from './documents';
import { certificate, openPGPPublicKey, pem, publicP256, signedData, signingKey } from '../keys';

/**
 * Certificates and keys, shortcuts, a torrent, a provisioning profile and binaries for the hex
 * view, all generated: no private key is written, and every address is a reserved example domain.
 */

const organization = 'Viewer Playground';
const rootName: DistinguishedName = { organization, common: 'Viewer Sample Root CA' };
const intermediateName: DistinguishedName = {
  organization,
  common: 'Viewer Sample Intermediate CA',
};
const utc = (date: string) => new Date(`${date}T00:00:00Z`);

/** A root, an intermediate and the certificates it issues, DER. */
export function sampleCertificates() {
  const root = signingKey('root CA');
  const intermediate = signingKey('intermediate CA');
  const issued = (
    subject: DistinguishedName,
    label: string,
    notBefore: string,
    notAfter: string,
    role: 'server' | 'developer',
    names?: string[],
  ) =>
    certificate({
      subject,
      issuer: intermediateName,
      signer: intermediate,
      spki: publicP256(label),
      serial: serial(label),
      notBefore: utc(notBefore),
      notAfter: utc(notAfter),
      role,
      names,
    });
  return {
    root: certificate({
      subject: rootName,
      issuer: rootName,
      signer: root,
      spki: root.spki,
      serial: serial('root CA'),
      notBefore: utc('2026-01-01'),
      notAfter: utc('2046-01-01'),
      role: 'authority',
    }),
    intermediate: certificate({
      subject: intermediateName,
      issuer: rootName,
      signer: root,
      spki: intermediate.spki,
      serial: serial('intermediate CA'),
      notBefore: utc('2026-01-01'),
      notAfter: utc('2036-01-01'),
      role: 'authority',
      pathLength: 0,
    }),
    server: issued(
      { organization, common: 'viewer.example' },
      'server',
      '2026-01-01',
      '2036-01-01',
      'server',
      ['viewer.example', 'www.viewer.example', '127.0.0.1'],
    ),
    expired: issued(
      { organization, common: 'expired.viewer.example' },
      'expired server',
      '2020-01-01',
      '2021-01-01',
      'server',
      ['expired.viewer.example'],
    ),
    developer: issued(
      { organization, unit: 'EXAMPLE123', common: 'Development: Viewer Sample (EXAMPLE123)' },
      'developer',
      '2026-01-01',
      '2036-01-01',
      'developer',
    ),
    intermediateKey: intermediate,
  };
}
/** A positive serial number from a label. */
const serial = (label: string) =>
  '1' + createHash('sha256').update(`serial: ${label}`).digest('hex').slice(1, 32);

/** Who a sample profile is for: three iOS devices in development, or any Mac. */
type SampleProfile = 'development' | 'mac';
/** A profile's property list. */
function profilePlist(developer: Buffer, kind: SampleProfile): string {
  const team = 'EXAMPLE123';
  const mac = kind === 'mac';
  const devices = [1, 2, 3].map((index) => `00008110-${String(index).padStart(16, '0')}`);
  const deviceList = mac
    ? '\t<key>ProvisionsAllDevices</key>\n\t<true/>'
    : `\t<key>ProvisionedDevices</key>
\t<array>
${devices.map((device) => `\t\t<string>${device}</string>`).join('\n')}
\t</array>`;
  const data = (bytes: Buffer) =>
    (bytes.toString('base64').match(/.{1,68}/g) ?? []).map((line) => `\t\t${line}`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>AppIDName</key>
\t<string>Viewer Sample</string>
\t<key>ApplicationIdentifierPrefix</key>
\t<array>
\t\t<string>${team}</string>
\t</array>
\t<key>CreationDate</key>
\t<date>2026-01-01T00:00:00Z</date>
\t<key>Platform</key>
\t<array>
\t\t<string>${mac ? 'OSX' : 'iOS'}</string>
\t</array>
\t<key>DeveloperCertificates</key>
\t<array>
\t\t<data>
${data(developer)}
\t\t</data>
\t</array>
\t<key>Entitlements</key>
\t<dict>
\t\t<key>${mac ? 'com.apple.application-identifier' : 'application-identifier'}</key>
\t\t<string>${team}.com.example.viewer-sample</string>
\t\t<key>aps-environment</key>
\t\t<string>development</string>
\t\t<key>com.apple.developer.team-identifier</key>
\t\t<string>${team}</string>
\t\t<key>get-task-allow</key>
\t\t<${mac ? 'false' : 'true'}/>
\t\t<key>keychain-access-groups</key>
\t\t<array>
\t\t\t<string>${team}.*</string>
\t\t</array>
\t</dict>
\t<key>ExpirationDate</key>
\t<date>2036-01-01T00:00:00Z</date>
\t<key>Name</key>
\t<string>Viewer Sample ${mac ? 'Developer ID' : 'Development'}</string>
${deviceList}
\t<key>TeamIdentifier</key>
\t<array>
\t\t<string>${team}</string>
\t</array>
\t<key>TeamName</key>
\t<string>${organization}</string>
\t<key>TimeToLive</key>
\t<integer>3652</integer>
\t<key>UUID</key>
\t<string>6F1C2A9E-3B4D-4E5F-8A6B-7C8D9E0F1A2B</string>
\t<key>Version</key>
\t<integer>1</integer>
</dict>
</plist>
`;
}

/** A binary property list holding one dictionary, `{ URL: address }`. */
export function binaryWebloc(address: string): Buffer {
  const text = (value: string) => {
    const bytes = Buffer.from(value, 'latin1');
    return Buffer.concat([
      bytes.length < 15
        ? Buffer.from([0x50 | bytes.length])
        : Buffer.from([0x5f, 0x10, bytes.length]),
      bytes,
    ]);
  };
  const objects = [Buffer.from([0xd1, 1, 2]), text('URL'), text(address)];
  const offsets: number[] = [];
  let at = 8;
  for (const object of objects) {
    offsets.push(at);
    at += object.length;
  }
  const trailer = Buffer.alloc(32);
  trailer[6] = 1;
  trailer[7] = 1;
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(at), 24);
  return Buffer.concat([Buffer.from('bplist00'), ...objects, Buffer.from(offsets), trailer]);
}
const xmlWebloc = (address: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>URL</key>
\t<string>${address}</string>
</dict>
</plist>
`;

export type BencodeValue =
  number | string | Uint8Array | BencodeValue[] | { [key: string]: BencodeValue };
/** Bencode, with a dictionary's keys in sorted order as the format asks. */
export function bencode(value: BencodeValue): Buffer {
  if (typeof value === 'number') return Buffer.from(`i${value}e`);
  if (typeof value === 'string' || value instanceof Uint8Array) {
    const bytes = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value);
    return Buffer.concat([Buffer.from(`${bytes.length}:`), bytes]);
  }
  if (Array.isArray(value))
    return Buffer.concat([Buffer.from('l'), ...value.map(bencode), Buffer.from('e')]);
  return Buffer.concat([
    Buffer.from('d'),
    ...Object.keys(value)
      .sort()
      .flatMap((key) => [bencode(key), bencode(value[key]!)]),
    Buffer.from('e'),
  ]);
}
/** A torrent of a folder of generated text files, with real piece hashes. */
export function sampleTorrent(): Buffer {
  const files = [
    { path: ['README.txt'], text: 'Generated by the Viewer playground. Nothing here is shared.\n' },
    ...Array.from({ length: 240 }, (_, index) => ({
      path: ['notes', `part-${String(index + 1).padStart(3, '0')}.txt`],
      text: `Part ${index + 1} of the Viewer playground torrent.\n`.repeat(40),
    })),
  ];
  const pieceLength = 16384;
  const content = Buffer.concat(files.map((file) => Buffer.from(file.text)));
  const pieces: Buffer[] = [];
  for (let at = 0; at < content.length; at += pieceLength)
    pieces.push(
      createHash('sha1')
        .update(content.subarray(at, at + pieceLength))
        .digest(),
    );
  return bencode({
    announce: 'udp://tracker.viewer.example:6969/announce',
    'announce-list': [
      ['udp://tracker.viewer.example:6969/announce'],
      ['https://tracker.example.org/announce'],
    ],
    comment: 'A generated sample. Its trackers are reserved example addresses.',
    'created by': 'Viewer playground',
    'creation date': 1767225600,
    info: {
      files: files.map((file) => ({ length: Buffer.byteLength(file.text), path: file.path })),
      name: 'Viewer sample',
      'piece length': pieceLength,
      pieces: Buffer.concat(pieces),
    },
    'url-list': ['https://downloads.example.com/viewer-sample/'],
  });
}

/** A WebAssembly module exporting `add(i32, i32) -> i32`. */
const addModule = Buffer.from(
  '0061736d0100000001070160027f7f017f030201000707010361646400000a09010700200020016a0b',
  'hex',
);
/** A Java 21 class file declaring an empty public class, `Sample`. */
function classFile(): Buffer {
  const utf8 = (text: string) =>
    Buffer.concat([Buffer.from([1, 0, text.length]), Buffer.from(text)]);
  return Buffer.concat([
    Buffer.from('cafebabe00000041', 'hex'),
    Buffer.from([0, 5]),
    Buffer.from([7, 0, 2]),
    utf8('Sample'),
    Buffer.from([7, 0, 4]),
    utf8('java/lang/Object'),
    Buffer.from('00210001000300000000000000000000', 'hex'),
  ]);
}
/** A universal binary of two empty 64-bit object files, for x86_64 and arm64. */
function universalObject(): Buffer {
  const thin = (type: number, subtype: number) => {
    const header = Buffer.alloc(32);
    header.writeUInt32LE(0xfeedfacf, 0);
    header.writeUInt32LE(type, 4);
    header.writeUInt32LE(subtype, 8);
    header.writeUInt32LE(1, 12);
    return header;
  };
  const fat = Buffer.alloc(0x2020);
  fat.writeUInt32BE(0xcafebabe, 0);
  fat.writeUInt32BE(2, 4);
  [
    [0x01000007, 3, 0x1000],
    [0x0100000c, 0, 0x2000],
  ].forEach(([type, subtype, offset], index) => {
    const at = 8 + index * 20;
    fat.writeUInt32BE(type!, at);
    fat.writeUInt32BE(subtype!, at + 4);
    fat.writeUInt32BE(offset!, at + 8);
    fat.writeUInt32BE(32, at + 12);
    fat.writeUInt32BE(12, at + 16);
    thin(type!, subtype!).copy(fat, offset!);
  });
  return fat;
}
/** Bytes no signature names, from a seeded generator: 192 KiB, three pages of the hex view. */
export function noise(length = 192 * 1024): Buffer {
  const bytes = Buffer.alloc(length);
  let state = 0x2545f491;
  for (let index = 0; index < length; index++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 0xff;
  }
  return bytes;
}

export function inspectionSamples(): Sample[] {
  const chain = sampleCertificates();
  const profile = (kind: SampleProfile) =>
    signedData(
      Buffer.from(profilePlist(chain.developer, kind)),
      { key: chain.intermediateKey, issuer: rootName, serial: serial('intermediate CA') },
      [chain.intermediate, chain.root],
    );
  const generated =
    'Generated at build time with Ed25519 keys derived from fixed labels; no private key is written.';
  return [
    sample(
      'previews/certificates/Sample chain.pem',
      ['pem'],
      'Server, intermediate and root certificates, in chain order',
      generated,
      pem('CERTIFICATE', chain.server) +
        pem('CERTIFICATE', chain.intermediate) +
        pem('CERTIFICATE', chain.root),
    ),
    sample(
      'previews/certificates/Expired sample.pem',
      ['pem'],
      'A server certificate that expired in 2021',
      generated,
      pem('CERTIFICATE', chain.expired),
    ),
    sample(
      'previews/certificates/Sample root CA.crt',
      ['crt'],
      'A self-signed root certificate authority',
      generated,
      pem('CERTIFICATE', chain.root),
    ),
    sample(
      'previews/certificates/Sample server.cer',
      ['cer'],
      'The server certificate, DER',
      generated,
      chain.server,
    ),
    sample(
      'previews/certificates/Sample intermediate CA.der',
      ['der'],
      'The intermediate certificate authority, DER',
      generated,
      chain.intermediate,
    ),
    sample(
      'previews/certificates/Sample server key.pub',
      ['pub'],
      "The server certificate's P-256 public key",
      'The public half of a key derived from a fixed label; its private half is never written.',
      pem('PUBLIC KEY', publicP256('server')),
    ),
    sample(
      'previews/certificates/Sample signing key.asc',
      ['asc'],
      'An OpenPGP public key with its user ID and fingerprint',
      'An EdDSA key derived from a fixed label, with its self-certification; only the public key is written.',
      openPGPPublicKey(
        signingKey('OpenPGP signing key'),
        'Viewer Sample Signing Key <signing@viewer.example>',
        utc('2026-01-01'),
        10 * 365 * 24 * 3600,
      ),
    ),
    sample(
      'previews/certificates/Sample development.mobileprovision',
      ['mobileprovision'],
      'Profile name, app ID, team, expiry, entitlements, three devices and a developer certificate',
      'A CMS envelope signed by the sample intermediate around a generated property list; not issued by Apple.',
      profile('development'),
    ),
    sample(
      'previews/certificates/Sample Developer ID.provisionprofile',
      ['provisionprofile'],
      'A macOS profile for any device, with its entitlements and developer certificate',
      'A CMS envelope signed by the sample intermediate around a generated property list; not issued by Apple.',
      profile('mac'),
    ),
    sample(
      'previews/shortcuts/Viewer guide.url',
      ['url'],
      'The address and its host, with Open',
      'A Windows Internet shortcut to a reserved example domain.',
      '[InternetShortcut]\r\nURL=https://example.org/viewer/guide?topic=previews\r\nIconIndex=0\r\n',
    ),
    sample(
      'previews/shortcuts/Example site.webloc',
      ['webloc'],
      'The address and its host, with Open',
      'A macOS web location, as an XML property list.',
      xmlWebloc('https://www.example.com/viewer/'),
    ),
    sample(
      'previews/shortcuts/Write to samples.webloc',
      ['webloc'],
      'An email address, with Open',
      'A macOS web location, as a binary property list.',
      binaryWebloc('mailto:samples@example.com?subject=Viewer'),
    ),
    sample(
      'previews/shortcuts/File server.url',
      [],
      'The address, without Open: Viewer opens web and email addresses only',
      'A Windows Internet shortcut to an FTP address; excluded from positive format coverage.',
      '[InternetShortcut]\r\nURL=ftp://files.example.net/viewer/\r\n',
    ),
    sample(
      'previews/torrents/Viewer sample.torrent',
      ['torrent'],
      'Name, size, piece size, 241 files, trackers, creation date and info-hash',
      'A torrent of generated text files with real piece hashes; its trackers are reserved example addresses.',
      sampleTorrent(),
    ),
    sample(
      'previews/binaries/Add.wasm',
      [],
      'Hex view, named a WebAssembly module, version 1',
      'A WebAssembly module exporting add(i32, i32).',
      addModule,
    ),
    sample(
      'previews/binaries/Sample.class',
      [],
      'Hex view, named a Java class file for Java 21',
      'An empty public class compiled by hand.',
      classFile(),
    ),
    sample(
      'previews/binaries/Universal object.o',
      [],
      'Hex view, named a Mach-O universal binary with x86_64 and arm64 slices',
      'Two empty 64-bit object files in one universal binary.',
      universalObject(),
    ),
    sample(
      'previews/binaries/Noise.bin',
      [],
      'Hex view of 192 KiB no signature names, read in pages',
      'Bytes from a seeded generator.',
      noise(),
    ),
  ];
}
