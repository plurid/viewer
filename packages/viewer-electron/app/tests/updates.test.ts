import { generateKeyPairSync, sign } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  bundleBuild,
  compareVersions,
  launchCheckDue,
  launchCheckInterval,
  updateDecision,
  updateFeedSchema,
} from '../src/domain/updates/feed';
import type { UpdateFeed } from '../src/domain/updates/feed';
import { feedEndpoint, feedPublicKey, readSignedFeed } from '../src/desktop/updates/signature';
import { Updates, updateNotice } from '../src/desktop/updates/updates';
import type { UpdateHost, UpdateNotice } from '../src/desktop/updates/updates';
import { plistBundleVersion } from '../src/desktop/windows/about';
import { temporaryRoot } from '../tools/temporary';

/** Generated for this run only; no signing key is kept anywhere. */
function keys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privateKey,
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

const feed: UpdateFeed = {
  version: '1.1.0',
  build: 140,
  notes: 'Generated release notes.\nA second line.',
  url: 'https://downloads.example.invalid/Viewer-1.1.0-140-arm64.dmg',
  sha256: 'a'.repeat(64),
  minimumSystemVersion: '14.0',
};

function signed(value: unknown, key = keys()) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  return { bytes, signature: sign(null, bytes, key.privateKey).toString('base64'), key };
}

const feedURL = 'https://updates.example.invalid/viewer/viewer-update.json';

/** A server for one signed feed; `routes` replaces individual responses. */
function server(value: unknown = feed, routes: Record<string, () => Response> = {}) {
  const release = signed(value);
  const request = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (routes[url]) return routes[url]();
    if (url === feedURL) return new Response(release.bytes);
    if (url === feedURL + '.sig') return new Response(release.signature + '\n');
    return new Response('Generated missing route', { status: 404 });
  });
  return { request, publicKey: release.key.publicKey };
}

async function updates(options: Partial<UpdateHost> & { publicKey?: string } = {}) {
  const root = await temporaryRoot('viewer-updates-');
  const notices: UpdateNotice[] = [];
  const host: UpdateHost = {
    configuration: { url: feedURL, publicKey: options.publicKey ?? keys().publicKey },
    store: false,
    installed: { version: '1.0.0', build: 120 },
    systemVersion: () => '15.1.0',
    checkAtLaunch: () => true,
    present: vi.fn(async (notice: UpdateNotice) => {
      notices.push(notice);
      return false;
    }),
    open: vi.fn(async () => {}),
    ...options,
  };
  return { updates: new Updates(path.join(root, 'updates-v1.json'), host), host, notices };
}

describe('the signed update feed', () => {
  it('reads a feed signed with the embedded key', () => {
    const release = signed(feed);
    expect(
      readSignedFeed(release.bytes, release.signature, feedPublicKey(release.key.publicKey)),
    ).toEqual(feed);
  });

  it('refuses tampered bytes, another key and a malformed signature', () => {
    const release = signed(feed);
    const key = feedPublicKey(release.key.publicKey);
    const tampered = Buffer.from(release.bytes.toString().replace('140', '141'));
    expect(() => readSignedFeed(tampered, release.signature, key)).toThrow(
      expect.objectContaining({ problem: 'signature' }),
    );
    expect(() =>
      readSignedFeed(release.bytes, release.signature, feedPublicKey(keys().publicKey)),
    ).toThrow(expect.objectContaining({ problem: 'signature' }));
    for (const signature of ['', 'not base64', release.signature.slice(0, 40)])
      expect(() => readSignedFeed(release.bytes, signature, key)).toThrow(
        expect.objectContaining({ problem: 'signature' }),
      );
  });

  it('refuses a correctly signed feed that is not a valid release', () => {
    for (const value of [
      { ...feed, url: 'http://downloads.example.invalid/Viewer.dmg' },
      { ...feed, url: 'https://user:secret@downloads.example.invalid/Viewer.dmg' },
      { ...feed, sha256: 'A'.repeat(64) },
      { ...feed, notes: '   ' },
      { ...feed, version: '1.1' },
      { ...feed, build: 0 },
      { ...feed, minimumSystemVersion: 'Sonoma' },
    ]) {
      const release = signed(value);
      expect(() =>
        readSignedFeed(release.bytes, release.signature, feedPublicKey(release.key.publicKey)),
      ).toThrow(expect.objectContaining({ problem: 'invalid' }));
    }
    const text = signed('not an object');
    expect(() =>
      readSignedFeed(text.bytes, text.signature, feedPublicKey(text.key.publicKey)),
    ).toThrow(expect.objectContaining({ problem: 'invalid' }));
  });

  it('accepts later fields a newer feed may add', () => {
    expect(updateFeedSchema.parse({ ...feed, published: '2026-11-01' })).toEqual(feed);
  });

  it('needs both an https address and an Ed25519 key, or neither', () => {
    expect(feedEndpoint({ url: '', publicKey: '' })).toBeUndefined();
    const { publicKey } = keys();
    expect(feedEndpoint({ url: feedURL, publicKey })?.signature.href).toBe(feedURL + '.sig');
    expect(() => feedEndpoint({ url: feedURL, publicKey: '' })).toThrow('both');
    expect(() =>
      feedEndpoint({ url: 'http://updates.example.invalid/feed.json', publicKey }),
    ).toThrow('https');
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey;
    expect(() =>
      feedEndpoint({
        url: feedURL,
        publicKey: rsa.export({ format: 'der', type: 'spki' }).toString('base64'),
      }),
    ).toThrow('Ed25519');
  });
});

describe('versions', () => {
  it.each([
    ['1.0.0', '1.0.0', 0],
    ['1.0.1', '1.0.0', 1],
    ['1.10.0', '1.9.0', 1],
    ['2.0.0', '10.0.0', -1],
    ['14', '14.0.0', 0],
    ['13.3', '14.0', -1],
  ])('compares %s with %s', (left, right, expected) => {
    expect(compareVersions(left, right)).toBe(expected);
  });

  it('offers a newer version, or the same version with a later build', () => {
    expect(updateDecision(feed, { version: '1.0.0', build: 120 }, '14.0')).toBe('available');
    expect(updateDecision(feed, { version: '1.1.0', build: 139 }, '14.0')).toBe('available');
    expect(updateDecision(feed, { version: '1.1.0', build: 140 }, '14.0')).toBe('current');
    expect(updateDecision(feed, { version: '1.2.0', build: 100 }, '14.0')).toBe('current');
    // a development run has no build, so only a newer version counts
    expect(updateDecision(feed, { version: '1.1.0' }, '14.0')).toBe('current');
  });

  it('says when the newer release needs a later macOS', () => {
    expect(
      updateDecision({ ...feed, minimumSystemVersion: '15.2' }, { version: '1.0.0' }, '15.1.0'),
    ).toBe('unsupported-system');
  });

  it('reads the bundle build from Info.plist', () => {
    const plist =
      '<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>1.0.0</string>\n  <key>CFBundleVersion</key>\n  <string>812</string></dict></plist>';
    expect(bundleBuild(plistBundleVersion(plist))).toBe(812);
    expect(bundleBuild('1.0.0')).toBeUndefined();
    expect(bundleBuild('0')).toBeUndefined();
    expect(bundleBuild(undefined)).toBeUndefined();
  });
});

describe('the launch check', () => {
  it('runs at most once a day', () => {
    const now = Date.UTC(2026, 10, 1);
    expect(launchCheckDue(undefined, now)).toBe(true);
    expect(launchCheckDue(now - 60 * 60 * 1000, now)).toBe(false);
    expect(launchCheckDue(now - launchCheckInterval, now)).toBe(true);
    // a clock set back makes the next one due
    expect(launchCheckDue(now + 60 * 60 * 1000, now)).toBe(true);
  });

  it('does nothing without a feed, in the Store edition, or when turned off', async () => {
    const live = server();
    for (const options of [
      { configuration: { url: '', publicKey: '' } },
      { store: true },
      { checkAtLaunch: () => false },
    ]) {
      const f = await updates({ ...options, request: live.request, publicKey: live.publicKey });
      expect(await f.updates.checkAtLaunch()).toBeUndefined();
      expect(f.host.present).not.toHaveBeenCalled();
    }
    expect(live.request).not.toHaveBeenCalled();
  });

  it('checks once a day and shows each release once', async () => {
    const live = server();
    let now = Date.UTC(2026, 10, 1);
    const f = await updates({ request: live.request, publicKey: live.publicKey, now: () => now });
    expect(await f.updates.checkAtLaunch()).toMatchObject({ kind: 'available' });
    expect(f.notices).toEqual([
      expect.objectContaining({ message: 'Viewer 1.1.0 is available', download: feed.url }),
    ]);
    expect(f.notices[0]!.detail).toContain('You have version 1.0.0 (120).');
    expect(f.notices[0]!.detail).toContain(feed.notes);
    expect(live.request).toHaveBeenCalledTimes(2);
    now += 60 * 60 * 1000;
    expect(await f.updates.checkAtLaunch()).toBeUndefined();
    expect(live.request).toHaveBeenCalledTimes(2);
    now += launchCheckInterval;
    expect(await f.updates.checkAtLaunch()).toMatchObject({ kind: 'available' });
    expect(live.request).toHaveBeenCalledTimes(4);
    expect(f.notices).toHaveLength(1);
  });

  it('never reports a network failure or a bad signature', async () => {
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Generated network failure');
    });
    const quiet = await updates({ request: offline });
    expect(await quiet.updates.checkAtLaunch()).toMatchObject({
      kind: 'failed',
      problem: 'network',
    });
    expect(quiet.host.present).not.toHaveBeenCalled();
    // signed with a key other than the embedded one
    const forged = server();
    const wrong = await updates({ request: forged.request });
    expect(await wrong.updates.checkAtLaunch()).toMatchObject({
      kind: 'failed',
      problem: 'signature',
    });
    expect(wrong.host.present).not.toHaveBeenCalled();
  });
});

describe('Check for Updates', () => {
  it('says plainly when a build has no feed, is current or could not check', async () => {
    const none = await updates({ configuration: { url: '', publicKey: '' } });
    await none.updates.checkFromMenu();
    expect(none.notices[0]?.message).toBe('Updates are not configured for this build');

    const current = server({ ...feed, version: '1.0.0', build: 120 });
    const latest = await updates({ request: current.request, publicKey: current.publicKey });
    await latest.updates.checkFromMenu();
    expect(latest.notices[0]).toEqual({
      message: 'Viewer is up to date',
      detail: 'Version 1.0.0 (120) is the latest version.',
    });

    const forged = server();
    const wrong = await updates({ request: forged.request });
    await wrong.updates.checkFromMenu();
    expect(wrong.notices[0]?.message).toBe('Viewer could not check for updates');
    expect(wrong.notices[0]?.detail).toContain('not signed by the publisher of Viewer');
    expect(wrong.host.open).not.toHaveBeenCalled();
  });

  it('opens the download only when the person chooses Download', async () => {
    const live = server();
    const f = await updates({
      request: live.request,
      publicKey: live.publicKey,
      present: vi.fn(async () => true),
    });
    await f.updates.checkFromMenu();
    expect(f.host.open).toHaveBeenCalledExactlyOnceWith(feed.url);
  });

  it('follows https redirects only', async () => {
    const moved = 'https://cdn.example.invalid/viewer-update.json';
    const release = signed(feed);
    const routes: Record<string, () => Response> = {
      [feedURL]: () => new Response(null, { status: 302, headers: { location: moved } }),
      [moved]: () => new Response(release.bytes),
      [feedURL + '.sig']: () => new Response(release.signature),
    };
    const request = vi.fn<typeof fetch>(async (input) => routes[String(input)]!());
    const followed = await updates({ request, publicKey: release.key.publicKey });
    expect(await followed.updates.check()).toMatchObject({ kind: 'available' });

    const insecure = server(feed, {
      [feedURL]: () =>
        new Response(null, { status: 302, headers: { location: 'http://cdn.example.invalid/' } }),
    });
    const refused = await updates({ request: insecure.request, publicKey: insecure.publicKey });
    expect(await refused.updates.check()).toMatchObject({ kind: 'failed', problem: 'network' });
  });

  it('refuses an oversized feed before reading it', async () => {
    const live = server(feed, {
      [feedURL]: () => new Response('x'.repeat(70 * 1024)),
    });
    const f = await updates({ request: live.request, publicKey: live.publicKey });
    expect(await f.updates.check()).toMatchObject({ kind: 'failed', problem: 'invalid' });
  });

  it('points the Store edition at the App Store', () => {
    expect(updateNotice({ kind: 'store' }, { version: '1.0.0' }, '15.0').message).toBe(
      'The App Store keeps Viewer up to date',
    );
  });
});
