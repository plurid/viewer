import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  advanceTrial,
  licenseLine,
  licensePayloadSchema,
  trialDays,
  trialStatus,
} from '../src/domain/license/license';
import { License } from '../src/desktop/license/license';
import { DocumentStore } from '../src/desktop/persistence/document-store';
import type { LicenseHost } from '../src/desktop/license/license';
import { licenseEndpoint, readLicenseKey } from '../src/desktop/license/signature';
import { feedPublicKey } from '../src/desktop/updates/signature';
import { licenseConfiguration } from '../src/desktop/release';
import { temporaryRoot } from '../tools/temporary';

const day = 24 * 60 * 60 * 1000;
const started = Date.UTC(2026, 10, 1);

afterEach(() => vi.restoreAllMocks());

function keys() {
  const pair = generateKeyPairSync('ed25519');
  return {
    ...pair,
    embedded: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

function payload() {
  return {
    product: 'viewer' as const,
    email: `${randomUUID()}@buyer.example.invalid`,
    order: randomUUID(),
    issued: '2026-11-01',
  };
}

function signed(value: unknown = payload(), pair = keys()) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  return {
    text: `viewer-license-1.${bytes.toString('base64url')}.${sign(null, bytes, pair.privateKey).toString('base64url')}`,
    pair,
    bytes,
  };
}

async function fixture(options: Partial<LicenseHost> = {}) {
  const root = await temporaryRoot('viewer-license-');
  const pair = keys();
  const host: LicenseHost = {
    configuration: {
      publicKey: pair.embedded,
      purchaseURL: 'https://purchase.example.invalid/viewer',
    },
    store: false,
    open: vi.fn(async () => {}),
    changed: vi.fn(),
    now: () => started,
    ...options,
  };
  const file = path.join(root, 'license-v1.json');
  return { root, file, pair, host, license: new License(file, host) };
}

describe('offline license keys', () => {
  it('verifies exact bytes, including wrapped whitespace and later payload fields', () => {
    const value = payload();
    const issued = signed({ ...value, later: 'allowed' });
    const key = feedPublicKey(issued.pair.embedded, 'license public key');
    expect(readLicenseKey(issued.text, key)).toEqual(value);
    const wrapped = ' \n' + issued.text.match(/.{1,40}/g)!.join('\r\n\t ') + '\n ';
    expect(readLicenseKey(wrapped, key)).toEqual(value);
    expect(licensePayloadSchema.parse({ ...value, later: true })).toEqual(value);
  });

  it.each(['\u200b', '\u200d', '\u2060', '\ufeff', '\u00ad'])(
    'accepts the specified invisible copying character %j',
    (character) => {
      const value = payload();
      const issued = signed(value);
      const copied = issued.text.slice(0, 24) + character + issued.text.slice(24);
      expect(readLicenseKey(copied, issued.pair.publicKey)).toEqual(value);
    },
  );

  it.each([
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
  ])('accepts surrounding %s and %s quotes', (open, close) => {
    const value = payload();
    const issued = signed(value);
    expect(readLicenseKey(` ${open}\n${issued.text}\n${close} `, issued.pair.publicKey)).toEqual(
      value,
    );
  });

  it('does not strip other characters, internal quotes or surrounding prose', () => {
    const issued = signed();
    for (const character of ['\u200c', '\u200e', '\u2061', '\u180e', '"', "'", '“', '”', '‘', '’'])
      expect(() =>
        readLicenseKey(
          issued.text.slice(0, 24) + character + issued.text.slice(24),
          issued.pair.publicKey,
        ),
      ).toThrow(expect.objectContaining({ problem: 'format' }));
    for (const text of [
      `Here is your key: ${issued.text}`,
      `${issued.text}.`,
      `\`${issued.text}\``,
      `"${issued.text}’`,
      `${issued.text} ${issued.text}`,
    ])
      expect(() => readLicenseKey(text, issued.pair.publicKey)).toThrow(
        expect.objectContaining({ problem: 'format' }),
      );
  });

  it.each([
    'müller@example.de',
    'buyer@bücher.example',
    'buyer@example.xn--p1ai',
    'a&b@example.com',
    'first/last@example.com',
    'signed identity without an address pattern',
  ])('keeps signed email text valid without applying an address pattern: %s', (email) => {
    const value = { ...payload(), email };
    const issued = signed(value);
    expect(readLicenseKey(issued.text, issued.pair.publicKey)).toEqual(value);
  });

  it('refuses tampered and foreign keys before parsing their payload', () => {
    const issued = signed();
    const key = feedPublicKey(issued.pair.embedded);
    const parts = issued.text.split('.');
    parts[1] = Buffer.from(issued.bytes.toString().replace('viewer', 'foreign')).toString(
      'base64url',
    );
    for (const text of [parts.join('.'), signed().text])
      expect(() => readLicenseKey(text, key)).toThrow(
        expect.objectContaining({ problem: 'signature' }),
      );
  });

  it('refuses truncated, padded, oversized and malformed keys', () => {
    const issued = signed();
    const key = feedPublicKey(issued.pair.embedded);
    for (const text of [
      '',
      'not a key',
      issued.text.slice(0, -1),
      issued.text + '=',
      issued.text.replace('viewer-license-1', 'viewer-license-2'),
      issued.text + ' '.repeat(4096),
      'viewer-license-1.a.' + 'a'.repeat(86),
    ])
      expect(() => readLicenseKey(text, key)).toThrow(
        expect.objectContaining({ problem: 'format' }),
      );
  });

  it('refuses correctly signed payloads for another product or with invalid fields', () => {
    const value = payload();
    for (const invalid of [
      { ...value, product: 'another-product' },
      { ...value, email: '' },
      { ...value, email: 'x'.repeat(321) },
      { ...value, order: '' },
      { ...value, issued: '2026-02-30' },
      { ...value, issued: '2026-1-1' },
      null,
    ]) {
      const issued = signed(invalid);
      expect(() => readLicenseKey(issued.text, issued.pair.publicKey)).toThrow(
        expect.objectContaining({ problem: 'invalid' }),
      );
    }
    const pair = keys();
    for (const bytes of [Buffer.from('{'), Buffer.from([0xff])]) {
      const text = `viewer-license-1.${bytes.toString('base64url')}.${sign(null, bytes, pair.privateKey).toString('base64url')}`;
      expect(() => readLicenseKey(text, pair.publicKey)).toThrow(
        expect.objectContaining({ problem: 'invalid' }),
      );
    }
    expect(() => feedPublicKey('invalid', 'license public key')).toThrow('license public key');
  });
});

describe('trial arithmetic', () => {
  it.each([
    [0, 30],
    [day - 1, 30],
    [day, 29],
    [29 * day, 1],
    [30 * day - 1, 1],
    [30 * day, 0],
    [365 * day, 0],
    [-day, 29],
  ])('counts elapsed time %s without extending the %s-day boundary', (elapsed, remaining) => {
    const trial = advanceTrial(undefined, started);
    expect(trialDays).toBe(30);
    expect(trialStatus(trial, started + elapsed)).toEqual(
      remaining ? { kind: 'trial', daysLeft: remaining } : { kind: 'trial-ended' },
    );
  });

  it('retains the earliest start and latest clock, including after a forward jump', () => {
    const original = advanceTrial(undefined, started);
    const later = advanceTrial(original, started + 12 * day);
    const back = advanceTrial(later, started - day);
    expect(back).toEqual({ started: started - day, seen: started + 12 * day });
    expect(trialStatus(back, started)).toEqual({ kind: 'trial', daysLeft: 17 });
    const forward = advanceTrial(back, started + 60 * day);
    expect(trialStatus(advanceTrial(forward, started), started)).toEqual({ kind: 'trial-ended' });
  });

  it.each([
    { name: 'a future first launch', times: [started + 3650 * day, started], daysLeft: [30, 0] },
    { name: 'a past first launch', times: [started - 3650 * day, started], daysLeft: [30, 0] },
    {
      name: 'a rollback after launch',
      times: [started, started - day, started],
      daysLeft: [30, 29, 29],
    },
    { name: 'a forward jump', times: [started, started + 31 * day, started], daysLeft: [30, 0, 0] },
  ])('only shortens the trial across launches after $name', async ({ times, daysLeft }) => {
    const f = await fixture();
    for (const [index, now] of times.entries()) {
      const license = new License(f.file, { ...f.host, now: () => now });
      expect(await license.status()).toEqual(
        daysLeft[index] ? { kind: 'trial', daysLeft: daysLeft[index] } : { kind: 'trial-ended' },
      );
      const observed = times.slice(0, index + 1);
      expect(JSON.parse(await readFile(f.file, 'utf8')).trial).toEqual({
        started: Math.min(...observed),
        seen: Math.max(...observed),
      });
    }
  });

  it('uses plain About lines', () => {
    const email = payload().email;
    expect(licenseLine({ kind: 'licensed', email })).toBe(`Licensed to ${email}`);
    expect(licenseLine({ kind: 'trial', daysLeft: 30 })).toBe('Trial: 30 days left');
    expect(licenseLine({ kind: 'trial', daysLeft: 1 })).toBe('Trial: 1 day left');
    expect(licenseLine({ kind: 'trial-ended' })).toBe('Trial ended');
    expect(licenseLine(undefined)).toBeUndefined();
  });
});

describe('the local license record', () => {
  it('ships either no license configuration or a valid key and https purchase address', () => {
    expect(() => licenseEndpoint(licenseConfiguration)).not.toThrow();
  });
  it('starts on first launch, survives new service instances, and starts anew in another data folder', async () => {
    let now = started;
    const f = await fixture({ now: () => now });
    expect(await f.license.status()).toEqual({ kind: 'trial', daysLeft: 30 });
    expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual({
      version: 1,
      trial: { started, seen: started },
    });
    expect((await stat(f.file)).mode & 0o777).toBe(0o600);
    now += 29 * day;
    const reopened = new License(f.file, f.host);
    expect(await reopened.status()).toEqual({ kind: 'trial', daysLeft: 1 });
    now = started;
    expect(await new License(f.file, f.host).status()).toEqual({ kind: 'trial', daysLeft: 1 });
    now += 31 * day;
    expect(await reopened.status()).toEqual({ kind: 'trial-ended' });
    now = started;
    expect(await new License(f.file, f.host).status()).toEqual({ kind: 'trial-ended' });
    const fresh = await fixture();
    expect(await fresh.license.status()).toEqual({ kind: 'trial', daysLeft: 30 });
  });

  it('reads status without writing until the saved clock advances by an hour', async () => {
    let now = started;
    const f = await fixture({ now: () => now });
    const writes = vi.spyOn(DocumentStore.prototype, 'save');
    await f.license.status();
    expect(writes).toHaveBeenCalledTimes(1);
    const bytes = await readFile(f.file, 'utf8');
    for (const elapsed of [0, 1, 1000, 60_000, 30 * 60_000, 60 * 60_000 - 1]) {
      now = started + elapsed;
      expect(await f.license.status()).toEqual({ kind: 'trial', daysLeft: 30 });
    }
    await new License(f.file, f.host).status();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(await readFile(f.file, 'utf8')).toBe(bytes);
    now = started + 60 * 60_000;
    await f.license.status();
    expect(writes).toHaveBeenCalledTimes(2);
    expect(JSON.parse(await readFile(f.file, 'utf8')).trial).toEqual({ started, seen: now });
  });

  it.each([day, 30 * day])(
    'saves an observable status change at %s even before an hour',
    async (elapsed) => {
      let now = started + elapsed - 1;
      const f = await fixture({ now: () => now });
      await writeFile(f.file, JSON.stringify({ version: 1, trial: { started, seen: now } }));
      const writes = vi.spyOn(DocumentStore.prototype, 'save');
      await f.license.status();
      expect(writes).not.toHaveBeenCalled();
      now += 1;
      expect(await f.license.status()).toEqual(
        elapsed === day ? { kind: 'trial', daysLeft: 29 } : { kind: 'trial-ended' },
      );
      expect(writes).toHaveBeenCalledTimes(1);
      expect(JSON.parse(await readFile(f.file, 'utf8')).trial.seen).toBe(now);
    },
  );

  it('does not rewrite licensed reads, the same key, repeated removal or reminder dismissal', async () => {
    let now = started;
    const f = await fixture({ now: () => now });
    const key = signed(payload(), f.pair).text;
    await f.license.enter(key);
    const writes = vi.spyOn(DocumentStore.prototype, 'save');
    now += 1000;
    await f.license.status();
    await f.license.enter(key);
    expect(writes).not.toHaveBeenCalled();
    now = started + 60 * 60_000;
    await f.license.status();
    expect(writes).toHaveBeenCalledTimes(1);
    await f.license.remove();
    expect(writes).toHaveBeenCalledTimes(2);
    await f.license.remove();
    expect(writes).toHaveBeenCalledTimes(2);
    now = started + 31 * day;
    await f.license.status();
    writes.mockClear();
    await f.license.status(true);
    await f.license.status();
    expect(writes).not.toHaveBeenCalled();
  });

  it('preserves the exact unreadable bytes before starting a fresh trial', async () => {
    const key = signed().text;
    const trial = { started, seen: started };
    for (const bad of [
      `{\n"key": "${key}",\n`,
      JSON.stringify({ version: 2, trial, key }),
      JSON.stringify({ version: 1, trial: { started: -1, seen: 0 }, key }),
    ]) {
      const f = await fixture();
      await writeFile(f.file, bad);
      expect(await f.license.status()).toEqual({ kind: 'trial', daysLeft: 30 });
      const kept = (await readdir(f.root)).filter((name) =>
        name.startsWith('license-v1.json.unreadable-'),
      );
      expect(kept).toHaveLength(1);
      expect(await readFile(path.join(f.root, kept[0]!), 'utf8')).toBe(bad);
      expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual({ version: 1, trial });
    }
  });

  it('preserves a record after a read permission error', async () => {
    const f = await fixture();
    const bytes = JSON.stringify({
      version: 1,
      trial: { started, seen: started },
      key: signed(payload(), f.pair).text,
    });
    await writeFile(f.file, bytes);
    await chmod(f.file, 0o000);
    expect(await f.license.status()).toEqual({ kind: 'trial', daysLeft: 30 });
    const kept = (await readdir(f.root)).filter((name) =>
      name.startsWith('license-v1.json.unreadable-'),
    );
    expect(kept).toHaveLength(1);
    await chmod(path.join(f.root, kept[0]!), 0o600);
    expect(await readFile(path.join(f.root, kept[0]!), 'utf8')).toBe(bytes);
  });

  it('refuses writes when the unreadable original cannot be preserved', async () => {
    const f = await fixture();
    const bytes = JSON.stringify({ version: 2, key: signed(payload(), f.pair).text });
    await writeFile(f.file, bytes);
    await chmod(f.root, 0o500);
    try {
      expect(await f.license.status()).toEqual({ kind: 'trial', daysLeft: 30 });
    } finally {
      await chmod(f.root, 0o700);
    }
    await expect(f.license.enter(signed(payload(), f.pair).text)).rejects.toThrow('preserved');
    await expect(f.license.remove()).rejects.toThrow('preserved');
    expect(await readFile(f.file, 'utf8')).toBe(bytes);
    expect(await readdir(f.root)).toEqual(['license-v1.json']);
  });

  it('keeps unexpected links and directories in place', async () => {
    const linked = await fixture();
    const target = path.join(linked.root, 'retained-target.json');
    await writeFile(target, 'Retained fixture');
    await symlink(target, linked.file);
    expect(await linked.license.status()).toEqual({ kind: 'trial', daysLeft: 30 });
    expect((await lstat(linked.file)).isSymbolicLink()).toBe(true);
    expect(await readFile(target, 'utf8')).toBe('Retained fixture');
    const blocked = await fixture();
    await mkdir(blocked.file);
    const retained = path.join(blocked.file, 'restored-key.txt');
    const key = signed().text;
    await writeFile(retained, key);
    expect(await blocked.license.status()).toEqual({ kind: 'trial', daysLeft: 30 });
    expect(await readFile(retained, 'utf8')).toBe(key);
  });

  it('keeps a key this build cannot verify until explicit replacement or removal', async () => {
    const f = await fixture();
    const key = signed().text;
    const bytes = JSON.stringify({ version: 1, trial: { started, seen: started }, key });
    await writeFile(f.file, bytes);
    expect(await f.license.status()).toEqual({ kind: 'trial', daysLeft: 30 });
    expect(await readFile(f.file, 'utf8')).toBe(bytes);
    expect(await new License(f.file, f.host).status()).toEqual({ kind: 'trial', daysLeft: 30 });
    expect(await readFile(f.file, 'utf8')).toBe(bytes);
    const value = payload();
    const replacement = signed(value, f.pair).text;
    expect(await f.license.enter(replacement)).toEqual({ kind: 'licensed', email: value.email });
    expect(JSON.parse(await readFile(f.file, 'utf8')).key).toBe(replacement);
    await f.license.remove();
    expect(JSON.parse(await readFile(f.file, 'utf8')).key).toBeUndefined();
  });

  it('retains the original key across a different build and an hourly clock write', async () => {
    let now = started;
    const f = await fixture({ now: () => now });
    const value = payload();
    const key = signed(value, f.pair).text;
    await f.license.enter(key);
    const original = JSON.parse(await readFile(f.file, 'utf8'));
    now += 60 * 60_000;
    const other = new License(f.file, {
      ...f.host,
      configuration: { ...f.host.configuration, publicKey: keys().embedded },
    });
    expect(await other.status()).toEqual({ kind: 'trial', daysLeft: 30 });
    expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual({
      ...original,
      trial: { started, seen: now },
    });
    expect(await new License(f.file, f.host).status()).toEqual({
      kind: 'licensed',
      email: value.email,
    });
    expect(JSON.parse(await readFile(f.file, 'utf8')).key).toBe(key);
  });

  it('stores the verified key, rechecks it at launch, and preserves trial time on removal', async () => {
    let now = started;
    const f = await fixture({ now: () => now });
    const value = payload();
    const issued = signed(value, f.pair);
    expect(await f.license.enter(issued.text)).toEqual({ kind: 'licensed', email: value.email });
    expect(JSON.parse(await readFile(f.file, 'utf8')).key).toBe(issued.text);
    now += 31 * day;
    expect(await new License(f.file, f.host).status()).toEqual({
      kind: 'licensed',
      email: value.email,
    });
    expect(await f.license.remove()).toEqual({ kind: 'trial-ended' });
    expect(JSON.parse(await readFile(f.file, 'utf8')).key).toBeUndefined();
    expect(await new License(f.file, f.host).status()).toEqual({ kind: 'trial-ended' });
    expect(f.host.open).not.toHaveBeenCalled();
  });

  it('stores a cleaned key after accepting quoted text with copying artifacts', async () => {
    const f = await fixture();
    const value = payload();
    const issued = signed(value, f.pair);
    const copied = `“${issued.text.slice(0, 24)}\u200b\u200d\u2060\ufeff\u00ad${issued.text.slice(24)}”`;
    expect(await f.license.enter(copied)).toEqual({ kind: 'licensed', email: value.email });
    expect(JSON.parse(await readFile(f.file, 'utf8')).key).toBe(issued.text);
  });

  it('never treats a forged saved key or a paid flag as a license', async () => {
    const f = await fixture();
    await writeFile(
      f.file,
      JSON.stringify({
        version: 1,
        trial: { started: started - 31 * day, seen: started },
        key: signed().text,
        paid: true,
      }),
    );
    expect(await f.license.status()).toEqual({ kind: 'trial-ended' });
    await expect(f.license.enter(signed().text)).rejects.toMatchObject({ problem: 'signature' });
    expect(await f.license.status()).toEqual({ kind: 'trial-ended' });
  });

  it('serializes entry and removal and changes the status in every subscribed window', async () => {
    const f = await fixture();
    const value = payload();
    const entry = f.license.enter(signed(value, f.pair).text);
    const removal = f.license.remove();
    expect(await entry).toEqual({ kind: 'licensed', email: value.email });
    expect(await removal).toEqual({ kind: 'trial', daysLeft: 30 });
    expect(f.host.changed).toHaveBeenLastCalledWith({ kind: 'trial', daysLeft: 30 });
  });

  it('hides the reminder for this process only, including newly opened windows', async () => {
    let now = started;
    const f = await fixture({ now: () => now });
    await f.license.status();
    now += 31 * day;
    expect(await f.license.status(true)).toEqual({ kind: 'trial-ended', reminderHidden: true });
    expect(await f.license.status()).toEqual({ kind: 'trial-ended', reminderHidden: true });
    expect(await new License(f.file, f.host).status()).toEqual({ kind: 'trial-ended' });
    expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual({
      version: 1,
      trial: { started, seen: now },
    });
  });

  it('does no reading, writing or purchasing in the Store edition or when unconfigured', async () => {
    const pair = keys();
    for (const options of [
      { store: true },
      { configuration: { publicKey: '', purchaseURL: '' } },
      { configuration: { publicKey: pair.embedded, purchaseURL: '' } },
      { configuration: { publicKey: '', purchaseURL: 'https://purchase.example.invalid' } },
      {
        configuration: { publicKey: pair.embedded, purchaseURL: 'http://purchase.example.invalid' },
      },
      {
        configuration: {
          publicKey: pair.embedded,
          purchaseURL: 'https://user:password@purchase.example.invalid',
        },
      },
      { configuration: { publicKey: 'invalid', purchaseURL: 'https://purchase.example.invalid' } },
    ]) {
      const f = await fixture(options);
      expect(await f.license.status()).toBeUndefined();
      expect(await f.license.enter(signed().text)).toBeUndefined();
      expect(await f.license.remove()).toBeUndefined();
      await f.license.buy();
      expect(await readdir(f.root)).toEqual([]);
      expect(f.host.open).not.toHaveBeenCalled();
      expect(f.host.changed).not.toHaveBeenCalled();
      await writeFile(f.file, 'Existing unreadable record');
      expect(await f.license.status()).toBeUndefined();
      expect(await readFile(f.file, 'utf8')).toBe('Existing unreadable record');
    }
  });

  it('opens only the configured https purchase page and only on request', async () => {
    const f = await fixture();
    await f.license.status();
    expect(f.host.open).not.toHaveBeenCalled();
    await f.license.buy();
    expect(f.host.open).toHaveBeenCalledExactlyOnceWith('https://purchase.example.invalid/viewer');
  });
});
