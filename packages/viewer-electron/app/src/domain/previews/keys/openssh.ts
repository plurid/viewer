import type { KeyDescription } from './certificates';

const magic = 'openssh-key-v1\0';
const curves: Readonly<Record<string, { curve: string; bits: number }>> = {
  nistp256: { curve: 'P-256', bits: 256 },
  nistp384: { curve: 'P-384', bits: 384 },
  nistp521: { curve: 'P-521', bits: 521 },
};

/** SSH's length-prefixed strings and integers. */
class Reader {
  private at = 0;
  constructor(private readonly bytes: Uint8Array) {}
  number(): number {
    if (this.at + 4 > this.bytes.length) throw new Error('The OpenSSH key ends early.');
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.at, 4).getUint32(0);
    this.at += 4;
    return value;
  }
  bytesOf(): Uint8Array {
    const length = this.number();
    if (this.at + length > this.bytes.length) throw new Error('The OpenSSH key ends early.');
    return this.bytes.subarray(this.at, (this.at += length));
  }
  text(): string {
    return new TextDecoder().decode(this.bytesOf());
  }
}
/** An integer's size in bits, without the zero byte that keeps it positive. */
function bits(integer: Uint8Array): number {
  let start = 0;
  while (start < integer.length && integer[start] === 0) start++;
  if (start === integer.length) return 0;
  return (integer.length - start - 1) * 8 + (32 - Math.clz32(integer[start]!));
}

/**
 * The key an OpenSSH private key file names in its public part, and whether a passphrase protects
 * the private part, which is not read.
 */
export function readOpenSSHKey(bytes: Uint8Array): { key: KeyDescription; encrypted: boolean } {
  if (new TextDecoder('latin1').decode(bytes.subarray(0, magic.length)) !== magic)
    throw new Error('This is not an OpenSSH private key.');
  const reader = new Reader(bytes.subarray(magic.length));
  const cipher = reader.text();
  reader.text();
  reader.bytesOf();
  if (reader.number() < 1) throw new Error('The OpenSSH key holds no key.');
  const blob = new Reader(reader.bytesOf());
  const type = blob.text();
  const encrypted = cipher !== 'none';
  if (type === 'ssh-rsa') {
    blob.bytesOf();
    return { key: { type: 'RSA', bits: bits(blob.bytesOf()) }, encrypted };
  }
  if (type === 'ssh-dss') return { key: { type: 'DSA', bits: bits(blob.bytesOf()) }, encrypted };
  if (type === 'ssh-ed25519') return { key: { type: 'Ed25519' }, encrypted };
  if (type === 'sk-ssh-ed25519@openssh.com')
    return { key: { type: 'Ed25519 security key' }, encrypted };
  const ecdsa = /^(sk-)?ecdsa-sha2-(nistp\d+)(@openssh\.com)?$/.exec(type);
  if (ecdsa) {
    const curve = curves[ecdsa[2]!];
    return {
      key: {
        type: ecdsa[1] ? 'EC security key' : 'EC',
        curve: curve?.curve ?? ecdsa[2],
        bits: curve?.bits,
      },
      encrypted,
    };
  }
  return { key: { type }, encrypted };
}
