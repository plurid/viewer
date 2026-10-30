import { createECDH, createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

/**
 * Certificates, an OpenPGP public key and a CMS envelope for the playground, built the same way on
 * every run. The signing keys are Ed25519, whose signatures are deterministic, made from seeds
 * derived from fixed labels: they are public test values, and no private key is ever written.
 */

const join = (...parts: Uint8Array[]) => Buffer.concat(parts);
const ascii = (text: string) => Buffer.from(text, 'latin1');
const utf8 = (text: string) => Buffer.from(text, 'utf8');

/** A DER value: its tag, its length and its content. */
function tlv(tag: number, content: Uint8Array): Buffer {
  const length = content.length;
  const size =
    length < 0x80
      ? [length]
      : length < 0x100
        ? [0x81, length]
        : length < 0x10000
          ? [0x82, length >> 8, length & 0xff]
          : [0x83, length >> 16, (length >> 8) & 0xff, length & 0xff];
  return join(Buffer.from([tag, ...size]), content);
}
const sequence = (...parts: Uint8Array[]) => tlv(0x30, join(...parts));
const set = (...parts: Uint8Array[]) => tlv(0x31, join(...parts));
const explicit = (index: number, ...parts: Uint8Array[]) => tlv(0xa0 + index, join(...parts));
const octets = (bytes: Uint8Array) => tlv(0x04, bytes);
const bits = (bytes: Uint8Array, unused = 0) => tlv(0x03, join(Buffer.from([unused]), bytes));
const boolean = (value: boolean) => tlv(0x01, Buffer.from([value ? 0xff : 0]));
/** A non-negative integer, with a zero byte where its top bit would read as a sign. */
function integer(value: number | Uint8Array): Buffer {
  const digits = typeof value === 'number' ? value.toString(16) : '';
  let bytes =
    typeof value === 'number'
      ? Buffer.from(digits.length % 2 ? '0' + digits : digits, 'hex')
      : Buffer.from(value);
  while (bytes.length > 1 && bytes[0] === 0 && bytes[1]! < 0x80) bytes = bytes.subarray(1);
  return tlv(0x02, bytes[0]! >= 0x80 ? join(Buffer.from([0]), bytes) : bytes);
}
function oid(text: string): Buffer {
  const [first, second, ...rest] = text.split('.').map(Number);
  const bytes = [first! * 40 + second!];
  for (const part of rest) {
    const groups = [part & 0x7f];
    for (let value = part >> 7; value; value >>= 7) groups.unshift((value & 0x7f) | 0x80);
    bytes.push(...groups);
  }
  return tlv(0x06, Buffer.from(bytes));
}
const time = (date: Date) => {
  const text = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  return date.getUTCFullYear() < 2050 ? tlv(0x17, ascii(text.slice(2))) : tlv(0x18, ascii(text));
};

const oids = {
  commonName: '2.5.4.3',
  organization: '2.5.4.10',
  organizationalUnit: '2.5.4.11',
  ed25519: '1.3.101.112',
  ecPublicKey: '1.2.840.10045.2.1',
  p256: '1.2.840.10045.3.1.7',
  basicConstraints: '2.5.29.19',
  keyUsage: '2.5.29.15',
  extendedKeyUsage: '2.5.29.37',
  subjectAlternativeName: '2.5.29.17',
  subjectKeyIdentifier: '2.5.29.14',
  authorityKeyIdentifier: '2.5.29.35',
  serverAuthentication: '1.3.6.1.5.5.7.3.1',
  clientAuthentication: '1.3.6.1.5.5.7.3.2',
  codeSigning: '1.3.6.1.5.5.7.3.3',
  signedData: '1.2.840.113549.1.7.2',
  data: '1.2.840.113549.1.7.1',
  sha512: '2.16.840.1.101.3.4.2.3',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
};

export interface DistinguishedName {
  organization?: string;
  unit?: string;
  common: string;
}
function name({ organization, unit, common }: DistinguishedName): Buffer {
  const attribute = (type: string, value: string) =>
    set(sequence(oid(type), tlv(0x0c, utf8(value))));
  return sequence(
    ...(organization ? [attribute(oids.organization, organization)] : []),
    ...(unit ? [attribute(oids.organizationalUnit, unit)] : []),
    attribute(oids.commonName, common),
  );
}

/** A seed derived from a label, the same on every run. */
const seed = (label: string) => createHash('sha256').update(`Viewer playground: ${label}`).digest();

export interface SigningKey {
  key: KeyObject;
  /** The SubjectPublicKeyInfo, DER. */
  spki: Buffer;
}
/** An Ed25519 key from a label's seed. */
export function signingKey(label: string): SigningKey {
  const pkcs8 = join(Buffer.from('302e020100300506032b657004220420', 'hex'), seed(label));
  const key = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  return { key, spki: createPublicKey(key).export({ type: 'spki', format: 'der' }) };
}
/** The public half of a P-256 key from a label's seed; its private half signs nothing. */
export function publicP256(label: string): Buffer {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(seed(label));
  return sequence(sequence(oid(oids.ecPublicKey), oid(oids.p256)), bits(ecdh.getPublicKey()));
}
/** Where a DER value's content starts and ends. */
function content(bytes: Uint8Array, at: number): { start: number; end: number } {
  const first = bytes[at + 1]!;
  const size = first < 0x80 ? 0 : first & 0x7f;
  let length = first;
  if (size) {
    length = 0;
    for (let index = 0; index < size; index++) length = length * 256 + bytes[at + 2 + index]!;
  }
  const start = at + 2 + size;
  return { start, end: start + length };
}
/** RFC 5280's key identifier: SHA-1 of the public key's bits, without the BIT STRING's header. */
function keyIdentifier(spki: Buffer): Buffer {
  const outer = content(spki, 0);
  const algorithm = content(spki, outer.start);
  const key = content(spki, algorithm.end);
  return createHash('sha1')
    .update(spki.subarray(key.start + 1, key.end))
    .digest();
}

export type CertificateRole = 'authority' | 'server' | 'developer';

export interface CertificateRecipe {
  subject: DistinguishedName;
  issuer: DistinguishedName;
  /** The issuer's key; a root signs with its own. */
  signer: SigningKey;
  spki: Buffer;
  serial: string;
  notBefore: Date;
  notAfter: Date;
  role: CertificateRole;
  /** DNS names and IPv4 addresses. */
  names?: string[];
  /** A path length for an authority. */
  pathLength?: number;
}

function extension(type: string, value: Buffer, critical = false): Buffer {
  return sequence(oid(type), ...(critical ? [boolean(true)] : []), octets(value));
}
function alternativeNames(names: readonly string[]): Buffer {
  return sequence(
    ...names.map((item) =>
      /^\d+\.\d+\.\d+\.\d+$/.test(item)
        ? tlv(0x87, Buffer.from(item.split('.').map(Number)))
        : tlv(0x82, ascii(item)),
    ),
  );
}

/** An X.509 version 3 certificate, DER, signed with Ed25519. */
export function certificate(recipe: CertificateRecipe): Buffer {
  const authority = recipe.role === 'authority';
  const usages =
    recipe.role === 'server'
      ? [oids.serverAuthentication, oids.clientAuthentication]
      : recipe.role === 'developer'
        ? [oids.codeSigning]
        : [];
  const extensions = [
    extension(
      oids.basicConstraints,
      authority
        ? sequence(
            boolean(true),
            ...(recipe.pathLength === undefined ? [] : [integer(recipe.pathLength)]),
          )
        : sequence(),
      true,
    ),
    // keyCertSign and cRLSign for an authority, digitalSignature otherwise
    extension(
      oids.keyUsage,
      authority ? bits(Buffer.from([0x06]), 1) : bits(Buffer.from([0x80]), 7),
      true,
    ),
    ...(usages.length ? [extension(oids.extendedKeyUsage, sequence(...usages.map(oid)))] : []),
    ...(recipe.names?.length
      ? [extension(oids.subjectAlternativeName, alternativeNames(recipe.names))]
      : []),
    extension(oids.subjectKeyIdentifier, octets(keyIdentifier(recipe.spki))),
    extension(oids.authorityKeyIdentifier, sequence(tlv(0x80, keyIdentifier(recipe.signer.spki)))),
  ];
  const algorithm = sequence(oid(oids.ed25519));
  const body = sequence(
    explicit(0, integer(2)),
    integer(Buffer.from(recipe.serial, 'hex')),
    algorithm,
    name(recipe.issuer),
    sequence(time(recipe.notBefore), time(recipe.notAfter)),
    name(recipe.subject),
    recipe.spki,
    explicit(3, sequence(...extensions)),
  );
  return sequence(body, algorithm, bits(sign(null, body, recipe.signer.key)));
}

/** PEM text of DER bytes under `label`. */
export function pem(label: string, der: Uint8Array): string {
  const lines =
    Buffer.from(der)
      .toString('base64')
      .match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

/**
 * A CMS SignedData envelope around `content`, as a provisioning profile is: the content, the
 * signer's certificates, and an Ed25519 signature over signed attributes naming the content's
 * type and SHA-512 digest.
 */
export function signedData(
  content: Uint8Array,
  signer: { key: SigningKey; issuer: DistinguishedName; serial: string },
  certificates: readonly Buffer[],
): Buffer {
  const digest = sequence(oid(oids.sha512));
  // in DER order: the content type's attribute encodes shorter
  const attributes = join(
    sequence(oid(oids.contentType), set(oid(oids.data))),
    sequence(oid(oids.messageDigest), set(octets(createHash('sha512').update(content).digest()))),
  );
  return sequence(
    oid(oids.signedData),
    explicit(
      0,
      sequence(
        integer(1),
        set(digest),
        sequence(oid(oids.data), explicit(0, octets(content))),
        tlv(0xa0, join(...certificates)),
        set(
          sequence(
            integer(1),
            sequence(name(signer.issuer), integer(Buffer.from(signer.serial, 'hex'))),
            digest,
            tlv(0xa0, attributes),
            sequence(oid(oids.ed25519)),
            octets(sign(null, set(attributes), signer.key.key)),
          ),
        ),
      ),
    ),
  );
}

/** OpenPGP's packet framing, in the new format. */
function packet(tag: number, body: Uint8Array): Buffer {
  const length = body.length;
  const size = length < 192 ? [length] : [((length - 192) >> 8) + 192, (length - 192) & 0xff];
  return join(Buffer.from([0xc0 | tag, ...size]), body);
}
/** A multiprecision integer: its bit count, then its bytes without leading zeros. */
function mpi(bytes: Uint8Array): Buffer {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  const value = Buffer.from(bytes.subarray(start));
  const count = (value.length - 1) * 8 + (32 - Math.clz32(value[0]!));
  return join(Buffer.from([count >> 8, count & 0xff]), value);
}
const u32 = (value: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
};
/** OpenPGP armor's checksum: CRC-24 over the packets. */
function crc24(bytes: Uint8Array): Buffer {
  let crc = 0xb704ce;
  for (const byte of bytes) {
    crc ^= byte << 16;
    for (let index = 0; index < 8; index++) {
      crc <<= 1;
      if (crc & 0x1000000) crc ^= 0x1864cfb;
    }
  }
  return Buffer.from([(crc >> 16) & 0xff, (crc >> 8) & 0xff, crc & 0xff]);
}

/**
 * An armored OpenPGP version 4 public key: an EdDSA primary key, one user ID and its positive
 * self-certification, which `gpg` verifies.
 */
export function openPGPPublicKey(
  key: SigningKey,
  user: string,
  created: Date,
  lifetime: number,
): string {
  const createdAt = Math.floor(created.getTime() / 1000);
  const point = join(Buffer.from([0x40]), key.spki.subarray(key.spki.length - 32));
  const body = join(
    Buffer.from([4]),
    u32(createdAt),
    Buffer.from([22, 9]),
    Buffer.from('2b06010401da470f01', 'hex'),
    mpi(point),
  );
  const fingerprint = createHash('sha1')
    .update(join(Buffer.from([0x99, body.length >> 8, body.length & 0xff]), body))
    .digest();
  const userID = utf8(user);
  const subpacket = (type: number, data: Uint8Array) =>
    join(Buffer.from([data.length + 1, type]), data);
  const hashed = join(
    subpacket(2, u32(createdAt)),
    subpacket(9, u32(lifetime)),
    subpacket(27, Buffer.from([0x03])),
    subpacket(33, join(Buffer.from([4]), fingerprint)),
  );
  const header = join(
    Buffer.from([4, 0x13, 22, 8, hashed.length >> 8, hashed.length & 0xff]),
    hashed,
  );
  const digest = createHash('sha256')
    .update(join(Buffer.from([0x99, body.length >> 8, body.length & 0xff]), body))
    .update(join(Buffer.from([0xb4]), u32(userID.length), userID))
    .update(header)
    .update(join(Buffer.from([4, 0xff]), u32(header.length)))
    .digest();
  const signature = sign(null, digest, key.key);
  const unhashed = subpacket(16, fingerprint.subarray(12));
  const packets = join(
    packet(6, body),
    packet(13, userID),
    packet(
      2,
      join(
        header,
        Buffer.from([unhashed.length >> 8, unhashed.length & 0xff]),
        unhashed,
        digest.subarray(0, 2),
        mpi(signature.subarray(0, 32)),
        mpi(signature.subarray(32)),
      ),
    ),
  );
  const lines = packets.toString('base64').match(/.{1,64}/g) ?? [];
  return [
    '-----BEGIN PGP PUBLIC KEY BLOCK-----',
    '',
    ...lines,
    '=' + crc24(packets).toString('base64'),
    '-----END PGP PUBLIC KEY BLOCK-----',
    '',
  ].join('\n');
}
