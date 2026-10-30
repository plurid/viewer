import type {
  KeyDescription,
  OpenPGPFacts,
  OpenPGPKey,
  OpenPGPKind,
  PEMBlock,
} from './certificates';
import type { Digest } from '../digest';
import { base64Bytes } from './certificates';

const armorKinds: Readonly<Record<string, OpenPGPKind>> = {
  'PGP PUBLIC KEY BLOCK': 'public-key',
  'PGP PRIVATE KEY BLOCK': 'private-key',
  'PGP SIGNATURE': 'signature',
  'PGP MESSAGE': 'message',
  'PGP SIGNED MESSAGE': 'signed-message',
};
export const isArmor = (label: string) => Object.hasOwn(armorKinds, label);

/** Packets read from one armor block, and bytes read in all, bound a malformed block. */
const maximumPackets = 4096;

const algorithms: Readonly<Record<number, string>> = {
  1: 'RSA',
  2: 'RSA',
  3: 'RSA',
  16: 'ElGamal',
  17: 'DSA',
  18: 'ECDH',
  19: 'ECDSA',
  22: 'EdDSA',
  25: 'X25519',
  26: 'X448',
  27: 'Ed25519',
  28: 'Ed448',
};
/** Curve OIDs as their DER bytes in hexadecimal. */
const curves: Readonly<Record<string, { name: string; bits: number }>> = {
  '2a8648ce3d030107': { name: 'P-256', bits: 256 },
  '2b81040022': { name: 'P-384', bits: 384 },
  '2b81040023': { name: 'P-521', bits: 521 },
  '2b8104000a': { name: 'secp256k1', bits: 256 },
  '2b2403030208010107': { name: 'brainpoolP256r1', bits: 256 },
  '2b240303020801010b': { name: 'brainpoolP384r1', bits: 384 },
  '2b240303020801010d': { name: 'brainpoolP512r1', bits: 512 },
  '2b06010401da470f01': { name: 'Ed25519', bits: 256 },
  '2b060104019755010501': { name: 'Curve25519', bits: 256 },
  '2b656f': { name: 'X448', bits: 448 },
  '2b6571': { name: 'Ed448', bits: 448 },
};

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const time = (seconds: number) => new Date(seconds * 1000).toISOString();

class Reader {
  at = 0;
  constructor(readonly bytes: Uint8Array) {}
  get left() {
    return this.bytes.length - this.at;
  }
  byte(): number {
    if (this.at >= this.bytes.length) throw new Error('The OpenPGP data ends early.');
    return this.bytes[this.at++]!;
  }
  number(size: number): number {
    let value = 0;
    for (let index = 0; index < size; index++) value = value * 256 + this.byte();
    return value;
  }
  take(length: number): Uint8Array {
    if (length < 0 || this.at + length > this.bytes.length)
      throw new Error('The OpenPGP data ends early.');
    return this.bytes.subarray(this.at, (this.at += length));
  }
  /** A multiprecision integer: its bit count, then its bytes. */
  mpi(): number {
    const bits = this.number(2);
    this.take(Math.ceil(bits / 8));
    return bits;
  }
}

interface Packet {
  tag: number;
  body: Uint8Array;
}
/** Packets in the old and the new header formats; a partial length ends the reading. */
function packets(bytes: Uint8Array): Packet[] {
  const reader = new Reader(bytes);
  const found: Packet[] = [];
  while (reader.left > 0 && found.length < maximumPackets) {
    const header = reader.byte();
    if (!(header & 0x80)) break;
    let tag: number, length: number;
    if (header & 0x40) {
      tag = header & 0x3f;
      const first = reader.byte();
      if (first < 192) length = first;
      else if (first < 224) length = ((first - 192) << 8) + reader.byte() + 192;
      else if (first === 255) length = reader.number(4);
      else break;
    } else {
      tag = (header >> 2) & 0xf;
      const type = header & 3;
      length = type === 3 ? reader.left : reader.number([1, 2, 4][type]!);
    }
    found.push({ tag, body: reader.take(Math.min(length, reader.left)) });
  }
  return found;
}

/** A key packet's algorithm and size, and where its public part ends. */
function keyMaterial(body: Uint8Array): {
  version: number;
  created: number;
  key: KeyDescription;
  publicEnd: number;
} {
  const reader = new Reader(body);
  const version = reader.byte();
  const created = reader.number(4);
  if (version === 3) reader.number(2);
  const algorithm = reader.byte();
  const type = algorithms[algorithm] ?? `Algorithm ${algorithm}`;
  if (version === 6 || version === 5) {
    const length = reader.number(4);
    const start = reader.at;
    const key = describe(reader, algorithm, type);
    return { version, created, key, publicEnd: start + length };
  }
  const key = describe(reader, algorithm, type);
  return { version, created, key, publicEnd: reader.at };
}
function describe(reader: Reader, algorithm: number, type: string): KeyDescription {
  switch (algorithm) {
    case 1:
    case 2:
    case 3: {
      const bits = reader.mpi();
      reader.mpi();
      return { type, bits };
    }
    case 16:
    case 17: {
      const bits = reader.mpi();
      for (let index = 0; index < (algorithm === 17 ? 3 : 2); index++) reader.mpi();
      return { type, bits };
    }
    case 18:
    case 19:
    case 22: {
      const curve = curves[hex(reader.take(reader.byte()))];
      reader.mpi();
      if (algorithm === 18) reader.take(reader.byte());
      return { type, curve: curve?.name, bits: curve?.bits };
    }
    case 25:
    case 27:
      reader.take(32);
      return { type, bits: 256 };
    case 26:
      reader.take(56);
      return { type, bits: 448 };
    case 28:
      reader.take(57);
      return { type, bits: 448 };
    default:
      return { type };
  }
}
/** Version 4 hashes the public part with SHA-1; versions 5 and 6 with SHA-256 and a longer length. */
function fingerprint(version: number, publicPart: Uint8Array, digest: Digest): string {
  if (version === 5 || version === 6) {
    const header = new Uint8Array(5);
    header[0] = version === 6 ? 0x9b : 0x9a;
    new DataView(header.buffer).setUint32(1, publicPart.length);
    return digest('sha256', concat(header, publicPart));
  }
  const header = new Uint8Array([0x99, publicPart.length >> 8, publicPart.length & 0xff]);
  return digest('sha1', concat(header, publicPart));
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  return joined;
}

interface Signature {
  type: number;
  created?: number;
  /** Seconds after the key's creation. */
  keyExpires?: number;
  issuer?: string;
}
/** A version 4 or 6 signature's subpackets; version 3 names its issuer and time directly. */
function signature(body: Uint8Array): Signature {
  const reader = new Reader(body);
  const version = reader.byte();
  if (version === 3) {
    reader.byte();
    const type = reader.byte();
    const created = reader.number(4);
    return { type, created, issuer: hex(reader.take(8)) };
  }
  const type = reader.byte();
  reader.number(2);
  const found: Signature = { type };
  const size = version === 6 ? 4 : 2;
  for (const hashed of [true, false]) {
    const area = new Reader(reader.take(reader.number(size)));
    while (area.left > 0) {
      const first = area.byte();
      const length =
        first < 192
          ? first
          : first < 255
            ? ((first - 192) << 8) + area.byte() + 192
            : area.number(4);
      const packet = new Reader(area.take(length));
      const kind = packet.byte() & 0x7f;
      if (kind === 2 && hashed) found.created = packet.number(4);
      else if (kind === 9 && hashed) found.keyExpires = packet.number(4);
      else if (kind === 16) found.issuer ??= hex(packet.take(8));
      else if (kind === 33) found.issuer = hex(packet.take(packet.left).subarray(1));
    }
  }
  return found;
}

/**
 * What an armor block holds: its keys with their user IDs, a signature's issuer, or an encrypted
 * message's recipients. A private key block names only its keys' types and sizes.
 */
export function readArmor(block: PEMBlock, digest: Digest): OpenPGPFacts {
  const kind = armorKinds[block.label] ?? 'message';
  const facts: OpenPGPFacts = { kind, keys: [], users: [], recipients: [] };
  if (kind === 'signed-message') return facts;
  const bytes = base64Bytes(block.body);
  if (!bytes) throw new Error('The armor is not base64.');
  const secret = kind === 'private-key';
  const createdAt = new Map<OpenPGPKey, number>();
  let current: OpenPGPKey | undefined;
  let primary: OpenPGPKey | undefined;
  for (const packet of packets(bytes)) {
    switch (packet.tag) {
      case 5:
      case 6:
      case 7:
      case 14: {
        const material = keyMaterial(packet.body);
        const role = packet.tag === 5 || packet.tag === 6 ? 'primary' : 'subkey';
        const key: OpenPGPKey = { role, key: material.key };
        createdAt.set(key, material.created);
        if (!secret) {
          key.created = time(material.created);
          key.fingerprint = fingerprint(
            material.version,
            packet.body.subarray(0, material.publicEnd),
            digest,
          );
        }
        facts.keys.push(key);
        current = key;
        if (role === 'primary') primary = key;
        break;
      }
      case 13:
        if (!secret) facts.users.push(new TextDecoder().decode(packet.body));
        break;
      case 2: {
        const read = signature(packet.body);
        if (kind === 'signature' && facts.signer === undefined) {
          facts.signer = read.issuer;
          if (read.created !== undefined) facts.signed = time(read.created);
        }
        // a user ID's self-signature or a subkey binding gives the key's expiry
        const owner = read.type === 0x18 ? current : primary;
        if (!secret && owner && read.keyExpires)
          owner.expires = time(createdAt.get(owner)! + read.keyExpires);
        break;
      }
      case 1: {
        const reader = new Reader(packet.body);
        const version = reader.byte();
        if (version === 3) facts.recipients.push(hex(reader.take(8)));
        break;
      }
      case 3:
        facts.recipients.push('passphrase');
        break;
    }
  }
  return facts;
}
