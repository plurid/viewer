import { generateKeyPairSync, sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
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
import * as directorySync from '../src/desktop/persistence/directory-sync';
import { DocumentStore } from '../src/desktop/persistence/document-store';

/** Generated for this run only; no signing key is kept anywhere. */
function keys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privateKey,
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

const feed: UpdateFeed = {
  version: '0.1.0-1',
  build: 600,
  notes: 'Generated release notes.\nA second line.',
  url: 'https://downloads.example.invalid/Viewer-0.1.0-1-arm64.dmg',
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
    installed: { version: '0.1.0-0', build: 584 },
    systemVersion: () => '15.1.0',
    checkAtLaunch: () => true,
    present: vi.fn(async (notice: UpdateNotice) => {
      notices.push(notice);
      return false;
    }),
    open: vi.fn(async () => {}),
    ...options,
  };
  const file = path.join(root, 'updates-v1.json');
  return { updates: new Updates(file, host), host, notices, file };
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
    const tampered = Buffer.from(release.bytes.toString().replace('600', '601'));
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
      { ...feed, version: '0.1' },
      { ...feed, version: '0.1.0' },
      { ...feed, version: '1.0.0-0' },
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
    ['14.0', '14.0', 0],
    ['14.0.1', '14.0.0', 1],
    ['14.10', '14.9', 1],
    ['14.2', '14.10', -1],
    ['14', '14.0.0', 0],
    ['13.3', '14.0', -1],
  ])('compares %s with %s', (left, right, expected) => {
    expect(compareVersions(left, right)).toBe(expected);
  });

  it('offers a newer version, or the same version with a later build', () => {
    expect(updateDecision(feed, { version: '0.1.0-0', build: 900 }, '14.0')).toBe('available');
    expect(updateDecision(feed, { version: '0.1.0-1', build: 584 }, '14.0')).toBe('available');
    expect(updateDecision(feed, { version: '0.1.0-1', build: 600 }, '14.0')).toBe('current');
    expect(updateDecision(feed, { version: '0.1.0-1', build: 601 }, '14.0')).toBe('current');
    expect(updateDecision(feed, { version: '0.1.1-0', build: 100 }, '14.0')).toBe('current');
  });

  it('does not offer updates to development runs, including a later alpha release', () => {
    expect(updateDecision(feed, { version: '0.1.0-0' }, '14.0')).toBe('current');
    expect(updateDecision(feed, { version: '0.1.0-1' }, '14.0')).toBe('current');
  });

  it('says when the newer release needs a later macOS', () => {
    expect(
      updateDecision(
        { ...feed, minimumSystemVersion: '15.2' },
        { version: '0.1.0-0', build: 584 },
        '15.1.0',
      ),
    ).toBe('unsupported-system');
  });

  it('reads the bundle build from Info.plist', () => {
    const plist =
      '<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>0.1.0-0</string>\n  <key>CFBundleVersion</key>\n  <string>812</string></dict></plist>';
    expect(bundleBuild(plistBundleVersion(plist))).toBe(812);
    expect(bundleBuild('0.1.0-0')).toBeUndefined();
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
      expect.objectContaining({ message: 'Viewer 0.1.0-1 is available', download: feed.url }),
    ]);
    expect(f.notices[0]!.detail).toContain('You have version 0.1.0-0 (584).');
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

  it('rejects a replayed signed release after restarting', async () => {
    const publisher = keys();
    let response = signed({ ...feed, version: '0.1.0-2', build: 620 }, publisher);
    const request: typeof fetch = async (url) =>
      new Response(String(url).endsWith('.sig') ? response.signature : response.bytes);
    let now = Date.UTC(2026, 10, 1);
    const f = await updates({ request, publicKey: publisher.publicKey, now: () => now });
    await f.updates.checkAtLaunch();
    expect(f.notices[0]?.message).toBe('Viewer 0.1.0-2 is available');
    response = signed({ ...feed, build: 900 }, publisher);
    now += launchCheckInterval;
    const next = new Updates(f.file, f.host);
    await expect(next.checkAtLaunch()).resolves.toMatchObject({ kind: 'failed' });
    expect(f.notices).toHaveLength(1);
    await next.checkFromMenu();
    expect(f.notices.at(-1)?.download).toBeUndefined();
    response = signed({ ...feed, version: '0.1.0-2', build: 620 }, publisher);
    now += launchCheckInterval;
    await next.checkAtLaunch();
    expect(f.notices).toHaveLength(2);
  });

  it('uses the announced build in an existing update state as its initial floor', async () => {
    const live = server();
    const f = await updates({ request: live.request, publicKey: live.publicKey });
    await writeFile(f.file, JSON.stringify({ version: 1, announced: 620 }), { flag: 'wx' });
    await f.updates.checkAtLaunch();
    expect(f.notices).toHaveLength(0);
  });
});

describe('Check for Updates', () => {
  it('requires a durable verified release, retries the write and rejects replay after restart', async () => {
    const publisher = keys();
    let response = signed({ ...feed, version: '0.1.0-2' }, publisher);
    const f = await updates({
      publicKey: publisher.publicKey,
      request: async (url) =>
        new Response(String(url).endsWith('.sig') ? response.signature : response.bytes),
    });
    const save = vi
      .spyOn(DocumentStore.prototype, 'save')
      .mockRejectedValueOnce(new Error('disk full'));
    try {
      await expect(f.updates.check()).resolves.toMatchObject({ kind: 'failed' });
      await expect(f.updates.check()).resolves.toMatchObject({ kind: 'available' });
      expect(save).toHaveBeenCalledTimes(2);
      response = signed(feed, publisher);
      await expect(new Updates(f.file, f.host).check()).resolves.toMatchObject({ kind: 'failed' });
    } finally {
      save.mockRestore();
    }
  });

  it('retries the same manual check after one failed state read', async () => {
    const f = await updates(server());
    const read = vi
      .spyOn(DocumentStore.prototype, 'loadSnapshot')
      .mockRejectedValueOnce(new Error('read failed'));
    try {
      await expect(f.updates.check()).resolves.toMatchObject({ kind: 'failed' });
      await expect(f.updates.check()).resolves.toMatchObject({ kind: 'available' });
    } finally {
      read.mockRestore();
    }
  });
  it('shows only one dialog for concurrent menu requests', async () => {
    const live = server();
    let chooseDownload!: (download: boolean) => void;
    const decision = new Promise<boolean>((resolve) => {
      chooseDownload = resolve;
    });
    const present = vi.fn(() => decision);
    const f = await updates({ ...live, present });
    const requests = [f.updates.checkFromMenu(), f.updates.checkFromMenu()];
    await vi.waitFor(() => expect(present).toHaveBeenCalled());
    chooseDownload(true);
    await Promise.all(requests);
    expect(present).toHaveBeenCalledOnce();
    expect(f.host.open).toHaveBeenCalledOnce();
  });

  it('keeps the launch check quiet after the menu already showed the same release', async () => {
    const f = await updates(server());
    await f.updates.checkFromMenu();
    await f.updates.checkAtLaunch();
    expect(f.notices).toHaveLength(1);
  });

  it('says plainly when a build has no feed, is current or could not check', async () => {
    const none = await updates({ configuration: { url: '', publicKey: '' } });
    await none.updates.checkFromMenu();
    expect(none.notices[0]?.message).toBe('Updates are not configured for this build');

    const current = server({ ...feed, version: '0.1.0-0', build: 584 });
    const latest = await updates({ request: current.request, publicKey: current.publicKey });
    await latest.updates.checkFromMenu();
    expect(latest.notices[0]).toEqual({
      message: 'Viewer is up to date',
      detail: 'Version 0.1.0-0 (584) is the latest version.',
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
    expect(updateNotice({ kind: 'store' }, { version: '0.1.0-0' }, '15.0').message).toBe(
      'The App Store keeps Viewer up to date',
    );
  });
});

it.each([
  '{bad',
  '{"version":2}',
  '{"version":1,"announcementPending":true,"announced":600}',
  '{"version":1,"announcementPending":true,"announcedVersion":"0.1.0-1"}',
])('keeps unreadable update state in place (%s)', async (original) => {
  const live = server();
  const f = await updates({ request: live.request, publicKey: live.publicKey });
  const file = f.file;
  await writeFile(file, original);
  await f.updates.checkAtLaunch();
  expect(await readFile(file, 'utf8')).toBe(original);
  expect(live.request).not.toHaveBeenCalled();
});

it('protects newer history that arrived after a manual check', async () => {
  const f = await updates(server());
  await f.updates.check();
  const newer = '{"version":2,"keep":true}';
  await writeFile(f.file, newer);
  await f.updates.checkAtLaunch();
  expect(await readFile(f.file, 'utf8')).toBe(newer);
});
it('retries a failed history read on the next manual check', async () => {
  const live = server();
  const f = await updates(live);
  await writeFile(f.file, '{');
  await f.updates.checkAtLaunch();
  await writeFile(f.file, '{"version":1}');
  await expect(f.updates.check()).resolves.toMatchObject({ kind: 'available' });
  expect(live.request).toHaveBeenCalledTimes(2);
});

it.each([false, true])(
  'keeps the verified release when history changes during a fetch (higher first: %s)',
  async (higherFirst) => {
    const live = server();
    const higher = JSON.stringify({ version: 1, verified: { version: '0.1.0-2', build: 620 } });
    const lower = JSON.stringify({ version: 1 });
    const f = await updates({
      publicKey: live.publicKey,
      request: async (...args) => {
        if (String(args[0]) === feedURL) await writeFile(f.file, higherFirst ? lower : higher);
        return live.request(...args);
      },
    });
    await writeFile(f.file, higherFirst ? higher : lower);
    await expect(f.updates.check()).resolves.toMatchObject({ kind: 'failed', problem: 'invalid' });
    expect(await readFile(f.file, 'utf8')).toBe(higherFirst ? lower : higher);
  },
);

it.each(['launch', 'menu'])(
  'shows one explicit result when the %s check starts first',
  async (first) => {
    const live = server();
    let started!: () => void, release!: () => void;
    const downloading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await updates({
      ...live,
      request: async (...args) => {
        started();
        await paused;
        return live.request(...args);
      },
    });
    await writeFile(
      f.file,
      JSON.stringify({ version: 1, announcedVersion: feed.version, announced: feed.build }),
    );
    const early = first === 'launch' ? f.updates.checkAtLaunch() : f.updates.checkFromMenu();
    await downloading;
    const late = first === 'launch' ? f.updates.checkFromMenu() : f.updates.checkAtLaunch();
    release();
    await Promise.all([early, late]);
    expect(f.notices).toHaveLength(1);
    expect(f.notices[0]?.download).toBe(feed.url);
  },
);

it.each(['verification', 'announcement'])(
  'requires durable %s through repeated directory sync failures',
  async (phase) => {
    const f = await updates(server());
    if (phase === 'verification')
      await writeFile(
        f.file,
        JSON.stringify({ version: 1, announcedVersion: feed.version, announced: feed.build }),
      );
    const sync = directorySync.syncParentDirectory;
    let attempts = 0;
    let failing = true;
    const injected = vi
      .spyOn(directorySync, 'syncParentDirectory')
      .mockImplementation(async (file) => {
        const record = JSON.parse(await readFile(file, 'utf8'));
        if (record.verified && record.announced) {
          attempts++;
          if (failing) throw new Error('Directory sync failed');
        }
        return sync(file);
      });
    try {
      for (const checker of [f.updates, f.updates, new Updates(f.file, f.host)]) {
        const before = attempts;
        await checker.checkFromMenu();
        expect(f.notices.at(-1)?.message).toBe('Viewer could not check for updates');
        expect(attempts).toBeGreaterThan(before);
        expect(JSON.parse(await readFile(f.file, 'utf8')).verified).toEqual({
          version: feed.version,
          build: feed.build,
        });
      }
      const visible = await readFile(f.file, 'utf8');
      const notices = f.notices.length;
      await f.updates.checkAtLaunch();
      expect(f.notices).toHaveLength(notices);
      expect(await readFile(f.file, 'utf8')).toBe(visible);
      failing = false;
      const before = attempts;
      await f.updates.checkFromMenu();
      expect(attempts).toBeGreaterThan(before);
      expect(f.notices.at(-1)?.download).toBe(feed.url);
    } finally {
      injected.mockRestore();
    }
  },
);

it.each(['before', 'during'])('checks for replaced history %s the pending sync', async (when) => {
  const f = await updates(server());
  const sync = directorySync.syncParentDirectory;
  const injected = vi
    .spyOn(directorySync, 'syncParentDirectory')
    .mockRejectedValueOnce(new Error('Directory sync failed'));
  try {
    await f.updates.checkFromMenu();
    expect(f.notices.at(-1)?.download).toBeUndefined();
    const replacement = JSON.stringify({
      version: 1,
      checked: 1,
      announced: feed.build,
      announcedVersion: feed.version,
      verified: { version: feed.version, build: feed.build },
    });
    if (when === 'before') await writeFile(f.file, replacement);
    else
      injected.mockImplementationOnce(async (file) => {
        await sync(file);
        await writeFile(f.file, replacement);
      });
    await f.updates.checkFromMenu();
    expect(f.notices.at(-1)?.message).toBe('Viewer could not check for updates');
    expect(await readFile(f.file, 'utf8')).toBe(replacement);
    await f.updates.checkFromMenu();
    expect(f.notices.at(-1)?.download).toBe(feed.url);
  } finally {
    injected.mockRestore();
  }
});

it.each(['launch', 'menu'])(
  'recovers an undelivered %s announcement once on a later launch',
  async (first) => {
    let now = Date.UTC(2026, 10, 1);
    const f = await updates({ ...server(), now: () => now });
    const sync = directorySync.syncParentDirectory;
    let failures = 0;
    const injected = vi
      .spyOn(directorySync, 'syncParentDirectory')
      .mockImplementation(async (file) => {
        const history = JSON.parse(await readFile(file, 'utf8'));
        if (!failures && history.verified && history.announced === feed.build) {
          failures++;
          throw new Error('Announcement directory sync failed');
        }
        return sync(file);
      });
    const offers = () => f.notices.filter((notice) => notice.download === feed.url);
    try {
      if (first === 'launch') {
        await expect(f.updates.checkAtLaunch()).resolves.toMatchObject({ kind: 'available' });
        await expect(new Updates(f.file, f.host).checkAtLaunch()).resolves.toBeUndefined();
      } else {
        await f.updates.checkFromMenu();
        expect(f.notices.at(-1)?.message).toBe('Viewer could not check for updates');
      }
      expect(failures).toBe(1);
      expect(offers()).toHaveLength(0);
      for (let day = 0; day < 2; day++) {
        now += launchCheckInterval;
        await expect(new Updates(f.file, f.host).checkAtLaunch()).resolves.toMatchObject({
          kind: 'available',
        });
        expect(offers()).toHaveLength(1);
      }
      await new Updates(f.file, f.host).checkFromMenu();
      expect(offers()).toHaveLength(2);
    } finally {
      injected.mockRestore();
    }
  },
);

it('retries an update dialog that failed to open before Later was chosen', async () => {
  let now = Date.UTC(2026, 10, 1);
  const present = vi
    .fn<UpdateHost['present']>()
    .mockRejectedValueOnce(new Error('Window closed'))
    .mockResolvedValue(false);
  const f = await updates({ ...server(), present, now: () => now });
  await expect(f.updates.checkAtLaunch()).rejects.toThrow('Window closed');
  for (let day = 0; day < 2; day++) {
    now += launchCheckInterval;
    await new Updates(f.file, f.host).checkAtLaunch();
    expect(present).toHaveBeenCalledTimes(2);
  }
  expect(f.host.open).not.toHaveBeenCalled();
});

it.each(['publication', 'sync'])(
  'keeps Download and retries recording delivery after one %s failure',
  async (phase) => {
    let now = Date.UTC(2026, 10, 1);
    const save = vi.spyOn(DocumentStore.prototype, 'save');
    const sync = vi.spyOn(directorySync, 'syncParentDirectory');
    const present = vi.fn(async () => {
      const error = new Error('Could not record the response');
      if (phase === 'publication') save.mockRejectedValueOnce(error);
      else sync.mockRejectedValueOnce(error);
      return true;
    });
    const f = await updates({ ...server(), present, now: () => now });
    try {
      await f.updates.checkAtLaunch();
      expect(f.host.open).toHaveBeenCalledExactlyOnceWith(feed.url);
      now += launchCheckInterval;
      await expect(new Updates(f.file, f.host).checkAtLaunch()).resolves.toMatchObject({
        kind: 'available',
      });
      expect(present).toHaveBeenCalledOnce();
    } finally {
      save.mockRestore();
      sync.mockRestore();
    }
  },
);

it.each([
  { version: feed.version, build: feed.build + 1 },
  { version: '0.1.0-2', build: feed.build },
])('keeps the pending notice for $version ($build) when an older dialog closes', async (next) => {
  const publisher = keys();
  let release = signed(feed, publisher);
  let later!: (download: boolean) => void;
  const olderDialog = new Promise<boolean>((resolve) => {
    later = resolve;
  });
  const present = vi
    .fn<UpdateHost['present']>()
    .mockReturnValueOnce(olderDialog)
    .mockRejectedValueOnce(new Error('Window closed'))
    .mockResolvedValue(false);
  const f = await updates({
    publicKey: publisher.publicKey,
    present,
    request: async (url) =>
      new Response(String(url).endsWith('.sig') ? release.signature : release.bytes),
  });
  const original = f.updates.checkFromMenu();
  try {
    await vi.waitFor(() => expect(present).toHaveBeenCalledOnce());
    release = signed({ ...feed, ...next }, publisher);
    await expect(new Updates(f.file, f.host).checkFromMenu()).rejects.toThrow('Window closed');
  } finally {
    later(false);
    await original;
  }
  await new Updates(f.file, f.host).checkAtLaunch();
  expect(present).toHaveBeenCalledTimes(3);
  expect(present.mock.lastCall?.[0].message).toBe('Viewer ' + next.version + ' is available');
});
