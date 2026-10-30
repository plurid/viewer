/**
 * CERTIFICATES AND KEYS: what a PEM, DER or OpenPGP file holds, as a person reads it. The desktop
 * service reads each block in its preview worker with Node's X.509 and key parsers; this module
 * splits the text and names keys and dates. A private key is described by its type and size only:
 * its bytes never leave the worker.
 */

/** The extensions read as certificates and keys; `.key`, `.pub` and `.asc` only when PEM or armor. */
export const certificateFormats = ['pem', 'crt', 'cer', 'der'] as const;
export const keyFormats = ['key', 'pub', 'asc'] as const;
/** OpenSSH's own names for private key files, which carry no extension. */
export const privateKeyNames = [
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_ecdsa_sk',
  'id_ed25519_sk',
] as const;
export const keyLimits = { bytes: 4_000_000, blocks: 256 } as const;

/** A key's algorithm: RSA 2048, EC P-256, Ed25519. */
export interface KeyDescription {
  type: string;
  /** An RSA, DSA or DH modulus, or an elliptic curve's size. */
  bits?: number;
  curve?: string;
}

export interface CertificateFacts {
  subject: string;
  issuer: string;
  /** Hexadecimal, as the certificate stores it. */
  serial: string;
  /** ISO times. */
  validFrom: string;
  validTo: string;
  key: KeyDescription;
  /** Subject alternative names: `DNS:example.com`, `IP Address:127.0.0.1`. */
  names: string[];
  /** Extended key usages, named where known. */
  usages: string[];
  sha256: string;
  sha1: string;
  ca: boolean;
  /** Issued by its own subject, and signed by its own key. */
  selfSigned: boolean;
  /** The block in the same file that issued it and whose key verifies its signature. */
  issuedBy?: number;
}

export type CertificateStatus = 'valid' | 'expired' | 'not-yet-valid';

export type OpenPGPKind = 'public-key' | 'private-key' | 'signature' | 'message' | 'signed-message';

export interface OpenPGPKey {
  role: 'primary' | 'subkey';
  key: KeyDescription;
  /** Absent for a private key block, where only type and size are shown. */
  created?: string;
  expires?: string;
  fingerprint?: string;
}

export interface OpenPGPFacts {
  kind: OpenPGPKind;
  keys: OpenPGPKey[];
  /** User IDs of a public key block. */
  users: string[];
  /** A signature's issuer and time. */
  signer?: string;
  signed?: string;
  /** The key IDs an encrypted message is for. */
  recipients: string[];
}

export type KeyBlock =
  | { kind: 'certificate'; label: string; certificate: CertificateFacts }
  | { kind: 'private-key'; label: string; key?: KeyDescription; encrypted: boolean }
  | { kind: 'public-key'; label: string; key: KeyDescription; sha256?: string }
  | { kind: 'openpgp'; label: string; openpgp: OpenPGPFacts }
  /** A block the parser cannot read: its text, unless it is a private key's. */
  | { kind: 'unread'; label: string; reason: string; text?: string };

/** PEM or armor text, a DER file, text without PEM, or other bytes, which other previews read. */
export type KeyEncoding = 'pem' | 'der' | 'text' | 'other';

export interface KeyFile {
  kind: 'keys';
  encoding: KeyEncoding;
  blocks: KeyBlock[];
  /** More blocks than `keyLimits.blocks`. */
  truncated: boolean;
}

export interface PEMBlock {
  label: string;
  headers: Record<string, string>;
  /** Base64 for PEM and armor; the signed text of a cleartext-signed message. */
  body: string;
  /** The block as written, from its BEGIN line to its END line. */
  text: string;
}

const beginLine = /^-----BEGIN ([A-Z0-9][A-Z0-9 ]*[A-Z0-9])-----\s*$/;
const endLine = /^-----END ([A-Z0-9][A-Z0-9 ]*[A-Z0-9])-----\s*$/;
const headerLine = /^([A-Za-z][A-Za-z0-9-]*): ?(.*)$/;

/** Whether a label names private key material, which is never shown. */
export const privateLabel = (label: string) => /PRIVATE KEY/.test(label);

/** The PEM and OpenPGP armor blocks a text holds, in order, up to `limit`. */
export function pemBlocks(
  text: string,
  limit: number = keyLimits.blocks,
): { blocks: PEMBlock[]; truncated: boolean } {
  const lines = text.split(/\r?\n/);
  const blocks: PEMBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const begin = beginLine.exec(lines[index]!.trim());
    if (!begin) {
      index++;
      continue;
    }
    if (blocks.length >= limit) return { blocks, truncated: true };
    const label = begin[1]!;
    const start = index++;
    const headers: Record<string, string> = {};
    // a header continues on lines that start with white space
    while (index < lines.length && headerLine.test(lines[index]!)) {
      const [, name, value] = headerLine.exec(lines[index]!)!;
      headers[name!] = value!;
      index++;
      while (index < lines.length && /^[ \t]\S/.test(lines[index]!))
        headers[name!] += ' ' + lines[index++]!.trim();
    }
    if (label === 'PGP SIGNED MESSAGE') {
      // the cleartext runs to its signature block, which is read as a block of its own
      const body: string[] = [];
      if (lines[index]?.trim() === '') index++;
      while (index < lines.length && lines[index]!.trim() !== '-----BEGIN PGP SIGNATURE-----')
        body.push(lines[index++]!.replace(/^- /, ''));
      blocks.push({
        label,
        headers,
        body: body.join('\n'),
        text: lines.slice(start, index).join('\n'),
      });
      continue;
    }
    const body: string[] = [];
    let closed = false;
    for (; index < lines.length; index++) {
      const line = lines[index]!.trim();
      const end = endLine.exec(line);
      if (end) {
        closed = end[1] === label;
        break;
      }
      if (beginLine.test(line)) break;
      // armor's checksum line, `=` and four base64 characters
      if (/^=[A-Za-z0-9+/]{4}$/.test(line)) continue;
      if (line) body.push(line);
    }
    blocks.push({
      label,
      headers,
      body: body.join(''),
      text: lines.slice(start, closed ? index + 1 : index).join('\n'),
    });
    if (closed) index++;
  }
  return { blocks, truncated: false };
}

/** Base64 as bytes, or undefined when it is not base64. */
export function base64Bytes(text: string): Uint8Array | undefined {
  const compact = text.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 === 1) return undefined;
  try {
    const binary = atob(compact);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return undefined;
  }
}

/** Whether a text is PEM or armor: a BEGIN line and an END line of the same label. */
export function holdsPEM(text: string): boolean {
  return pemBlocks(text.slice(0, 1024 * 1024), 1).blocks.some(
    (block) => block.label === 'PGP SIGNED MESSAGE' || block.text.includes('-----END '),
  );
}

export function certificateStatus(
  certificate: Pick<CertificateFacts, 'validFrom' | 'validTo'>,
  now = Date.now(),
): CertificateStatus {
  if (now < Date.parse(certificate.validFrom)) return 'not-yet-valid';
  if (now > Date.parse(certificate.validTo)) return 'expired';
  return 'valid';
}

/** Whether a file holds private key material anywhere: its bytes are then never shown. */
export function holdsPrivateKey(file: KeyFile): boolean {
  return file.blocks.some(
    (block) =>
      block.kind === 'private-key' ||
      (block.kind === 'openpgp' && block.openpgp.kind === 'private-key') ||
      privateLabel(block.label),
  );
}

const curveNames: Readonly<Record<string, string>> = {
  prime256v1: 'P-256',
  secp256r1: 'P-256',
  secp384r1: 'P-384',
  secp521r1: 'P-521',
  'P-256': 'P-256',
  'P-384': 'P-384',
  'P-521': 'P-521',
};
const curveBits: Readonly<Record<string, number>> = {
  'P-256': 256,
  'P-384': 384,
  'P-521': 521,
  secp256k1: 256,
  brainpoolP256r1: 256,
  brainpoolP384r1: 384,
  brainpoolP512r1: 512,
};
const keyTypes: Readonly<Record<string, string>> = {
  rsa: 'RSA',
  'rsa-pss': 'RSA-PSS',
  dsa: 'DSA',
  dh: 'DH',
  ec: 'EC',
  ed25519: 'Ed25519',
  ed448: 'Ed448',
  x25519: 'X25519',
  x448: 'X448',
};

/** A key as Node's key objects describe it: `asymmetricKeyType` and its details. */
export function describeKey(
  type: string | undefined,
  details: { modulusLength?: number; namedCurve?: string } = {},
): KeyDescription {
  const name = type ? (keyTypes[type] ?? type.toUpperCase()) : 'Unknown';
  if (name === 'EC') {
    const curve = details.namedCurve
      ? (curveNames[details.namedCurve] ?? details.namedCurve)
      : undefined;
    return { type: name, curve, bits: curve ? curveBits[curve] : undefined };
  }
  return { type: name, bits: details.modulusLength };
}

/** "RSA 2048", "EC P-256", "Ed25519". */
export function keyText(key: KeyDescription): string {
  if (key.curve) return `${key.type} ${key.curve}`;
  return key.bits ? `${key.type} ${key.bits}` : key.type;
}

/** Node's subject alternative names, split on the commas between entries, not inside a quoted one. */
export function alternativeNames(value: string | undefined): string[] {
  if (!value) return [];
  const names: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    if (character === '"' && value[index - 1] !== '\\') quoted = !quoted;
    if (character === ',' && !quoted && value[index + 1] === ' ') {
      names.push(current);
      current = '';
      index++;
      continue;
    }
    current += character;
  }
  if (current) names.push(current);
  return names.map(unquotedName);
}
/** Node quotes a name holding a comma or quote as a JSON string: `DNS:"a, b"`. */
function unquotedName(name: string): string {
  const quoted = /^([^:"]+):("(?:[^"\\]|\\.)*")$/.exec(name);
  if (!quoted) return name;
  try {
    return `${quoted[1]}:${JSON.parse(quoted[2]!) as string}`;
  } catch {
    return name;
  }
}

const usageNames: Readonly<Record<string, string>> = {
  '1.3.6.1.5.5.7.3.1': 'Server authentication',
  '1.3.6.1.5.5.7.3.2': 'Client authentication',
  '1.3.6.1.5.5.7.3.3': 'Code signing',
  '1.3.6.1.5.5.7.3.4': 'Email protection',
  '1.3.6.1.5.5.7.3.8': 'Time stamping',
  '1.3.6.1.5.5.7.3.9': 'OCSP signing',
  '2.5.29.37.0': 'Any purpose',
};
export const usageName = (oid: string) => usageNames[oid] ?? oid;

/** A distinguished name, one attribute per line as Node writes it, on one line. */
export const nameText = (name: string) => name.split('\n').filter(Boolean).join(', ');
/** The common name of a distinguished name, or the whole name without one. */
export function commonName(name: string): string {
  const common = name
    .split('\n')
    .map((part) => /^CN=(.*)$/.exec(part)?.[1])
    .findLast((part) => part !== undefined);
  return common || nameText(name);
}
