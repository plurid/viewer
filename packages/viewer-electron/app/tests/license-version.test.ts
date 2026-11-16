import { app } from 'electron';
import { generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { issueLicenseKey } from '../tools/license-key';
import { temporaryRoot } from '../tools/temporary';

const native = vi.hoisted(() => ({ version: '0.1.0-0', publicKey: '' }));

vi.mock('electron', () => ({
  app: { getVersion: () => native.version },
  shell: { openExternal: vi.fn() },
}));

vi.mock('../src/desktop/release', () => ({
  licenseConfiguration: {
    get publicKey() {
      return native.publicKey;
    },
    purchaseURL: 'https://purchase.example.invalid/viewer',
  },
}));

it('keeps the same key licensed across app revisions and launcher numbers', async () => {
  const root = await temporaryRoot('viewer-license-version-');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  native.publicKey = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const email = 'buyer@example.invalid';
  const key = issueLicenseKey(
    { product: 'viewer', email, order: 'generated-order', issued: '2026-11-16' },
    privateKey,
  );

  for (const version of ['0.1.0-0', '0.1.0-1', '0.1.1-0', '0.2.0-0']) {
    native.version = version;
    expect(app.getVersion()).toBe(version);
    vi.resetModules();
    const { applicationLicense } = await import('../src/desktop/license/native');
    const license = applicationLicense(root, vi.fn());
    if (version === '0.1.0-0') await license.enter(key);
    expect(await license.status()).toEqual({ kind: 'licensed', email });
    const record = JSON.parse(await readFile(path.join(root, 'license-v1.json'), 'utf8'));
    expect(record.key).toBe(key);
  }
});
