/**
 * Certificates and keys are read in the preview worker with Node's parsers: each certificate's
 * fields and the chain they form, and a private key by its type and size, with nothing of the key
 * itself in what the preview receives.
 */
import { X509Certificate, createHash, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { KeyBlock, KeyFile } from '../src/domain/previews/keys/certificates';
import { inspectedText, readKeyFile } from '../src/desktop/previews/inspected';
import {
  alternativeNames,
  certificateStatus,
  holdsPEM,
  holdsPrivateKey,
  pemBlocks,
} from '../src/domain/previews/keys/certificates';
import { readArmor } from '../src/domain/previews/keys/openpgp';
import {
  certificate,
  openPGPPublicKey,
  pem,
  publicP256,
  signingKey,
} from '../tools/playground/keys';
import { sampleCertificates } from '../tools/playground/samples/inspection';

const text = (value: string) => new TextEncoder().encode(value);
const read = (value: string | Uint8Array) =>
  readKeyFile(typeof value === 'string' ? text(value) : value);
const only = (file: KeyFile): KeyBlock => {
  expect(file.blocks).toHaveLength(1);
  return file.blocks[0]!;
};
const digest = (algorithm: 'sha1' | 'sha256', bytes: Uint8Array) =>
  createHash(algorithm).update(bytes).digest('hex');
const chain = sampleCertificates();

describe('certificate fields', () => {
  it('reads subject, issuer, serial, validity, key, names, usages and fingerprints', () => {
    const block = only(read(chain.server));
    expect(block.kind).toBe('certificate');
    if (block.kind !== 'certificate') return;
    const expected = new X509Certificate(chain.server);
    expect(block.certificate).toMatchObject({
      subject: 'O=Viewer Playground\nCN=viewer.example',
      issuer: 'O=Viewer Playground\nCN=Viewer Sample Intermediate CA',
      serial: expected.serialNumber,
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2036-01-01T00:00:00.000Z',
      key: { type: 'EC', curve: 'P-256', bits: 256 },
      names: ['DNS:viewer.example', 'DNS:www.viewer.example', 'IP Address:127.0.0.1'],
      usages: ['Server authentication', 'Client authentication'],
      sha256: expected.fingerprint256,
      sha1: expected.fingerprint,
      ca: false,
      selfSigned: false,
    });
    expect(read(chain.server).encoding).toBe('der');
  });

  it('links a chain in one PEM file, verified by each issuer’s key', () => {
    const file = read(
      pem('CERTIFICATE', chain.server) +
        pem('CERTIFICATE', chain.intermediate) +
        pem('CERTIFICATE', chain.root),
    );
    expect(file.encoding).toBe('pem');
    const certificates = file.blocks.map((block) =>
      block.kind === 'certificate' ? block.certificate : undefined,
    );
    expect(certificates.map((item) => item?.issuedBy)).toEqual([1, 2, undefined]);
    expect(certificates.map((item) => item?.ca)).toEqual([false, true, true]);
    expect(certificates[2]).toMatchObject({ selfSigned: true, key: { type: 'Ed25519' } });
  });

  it('does not link a certificate whose issuer’s name matches but whose signature does not', () => {
    const impostor = signingKey('impostor');
    const forged = certificate({
      subject: { organization: 'Viewer Playground', common: 'forged.viewer.example' },
      issuer: { organization: 'Viewer Playground', common: 'Viewer Sample Intermediate CA' },
      signer: impostor,
      spki: publicP256('forged'),
      serial: '42',
      notBefore: new Date('2026-01-01T00:00:00Z'),
      notAfter: new Date('2027-01-01T00:00:00Z'),
      role: 'server',
    });
    const file = read(pem('CERTIFICATE', forged) + pem('CERTIFICATE', chain.intermediate));
    const block = file.blocks[0]!;
    expect(block.kind === 'certificate' && block.certificate.issuedBy).toBeUndefined();
  });

  it('calls out an expired certificate and one not yet valid', () => {
    const expired = only(read(chain.expired));
    if (expired.kind !== 'certificate') throw new Error('Expected a certificate.');
    expect(certificateStatus(expired.certificate)).toBe('expired');
    expect(certificateStatus(expired.certificate, Date.parse('2020-06-01'))).toBe('valid');
    expect(certificateStatus(expired.certificate, Date.parse('2019-06-01'))).toBe('not-yet-valid');
  });

  it('splits subject alternative names Node quotes because they hold a comma', () => {
    expect(alternativeNames('DNS:a.example, DNS:"b, c.example", email:x@example.com')).toEqual([
      'DNS:a.example',
      'DNS:b, c.example',
      'email:x@example.com',
    ]);
    expect(alternativeNames(undefined)).toEqual([]);
  });
});

describe('private keys', () => {
  const keys = {
    rsa: generateKeyPairSync('rsa', { modulusLength: 2048 }),
    ec: generateKeyPairSync('ec', { namedCurve: 'secp384r1' }),
    ed25519: generateKeyPairSync('ed25519'),
  };
  /** Base64 of the private key's own bytes, as any leak of it would show. */
  const material = (pemText: string) =>
    pemText
      .split('\n')
      .filter((line) => line && !line.startsWith('-----'))
      .join('');

  it.each([
    ['PKCS #8 RSA', keys.rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }), 'RSA', 2048],
    ['PKCS #1 RSA', keys.rsa.privateKey.export({ type: 'pkcs1', format: 'pem' }), 'RSA', 2048],
    ['SEC 1 EC', keys.ec.privateKey.export({ type: 'sec1', format: 'pem' }), 'EC', 384],
    [
      'Ed25519',
      keys.ed25519.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      'Ed25519',
      undefined,
    ],
  ] as const)('shows a %s key by its type and size only', (_name, key, type, bits) => {
    const file = read(String(key));
    const block = only(file);
    expect(block).toMatchObject({ kind: 'private-key', encrypted: false, key: { type, bits } });
    expect(holdsPrivateKey(file)).toBe(true);
    const sent = JSON.stringify(file) + inspectedText(file);
    for (const piece of material(String(key)).match(/.{16}/g)!) expect(sent).not.toContain(piece);
  });

  it('names an encrypted key without its passphrase and never reads it', () => {
    const encrypted = keys.rsa.privateKey.export({
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase: 'correct horse',
    });
    expect(only(read(String(encrypted)))).toEqual({
      kind: 'private-key',
      label: 'ENCRYPTED PRIVATE KEY',
      encrypted: true,
    });
    const der = keys.ec.privateKey.export({
      type: 'pkcs8',
      format: 'der',
      cipher: 'aes-256-cbc',
      passphrase: 'correct horse',
    });
    expect(only(read(new Uint8Array(der)))).toMatchObject({ kind: 'private-key', encrypted: true });
  });

  it('reads a DER private key as one, and its bytes stay out of the result', () => {
    const der = keys.ec.privateKey.export({ type: 'pkcs8', format: 'der' });
    const file = read(new Uint8Array(der));
    expect(only(file)).toMatchObject({ kind: 'private-key', key: { type: 'EC', curve: 'P-384' } });
    expect(JSON.stringify(file)).not.toContain(der.subarray(der.length - 24).toString('base64'));
  });

  it('keeps a private key it cannot read from showing as text', () => {
    const broken =
      '-----BEGIN PRIVATE KEY-----\nTm90IGEga2V5IGF0IGFsbA==\n-----END PRIVATE KEY-----\n';
    const file = read(broken);
    expect(only(file)).toEqual({ kind: 'private-key', label: 'PRIVATE KEY', encrypted: false });
    expect(JSON.stringify(file)).not.toContain('Tm90IGEga2V5');
  });

  it('names an OpenSSH private key from its public part, and reads nothing of its private part', () => {
    const publicKey = keys.ed25519.publicKey.export({ type: 'spki', format: 'der' }).subarray(12);
    const field = (bytes: Uint8Array | string) => {
      const value = typeof bytes === 'string' ? Buffer.from(bytes) : Buffer.from(bytes);
      const length = Buffer.alloc(4);
      length.writeUInt32BE(value.length);
      return Buffer.concat([length, value]);
    };
    const secret = Buffer.from('SECRET-KEY-MATERIAL-THAT-MUST-NOT-LEAK');
    const blob = Buffer.concat([field('ssh-ed25519'), field(publicKey)]);
    const count = Buffer.alloc(4);
    count.writeUInt32BE(1);
    const key = Buffer.concat([
      Buffer.from('openssh-key-v1\0'),
      field('aes256-ctr'),
      field('bcrypt'),
      field(Buffer.alloc(24)),
      count,
      field(blob),
      field(secret),
    ]);
    const file = read(pem('OPENSSH PRIVATE KEY', key));
    expect(only(file)).toEqual({
      kind: 'private-key',
      label: 'OPENSSH PRIVATE KEY',
      key: { type: 'Ed25519' },
      encrypted: true,
    });
    expect(JSON.stringify(file)).not.toContain(secret.toString('base64').slice(0, 16));
  });

  it('reads a key named as OpenSSH names its own, without an extension', async () => {
    const { previewModules, choosePreview } = await import('../src/renderer/previews/registry');
    const entry = (name: string, extension: string) =>
      ({ name, extension, directory: false, mime: 'application/octet-stream' }) as never;
    expect(choosePreview(entry('id_ed25519', '')).id).toBe('certificate');
    expect(choosePreview(entry('Server.pub', 'pub')).id).toBe('certificate');
    expect(previewModules.find((module) => module.id === 'certificate')?.hex).toBe('own');
  });
});

describe('PEM and OpenPGP text', () => {
  it('splits blocks with their headers, and keeps unread ones as text unless private', () => {
    const request =
      '-----BEGIN CERTIFICATE REQUEST-----\nTUlJQ2pE\n-----END CERTIFICATE REQUEST-----';
    const legacy =
      '-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,00\n\nAAAA\n-----END RSA PRIVATE KEY-----';
    const { blocks } = pemBlocks(`Bag Attributes\n${request}\n${legacy}\n`);
    expect(blocks.map((block) => [block.label, block.headers])).toEqual([
      ['CERTIFICATE REQUEST', {}],
      ['RSA PRIVATE KEY', { 'Proc-Type': '4,ENCRYPTED', 'DEK-Info': 'AES-128-CBC,00' }],
    ]);
    const file = read(`${request}\n${legacy}\n`);
    expect(file.blocks).toEqual([
      {
        kind: 'unread',
        label: 'CERTIFICATE REQUEST',
        reason: 'Viewer does not read certificate request blocks.',
        text: request,
      },
      { kind: 'private-key', label: 'RSA PRIVATE KEY', key: { type: 'RSA' }, encrypted: true },
    ]);
    expect(holdsPEM(request)).toBe(true);
    expect(holdsPEM('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 someone@example.com')).toBe(false);
  });

  it('bounds the blocks it reads', () => {
    const many = pem('CERTIFICATE', chain.root).repeat(300);
    const file = read(many);
    expect(file.blocks).toHaveLength(256);
    expect(file.truncated).toBe(true);
  });

  it('reads an armored public key: its user ID, key, expiry and the fingerprint gpg gives', () => {
    const armor = openPGPPublicKey(
      signingKey('OpenPGP signing key'),
      'Viewer Sample Signing Key <signing@viewer.example>',
      new Date('2026-01-01T00:00:00Z'),
      10 * 365 * 24 * 3600,
    );
    const block = only(read(armor));
    expect(block).toMatchObject({
      kind: 'openpgp',
      openpgp: {
        kind: 'public-key',
        users: ['Viewer Sample Signing Key <signing@viewer.example>'],
        keys: [
          {
            role: 'primary',
            key: { type: 'EdDSA', curve: 'Ed25519' },
            created: '2026-01-01T00:00:00.000Z',
            expires: '2035-12-30T00:00:00.000Z',
            // as `gpg --show-keys` prints it for the playground's key
            fingerprint: 'f619f2ce662a4466531b0c084de145d377b89836',
          },
        ],
      },
    });
  });

  it('names an armored private key’s type and size, and nothing else', () => {
    const [, , ...rest] = Buffer.from(
      pemBlocks(
        openPGPPublicKey(
          signingKey('secret'),
          'Secret Holder <secret@viewer.example>',
          new Date(0),
          0,
        ),
      ).blocks[0]!.body,
      'base64',
    );
    // the public key packet's body, then a secret part: no string-to-key, and a marker for its key
    const body = Buffer.from(rest).subarray(0, 51);
    const secret = Buffer.concat([
      body,
      Buffer.from([0]),
      Buffer.from([0, 64]),
      Buffer.from('SECRET-SECRET-SECRET'),
    ]);
    const packets = Buffer.concat([
      Buffer.from([0xc5, secret.length]),
      secret,
      Buffer.from([0xcd, 5]),
      Buffer.from('Alice'),
    ]);
    const facts = readArmor(
      { label: 'PGP PRIVATE KEY BLOCK', headers: {}, body: packets.toString('base64'), text: '' },
      digest,
    );
    expect(facts).toEqual({
      kind: 'private-key',
      keys: [{ role: 'primary', key: { type: 'EdDSA', curve: 'Ed25519', bits: 256 } }],
      users: [],
      recipients: [],
    });
  });
});
