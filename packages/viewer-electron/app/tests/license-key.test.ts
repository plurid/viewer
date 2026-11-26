import { execFile } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { lstat, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { readLicenseKey } from '../src/desktop/license/signature';
import { feedPublicKey } from '../src/desktop/updates/signature';
import { releaseLicenseConfiguration } from '../tools/direct-release';
import { execRelease, releaseEnvironment, spawnRelease } from '../tools/release-environment';
import { issueLicenseKey, licenseKeyCommand } from '../tools/license-key';
import { createSigningKeys, signingKey } from '../tools/update-feed';
import { temporaryRoot } from '../tools/temporary';

const emptyConfiguration = { publicKey: '', purchaseURL: '' };

function pair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privateKey,
    pem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    configuration: {
      publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      purchaseURL: 'https://purchase.example.invalid/viewer',
    },
  };
}

describe('the offline license issuer', () => {
  it('allows only a fully empty or fully valid release configuration', () => {
    const key = pair();
    expect(() => releaseLicenseConfiguration(emptyConfiguration)).not.toThrow();
    expect(() => releaseLicenseConfiguration(key.configuration)).not.toThrow();
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .publicKey.export({ type: 'spki', format: 'der' })
      .toString('base64');
    for (const configuration of [
      { ...key.configuration, publicKey: '' },
      { ...key.configuration, publicKey: 'invalid' },
      { ...key.configuration, publicKey: rsa },
      { ...key.configuration, publicKey: key.configuration.publicKey + '!' },
    ])
      expect(() => releaseLicenseConfiguration(configuration)).toThrow(
        'licenseConfiguration.publicKey',
      );
    for (const purchaseURL of [
      '',
      'not an address',
      'http://purchase.example.invalid',
      'https://user:secret@purchase.example.invalid',
    ])
      expect(() => releaseLicenseConfiguration({ ...key.configuration, purchaseURL })).toThrow(
        'licenseConfiguration.purchaseURL',
      );
  });
  it('creates an owner-only private key outside the repository and prints only the public key', async () => {
    const root = await temporaryRoot('viewer-license-issuer-');
    const file = path.join(root, 'generated-key.pem');
    const output = await licenseKeyCommand(['keys', file]);
    const pem = await readFile(file, 'utf8');
    expect((await lstat(file)).mode & 0o777).toBe(0o600);
    expect(output).not.toContain('PRIVATE KEY');
    expect(output).not.toContain(pem);
    expect(output).not.toContain(file);
    const key = feedPublicKey(output.split('\n').at(-1)!);
    expect(key.asymmetricKeyType).toBe('ed25519');
    await expect(licenseKeyCommand(['keys', file])).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe(pem);
  });

  it('reads the named license variable without accepting ambiguous, relative or repository paths', async () => {
    const key = pair();
    const root = await temporaryRoot('viewer-license-secret-');
    const file = path.join(root, 'generated-key.pem');
    await writeFile(file, key.pem, { mode: 0o600 });
    for (const env of [
      { VIEWER_LICENSE_SIGNING_KEY: key.pem },
      { VIEWER_LICENSE_SIGNING_KEY_FILE: file },
    ])
      expect((await signingKey(env, 'VIEWER_LICENSE_SIGNING_KEY')).asymmetricKeyType).toBe(
        'ed25519',
      );
    await expect(signingKey({}, 'VIEWER_LICENSE_SIGNING_KEY')).rejects.toThrow(
      'VIEWER_LICENSE_SIGNING_KEY_FILE',
    );
    await expect(
      signingKey(
        { VIEWER_LICENSE_SIGNING_KEY: key.pem, VIEWER_LICENSE_SIGNING_KEY_FILE: file },
        'VIEWER_LICENSE_SIGNING_KEY',
      ),
    ).rejects.toThrow('not both');
    await expect(
      signingKey(
        { VIEWER_LICENSE_SIGNING_KEY_FILE: 'generated.pem' },
        'VIEWER_LICENSE_SIGNING_KEY',
      ),
    ).rejects.toThrow('absolute');
    const repositoryFile = fileURLToPath(new URL('../package.json', import.meta.url));
    await expect(
      signingKey({ VIEWER_LICENSE_SIGNING_KEY_FILE: repositoryFile }, 'VIEWER_LICENSE_SIGNING_KEY'),
    ).rejects.toThrow('outside the repository');
    const link = path.join(root, 'linked.pem');
    await symlink(repositoryFile, link);
    await expect(
      signingKey({ VIEWER_LICENSE_SIGNING_KEY_FILE: link }, 'VIEWER_LICENSE_SIGNING_KEY'),
    ).rejects.toThrow('outside the repository');
    const forbidden = fileURLToPath(new URL(`../generated-${randomUUID()}.pem`, import.meta.url));
    await expect(createSigningKeys(forbidden, 'VIEWER_LICENSE_SIGNING_KEY')).rejects.toThrow(
      'outside the repository',
    );
    await expect(
      signingKey({ VIEWER_LICENSE_SIGNING_KEY: 'invalid PEM' }, 'VIEWER_LICENSE_SIGNING_KEY'),
    ).rejects.toThrow('PEM private key');
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    await expect(
      signingKey(
        { VIEWER_LICENSE_SIGNING_KEY: rsa.export({ type: 'pkcs8', format: 'pem' }).toString() },
        'VIEWER_LICENSE_SIGNING_KEY',
      ),
    ).rejects.toThrow('Ed25519');
  });

  it('issues and verifies a key against the embedded public key with the UTC issue date', async () => {
    const key = pair();
    const email = `${randomUUID()}@buyer.example.invalid`;
    const order = randomUUID();
    const text = await licenseKeyCommand(
      ['issue', email, order],
      { VIEWER_LICENSE_SIGNING_KEY: key.pem },
      key.configuration,
      new Date('2026-11-15T23:59:59Z'),
    );
    expect(text.startsWith('viewer-license-1.')).toBe(true);
    expect(readLicenseKey(text, feedPublicKey(key.configuration.publicKey))).toEqual({
      product: 'viewer',
      email,
      order,
      issued: '2026-11-15',
    });
    const output = await licenseKeyCommand(['verify', text], {}, key.configuration);
    expect(output).toBe(`Licensed to ${email}\nOrder: ${order}\nIssued: 2026-11-15`);
    expect(output).not.toContain('PRIVATE KEY');
    await expect(licenseKeyCommand(['verify', text], {}, emptyConfiguration)).rejects.toThrow(
      'no license public key',
    );
  });

  it.each([
    'müller@example.de',
    'buyer@bücher.example',
    'buyer@example.xn--p1ai',
    'a&b@example.com',
    'first/last@example.com',
  ])('issues a key for the purchase address %s', (email) => {
    const key = pair();
    const value = { product: 'viewer' as const, email, order: randomUUID(), issued: '2026-11-15' };
    const text = issueLicenseKey(value, key.privateKey, key.configuration);
    expect(readLicenseKey(text, feedPublicKey(key.configuration.publicKey))).toEqual(value);
  });

  it('rejects issuer addresses with missing parts, several at signs, whitespace or controls', () => {
    const key = pair();
    for (const email of [
      '',
      '@buyer',
      'buyer@',
      'a@b@c',
      ' buyer@example.invalid',
      'a b@example.invalid',
      'buyer@example.invalid\n',
      'a\tb@example.invalid',
      'a\u0000b@example.invalid',
      'a\u007fb@example.invalid',
      'a\u0085b@example.invalid',
      'a\u009fb@example.invalid',
      'x'.repeat(321) + '@buyer.example.invalid',
    ])
      expect(() =>
        issueLicenseKey(
          { product: 'viewer', email, order: randomUUID(), issued: '2026-11-15' },
          key.privateKey,
          key.configuration,
        ),
      ).toThrow('purchase email');
  });

  it('refuses issuance with a foreign signing key or no embedded key', () => {
    const key = pair();
    const value = {
      product: 'viewer' as const,
      email: `${randomUUID()}@buyer.example.invalid`,
      order: randomUUID(),
      issued: '2026-11-15',
    };
    expect(() => issueLicenseKey(value, pair().privateKey, key.configuration)).toThrow(
      'does not match',
    );
    expect(() => issueLicenseKey(value, key.privateKey, emptyConfiguration)).toThrow(
      'before issuing keys',
    );
    expect(() =>
      issueLicenseKey({ ...value, email: 'invalid' }, key.privateKey, key.configuration),
    ).toThrow('purchase email');
  });

  it('refuses issuance when only the public key is configured', async () => {
    const key = pair();
    await expect(
      licenseKeyCommand(
        ['issue', `${randomUUID()}@buyer.example.invalid`, randomUUID()],
        { VIEWER_LICENSE_SIGNING_KEY: key.pem },
        { ...key.configuration, purchaseURL: '' },
      ),
    ).rejects.toThrow('licenseConfiguration.purchaseURL');
  });

  it('names the private key path argument when it is relative', async () => {
    await expect(
      licenseKeyCommand(['keys', 'relative.pem'], {}, emptyConfiguration),
    ).rejects.toThrow('private key path argument must be absolute');
  });

  it('strips both signing variables and file references from release child environments', () => {
    expect(
      releaseEnvironment({
        VIEWER_UPDATE_SIGNING_KEY: 'generated update secret',
        VIEWER_UPDATE_SIGNING_KEY_FILE: '/generated/update.pem',
        VIEWER_LICENSE_SIGNING_KEY: 'generated license secret',
        VIEWER_LICENSE_SIGNING_KEY_FILE: '/generated/license.pem',
        PATH: '/generated/bin',
      }),
    ).toEqual({ PATH: '/generated/bin' });
  });

  it('strips publisher variables at the release exec and spawn boundaries', async () => {
    const names = [
      'VIEWER_LICENSE_SIGNING_KEY',
      'VIEWER_LICENSE_SIGNING_KEY_FILE',
      'VIEWER_UPDATE_SIGNING_KEY',
      'VIEWER_UPDATE_SIGNING_KEY_FILE',
    ];
    const env = Object.fromEntries(names.map((name) => [name, 'dummy']));
    const args = [
      '-p',
      'JSON.stringify(Object.keys(process.env).filter(key => key.includes("SIGNING_KEY")))',
    ];
    for (const name of names) vi.stubEnv(name, 'dummy');
    try {
      for (const options of [{ env }, {}]) {
        expect((await execRelease(process.execPath, args, options)).stdout.trim()).toBe('[]');
        const child = spawnRelease(process.execPath, args, {
          ...options,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        for await (const bytes of child.stdout!) stdout += bytes;
        expect(stdout.trim()).toBe('[]');
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each(['mas', 'qualification'])(
    'filters the %s child environment through the release policy',
    async (file) => {
      const source = await readFile(new URL('../tools/' + file + '.ts', import.meta.url), 'utf8');
      expect(source).toMatch(/releaseEnvironment\(/);
      expect(source).not.toMatch(/env:\s*\{\s*\.\.\.process\.env/);
    },
  );

  it('writes CLI usage errors to stdout only regardless of the shipped configuration', async () => {
    const exec = promisify(execFile);
    let result;
    try {
      await exec(process.execPath, ['--import', 'tsx', 'tools/license-key.ts', 'invalid-command'], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
      });
    } catch (error) {
      result = error as { code: number; stdout: string; stderr: string };
    }
    expect(result?.code).toBe(1);
    expect(result?.stdout).toContain('Usage: tools/license-key.ts');
    expect(result?.stderr).toBe('');
  });
});
