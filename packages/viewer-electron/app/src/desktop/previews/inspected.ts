import { X509Certificate, createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import type { Digest } from '../../domain/previews/digest';
import type { InspectedFile, InspectedKind } from '../../domain/previews/inspected';
import type { ProvisionCertificate } from '../../domain/previews/data/provision';
import type {
  CertificateFacts,
  KeyBlock,
  KeyDescription,
  KeyFile,
  PEMBlock,
} from '../../domain/previews/keys/certificates';
import {
  alternativeNames,
  base64Bytes,
  commonName,
  describeKey,
  keyLimits,
  keyText,
  nameText,
  pemBlocks,
  privateLabel,
  usageName,
} from '../../domain/previews/keys/certificates';
import { isArmor, readArmor } from '../../domain/previews/keys/openpgp';
import { readOpenSSHKey } from '../../domain/previews/keys/openssh';
import { readProvision } from '../../domain/previews/data/provision';
import { readTorrent } from '../../domain/previews/data/torrent';

/**
 * CERTIFICATES, KEYS, TORRENTS AND PROFILES, read in the preview worker. Node's X.509 and key
 * parsers read certificates and keys; a private key is loaded only to name its type and size, and
 * nothing of it is returned.
 */
const digest: Digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
const colons = (hex: string) => hex.toUpperCase().replace(/(..)(?!$)/g, '$1:');

const describe = (key: KeyObject): KeyDescription =>
  describeKey(key.asymmetricKeyType, key.asymmetricKeyDetails);
const verifies = (certificate: X509Certificate, key: KeyObject) => {
  try {
    return certificate.verify(key);
  } catch {
    return false;
  }
};
/** Node 23 and later give the dates as dates; earlier ones as text. */
function isoDate(value: Date | undefined, text: string): string {
  const date = value ?? new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}
/** The first DER SEQUENCE: a trusted certificate carries OpenSSL's own data after its own. */
function firstSequence(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0x30 || bytes.length < 2) return bytes;
  const first = bytes[1]!;
  if (first < 0x80) return bytes.subarray(0, 2 + first);
  const size = first & 0x7f;
  if (size < 1 || size > 4 || bytes.length < 2 + size) return bytes;
  let length = 0;
  for (let index = 0; index < size; index++) length = length * 256 + bytes[2 + index]!;
  return bytes.subarray(0, Math.min(bytes.length, 2 + size + length));
}

function certificateFacts(certificate: X509Certificate): CertificateFacts {
  let key: KeyDescription = { type: 'Unknown' };
  let publicKey: KeyObject | undefined;
  try {
    publicKey = certificate.publicKey;
    key = describe(publicKey);
  } catch {
    // a key algorithm Node does not read leaves the rest of the certificate readable
  }
  return {
    subject: certificate.subject,
    issuer: certificate.issuer,
    serial: certificate.serialNumber,
    validFrom: isoDate(certificate.validFromDate as Date | undefined, certificate.validFrom),
    validTo: isoDate(certificate.validToDate as Date | undefined, certificate.validTo),
    key,
    names: alternativeNames(certificate.subjectAltName),
    usages: (certificate.keyUsage ?? []).map(usageName),
    sha256: certificate.fingerprint256,
    sha1: certificate.fingerprint,
    ca: certificate.ca,
    selfSigned:
      certificate.checkIssued(certificate) && !!publicKey && verifies(certificate, publicKey),
  };
}

/** The key type a traditional private key label names: RSA, EC or DSA. */
const labelledKey = (label: string): KeyDescription | undefined => {
  const type = /^(RSA|EC|DSA) PRIVATE KEY$/.exec(label)?.[1];
  return type ? { type } : undefined;
};

interface ReadBlock {
  block: KeyBlock;
  certificate?: X509Certificate;
}
function readPrivateKey(block: PEMBlock): KeyBlock {
  const { label } = block;
  if (label === 'OPENSSH PRIVATE KEY') {
    const bytes = base64Bytes(block.body);
    try {
      if (bytes) return { kind: 'private-key', label, ...readOpenSSHKey(bytes) };
    } catch {
      // read below as a private key of unknown type
    }
    return { kind: 'private-key', label, encrypted: false };
  }
  const encrypted =
    label === 'ENCRYPTED PRIVATE KEY' || /ENCRYPTED/.test(block.headers['Proc-Type'] ?? '');
  if (encrypted) return { kind: 'private-key', label, key: labelledKey(label), encrypted };
  try {
    const key = createPrivateKey({ key: block.text, format: 'pem' });
    return { kind: 'private-key', label, key: describe(key), encrypted: false };
  } catch {
    return { kind: 'private-key', label, key: labelledKey(label), encrypted: false };
  }
}
function readBlock(block: PEMBlock): ReadBlock {
  const { label } = block;
  const unread = (reason: string): ReadBlock => ({
    block: { kind: 'unread', label, reason, text: privateLabel(label) ? undefined : block.text },
  });
  if (isArmor(label))
    try {
      return { block: { kind: 'openpgp', label, openpgp: readArmor(block, digest) } };
    } catch {
      return unread('Viewer could not read this OpenPGP block.');
    }
  if (privateLabel(label)) return { block: readPrivateKey(block) };
  if (['CERTIFICATE', 'X509 CERTIFICATE', 'TRUSTED CERTIFICATE'].includes(label)) {
    const bytes = base64Bytes(block.body);
    try {
      if (!bytes) throw new Error();
      const certificate = new X509Certificate(firstSequence(bytes));
      return {
        block: { kind: 'certificate', label, certificate: certificateFacts(certificate) },
        certificate,
      };
    } catch {
      return unread('Viewer could not read this certificate.');
    }
  }
  if (label === 'PUBLIC KEY' || label === 'RSA PUBLIC KEY')
    try {
      const key = createPublicKey({ key: block.text, format: 'pem' });
      const der = key.export({ type: 'spki', format: 'der' });
      return {
        block: {
          kind: 'public-key',
          label,
          key: describe(key),
          sha256: colons(digest('sha256', der)),
        },
      };
    } catch {
      return unread('Viewer could not read this public key.');
    }
  return unread(`Viewer does not read ${label.toLowerCase()} blocks.`);
}

/** Certificates issued by another in the same file, verified by its key. */
function link(blocks: KeyBlock[], certificates: ReadonlyMap<number, X509Certificate>) {
  for (const [index, certificate] of certificates) {
    const block = blocks[index];
    if (block?.kind !== 'certificate') continue;
    for (const [other, issuer] of certificates)
      if (
        other !== index &&
        certificate.checkIssued(issuer) &&
        verifies(certificate, issuer.publicKey)
      ) {
        block.certificate.issuedBy = other;
        break;
      }
  }
}

/** A DER file: a certificate, a public key, or a private key whose type and size are named. */
function readDER(bytes: Uint8Array): KeyFile {
  const buffer = Buffer.from(firstSequence(bytes));
  const file = (block: KeyBlock): KeyFile => ({
    kind: 'keys',
    encoding: 'der',
    blocks: [block],
    truncated: false,
  });
  try {
    const certificate = new X509Certificate(buffer);
    return file({
      kind: 'certificate',
      label: 'CERTIFICATE',
      certificate: certificateFacts(certificate),
    });
  } catch {
    // read below as a key
  }
  try {
    const key = createPublicKey({ key: buffer, format: 'der', type: 'spki' });
    return file({
      kind: 'public-key',
      label: 'PUBLIC KEY',
      key: describe(key),
      sha256: colons(digest('sha256', buffer)),
    });
  } catch {
    // read below as a private key
  }
  for (const type of ['pkcs8', 'pkcs1', 'sec1'] as const)
    try {
      const key = createPrivateKey({ key: buffer, format: 'der', type });
      return file({
        kind: 'private-key',
        label: 'PRIVATE KEY',
        key: describe(key),
        encrypted: false,
      });
    } catch (error) {
      // an encrypted PKCS #8 key asks for the passphrase Viewer never has
      if ((error as NodeJS.ErrnoException).code === 'ERR_MISSING_PASSPHRASE')
        return file({ kind: 'private-key', label: 'ENCRYPTED PRIVATE KEY', encrypted: true });
    }
  return file({
    kind: 'unread',
    label: 'DER',
    reason: 'Viewer could not read this file as a certificate or key.',
  });
}

/** A PEM, armor or DER file's blocks; none when it is text without PEM. */
export function readKeyFile(bytes: Uint8Array): KeyFile {
  const text = new TextDecoder().decode(bytes);
  if (!text.includes('-----BEGIN ')) {
    if (bytes[0] === 0x30) return readDER(bytes);
    const binary = bytes.subarray(0, 8192).includes(0) || text.includes('\ufffd');
    return { kind: 'keys', encoding: binary ? 'other' : 'text', blocks: [], truncated: false };
  }
  const { blocks: found, truncated } = pemBlocks(text, keyLimits.blocks);
  const blocks: KeyBlock[] = [];
  const certificates = new Map<number, X509Certificate>();
  for (const block of found) {
    const read = readBlock(block);
    if (read.certificate) certificates.set(blocks.length, read.certificate);
    blocks.push(read.block);
  }
  link(blocks, certificates);
  return { kind: 'keys', encoding: 'pem', blocks, truncated };
}

function provisionCertificate(der: Uint8Array): ProvisionCertificate {
  try {
    const certificate = new X509Certificate(Buffer.from(der));
    return {
      subject: commonName(certificate.subject),
      validTo: isoDate(certificate.validToDate as Date | undefined, certificate.validTo),
      sha1: certificate.fingerprint,
    };
  } catch {
    return { subject: 'Unreadable certificate' };
  }
}

export function readInspected(kind: InspectedKind, bytes: Uint8Array): InspectedFile {
  if (kind === 'torrent') return readTorrent(bytes, digest);
  if (kind === 'provision') return readProvision(bytes, provisionCertificate);
  return readKeyFile(bytes);
}

/** What search reads of an inspected file: names and fingerprints, never key material. */
export function inspectedText(file: InspectedFile): string {
  if (file.kind === 'torrent')
    return [file.name, file.comment, ...file.files.slice(0, 1000).map((item) => item.path)]
      .filter(Boolean)
      .join('\n');
  if (file.kind === 'provision')
    return [file.name, file.appID, file.team, ...file.certificates.map((item) => item.subject)]
      .filter(Boolean)
      .join('\n');
  return file.blocks
    .map((block) => {
      switch (block.kind) {
        case 'certificate':
          return [
            nameText(block.certificate.subject),
            nameText(block.certificate.issuer),
            ...block.certificate.names,
            block.certificate.sha256,
          ].join('\n');
        case 'private-key':
          return `Private key${block.key ? ' ' + keyText(block.key) : ''}`;
        case 'public-key':
          return `Public key ${keyText(block.key)}`;
        case 'openpgp':
          return [
            ...block.openpgp.users,
            ...block.openpgp.keys.flatMap((key) => key.fingerprint ?? []),
          ].join('\n');
        case 'unread':
          return block.label;
      }
    })
    .join('\n\n');
}
