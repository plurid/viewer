import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { sameSourceVersion, sourceVersion } from '../src/domain/files/inspection';
import {
  readTemporalIdentity,
  sameIdentity,
  sameTemporalIdentity,
  temporalIdentity,
} from '../src/domain/files/item-identity';
import type { IdentityKind } from '../src/domain/files/item-identity';
import type { Digest } from '../src/domain/previews/digest';
import {
  connectionID,
  displayLocation,
  hasRemoteLocationScheme,
  isRemoteLocation,
  parseRemoteLocation,
  remoteAncestry,
  remoteBaseName,
  remoteContains,
  remoteJoin,
  remoteLocation,
  remoteName,
  remoteParent,
  remotePath,
  remoteScheme,
  remoteUTF8Bytes,
} from '../src/domain/remote/location';
import {
  parseRemoteEndpoint,
  remoteConnection,
  remoteHost,
  remoteUser,
} from '../src/domain/remote/connections';
import { remoteFeatureEnabled } from '../src/domain/remote/feature';
import { remoteIdentity, remoteTimestamps } from '../src/domain/remote/identity';
import { remoteLimits } from '../src/domain/remote/limits';
import { isProtectedRemotePath, remoteSystemRoots } from '../src/domain/remote/protected';
import { remoteConnectionState } from '../src/domain/remote/status';

const digest: Digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
const ids = ['abc123', '0123456789abcdef', 'server01'];
const names = [
  'app',
  'file.txt',
  'space here',
  '100%',
  '%2e%2e',
  '%2F',
  'café',
  'e\u0301',
  '文書',
  '🦋',
  'one\\two',
  '?query#fragment',
  "a'quoted file",
  '-option',
  '\nnew line',
  '..\n',
  '.\r\n',
  ' ',
];

describe('raw server locations', () => {
  it('round trips generated paths and keeps child, parent, basename and ancestry in agreement', () => {
    for (let sample = 0; sample < 240; sample++) {
      const id = ids[sample % ids.length]!;
      const root = remoteScheme + id + '/';
      const ancestry = [root];
      const parts: string[] = [];
      let location = root;
      for (let depth = 0; depth < (sample % 6) + 1; depth++) {
        const name = names[(sample * 7 + depth * 11) % names.length]!;
        const parent = location;
        parts.push(name);
        location = remoteJoin(parent, name);
        ancestry.push(location);
        expect(parseRemoteLocation(location)).toEqual({
          connectionID: id,
          path: '/' + parts.join('/'),
        });
        expect(remoteLocation.parse(location)).toBe(location);
        expect(remoteParent(location)).toBe(parent);
        expect(remoteBaseName(location)).toBe(name);
        expect(remoteAncestry(location)).toEqual(ancestry);
        expect(remoteContains(parent, location)).toBe(true);
        expect(remoteContains(root, location)).toBe(true);
      }
      expect(remoteParent(root)).toBe(root);
      expect(remoteBaseName(root)).toBe('/');
      expect(remoteAncestry(root)).toEqual([root]);
    }
  });

  it('keeps percent escapes, Unicode, spaces, backslashes and control names literal', () => {
    for (const name of names) {
      const location = remoteJoin('viewer-sftp://abc123/', name);
      expect(parseRemoteLocation(location).path).toBe('/' + name);
      expect(remoteBaseName(location)).toBe(name);
    }
    expect(remoteJoin('viewer-sftp://abc123/', '%2e%2e')).toBe('viewer-sftp://abc123/%2e%2e');
    expect(remoteContains('viewer-sftp://abc123/a', 'viewer-sftp://abc123/a%2Fb')).toBe(false);
  });

  it('requires a lowercase six to sixteen character connection ID', () => {
    for (const id of ids) expect(connectionID.safeParse(id).success).toBe(true);
    for (const id of [
      '',
      'short',
      'a'.repeat(17),
      'ABC123',
      'abc-12',
      'abc_12',
      'abc 12',
      'éabc12',
      'abc123\n',
      'abc123\r\n',
      'abc123\u2028',
    ]) {
      expect(connectionID.safeParse(id).success, id).toBe(false);
      expect(isRemoteLocation(remoteScheme + id + '/'), id).toBe(false);
    }
  });

  it('rejects malformed locations without normalizing traversal or empty segments', () => {
    const invalid = [
      '',
      '/srv/app',
      'sftp://abc123/srv',
      'VIEWER-SFTP://abc123/srv',
      'viewer-sftp:/abc123/srv',
      'viewer-sftp://abc123',
      'viewer-sftp://abc123//',
      'viewer-sftp://abc123/srv/',
      'viewer-sftp://abc123/srv//app',
      'viewer-sftp://abc123/./app',
      'viewer-sftp://abc123/../app',
      'viewer-sftp://abc123/srv/..',
      'viewer-sftp://abc123/srv\0app',
      'viewer-sftp://abc123/\ud800',
      'viewer-sftp://abc123/\udc00',
    ];
    for (const location of invalid) {
      expect(isRemoteLocation(location), location).toBe(false);
      expect(() => parseRemoteLocation(location), location).toThrow();
      expect(() => remoteParent(location), location).toThrow();
      expect(() => remoteAncestry(location), location).toThrow();
    }
    expect(isRemoteLocation(undefined)).toBe(false);
    expect(isRemoteLocation({ path: '/srv' })).toBe(false);
  });

  it('reserves malformed and differently cased internal prefixes for local guards', () => {
    for (const location of [
      'viewer-sftp:',
      'viewer-sftp:broken',
      'viewer-sftp:/',
      'viewer-sftp://',
      'viewer-sftp://bad/path',
      'VIEWER-SFTP://abc123/path',
    ])
      expect(hasRemoteLocationScheme(location), location).toBe(true);
    for (const location of [
      '/viewer-sftp:/local',
      'sftp://host/path',
      'viewer-sftps://abc123/path',
    ])
      expect(hasRemoteLocationScheme(location), location).toBe(false);
  });

  it('enforces the whole path byte limit independently of the child name limit', () => {
    const paths = [
      '/' + ['a'.repeat(1023), 'a'.repeat(1023), 'a'.repeat(1023), 'a'.repeat(1023)].join('/'),
      '/' +
        Array<string>(4)
          .fill('é'.repeat(511) + 'a')
          .join('/'),
      '/' +
        Array<string>(4)
          .fill('🦋'.repeat(255) + 'aaa')
          .join('/'),
    ];
    for (const path of paths) {
      expect(remoteUTF8Bytes(path)).toBe(4096);
      expect(remotePath.parse(path)).toBe(path);
      expect(remoteLocation.parse(remoteScheme + 'abc123' + path)).toBe(
        remoteScheme + 'abc123' + path,
      );
      expect(remotePath.safeParse(path + 'a').success).toBe(false);
      expect(isRemoteLocation(remoteScheme + 'abc123' + path + 'a')).toBe(false);
      expect(() => remoteJoin(remoteScheme + 'abc123' + path, 'a')).toThrow();
    }
    for (const name of ['a'.repeat(1024), 'é'.repeat(512), '🦋'.repeat(256)]) {
      expect(remoteUTF8Bytes(name)).toBe(1024);
      expect(remoteName.parse(name)).toBe(name);
      expect(remoteJoin('viewer-sftp://abc123/', name)).toBe('viewer-sftp://abc123/' + name);
      expect(remoteName.safeParse(name + 'a').success).toBe(false);
      expect(() => remoteJoin('viewer-sftp://abc123/', name + 'a')).toThrow();
    }
  });

  it('rejects invalid child names and lone surrogates while permitting the replacement character', () => {
    for (const name of ['', '.', '..', 'a/b', '/absolute', 'a\0b', '\ud800', '\udc00', 'a\ud800b'])
      expect(() => remoteJoin('viewer-sftp://abc123/', name), name).toThrow();
    expect(remoteName.parse('\ufffd')).toBe('\ufffd');
    expect(remoteName.parse('\ud800\udc00')).toBe('𐀀');
  });

  it('compares inclusive containment on connection and exact POSIX path boundaries', () => {
    const root = 'viewer-sftp://abc123/srv';
    expect(remoteContains(root, root)).toBe(true);
    expect(remoteContains(root, root + '/app')).toBe(true);
    for (const file of [
      'viewer-sftp://abc123/srver',
      'viewer-sftp://abc123/Srv/app',
      'viewer-sftp://abc123/srv\\app',
      'viewer-sftp://server01/srv/app',
      'viewer-sftp://abc123/srv/../app',
      'viewer-sftp://abc123/srv//app',
      '/srv/app',
    ])
      expect(remoteContains(root, file), file).toBe(false);
    expect(remoteContains('/srv', root)).toBe(false);
    expect(remoteContains('viewer-sftp:broken', root)).toBe(false);
    expect(remoteContains('viewer-sftp://abc123/', 'viewer-sftp://server01/')).toBe(false);
  });

  it('shows a typed server path and retains local display paths', () => {
    const location = 'viewer-sftp://abc123/srv/100% done\\file';
    expect(displayLocation(location, { host: 'build-box', user: 'user' })).toBe(
      'user@build-box:/srv/100% done\\file',
    );
    expect(displayLocation(location, { host: '[2001:db8::1]' })).toBe(
      '[2001:db8::1]:/srv/100% done\\file',
    );
    expect(displayLocation('/local/file', { host: 'build-box' })).toBe('/local/file');
    expect(() => displayLocation('viewer-sftp:broken', { host: 'build-box' })).toThrow();
  });
});

describe('opaque server identities', () => {
  it('matches SHA-256 base64url prefixes and separates path, kind and connection', () => {
    const kinds: IdentityKind[] = ['file', 'directory', 'symlink', 'other'];
    const observed = new Set<string>();
    for (const id of ids) {
      for (const name of names) {
        for (const kind of kinds) {
          const path = '/' + name;
          const location = remoteScheme + id + path;
          const identity = remoteIdentity(location, kind, digest);
          const hash = createHash('sha256').update(path).digest('base64url').slice(0, 22);
          expect(identity).toBe('sftp.' + id + ':' + kind + ':' + hash);
          expect(identity.split(':').at(-1)).toMatch(/^[A-Za-z0-9_-]{22}$/);
          expect(identity.slice(0, identity.indexOf(':'))).toBe('sftp.' + id);
          expect(observed.has(identity)).toBe(false);
          observed.add(identity);
        }
      }
    }
  });

  it('works with identity equality and source versions without claiming native temporal evidence', () => {
    const identity = remoteIdentity('viewer-sftp://abc123/file', 'file', digest);
    const other = remoteIdentity('viewer-sftp://server01/file', 'file', digest);
    expect(sameIdentity(identity, identity)).toBe(true);
    expect(sameIdentity(identity, other)).toBe(false);
    expect(sameTemporalIdentity(temporalIdentity(identity), temporalIdentity(identity))).toBe(true);
    expect(sameTemporalIdentity(temporalIdentity(identity), temporalIdentity(other))).toBe(false);
    expect(readTemporalIdentity(identity)).toBeUndefined();
    const entry = { identity, kind: 'file' as const, size: 42, ...remoteTimestamps(1700000000) };
    const version = sourceVersion(entry);
    expect(sameSourceVersion(version, sourceVersion({ ...entry }))).toBe(true);
    expect(sameSourceVersion(version, sourceVersion({ ...entry, identity: other }))).toBe(false);
    expect(sameSourceVersion(version, sourceVersion({ ...entry, size: 43 }))).toBe(false);
    expect(
      sameSourceVersion(version, sourceVersion({ ...entry, modified: entry.modified + 1000 })),
    ).toBe(false);
  });

  it('never hashes malformed paths or aliases invalid Unicode to the replacement character', () => {
    for (const path of ['viewer-sftp://abc123/\ud800', 'viewer-sftp://abc123/a/../b'])
      expect(() => remoteIdentity(path, 'file', digest)).toThrow();
    const literal = remoteIdentity('viewer-sftp://abc123/%2e%2e', 'file', digest);
    const replacement = remoteIdentity('viewer-sftp://abc123/\ufffd', 'file', digest);
    expect(literal).not.toBe(replacement);
    for (const invalid of [
      '',
      'a'.repeat(63),
      'A'.repeat(64),
      'z'.repeat(64),
      'a'.repeat(64) + '\n',
    ])
      expect(() => remoteIdentity('viewer-sftp://abc123/file', 'file', () => invalid)).toThrow(
        'SHA-256',
      );
  });

  it('validates an item kind at the runtime boundary', () => {
    expect(() =>
      // @ts-expect-error Untrusted runtime values cannot add a kind to the identity format.
      remoteIdentity('viewer-sftp://abc123/file', 'file:other', digest),
    ).toThrow('item kind');
  });

  it('uses zero birthtime and converts exact SFTP seconds to milliseconds', () => {
    for (const seconds of [0, 1, 1700000000, 0xffffffff])
      expect(remoteTimestamps(seconds)).toEqual({ created: 0, modified: seconds * 1000 });
    for (const seconds of [-1, 1.5, NaN, Infinity, 0x100000000])
      expect(() => remoteTimestamps(seconds)).toThrow();
  });
});

describe('saved server records', () => {
  const base = { id: 'abc123', name: 'Build box', host: 'build-box.example' };

  it('defaults to explicit connection and an unanswered SSH configuration offer', () => {
    expect(remoteConnection.parse(base)).toEqual({
      ...base,
      autoConnect: false,
      sshConfig: 'not-asked',
    });
    for (const sshConfig of ['not-asked', 'allowed', 'declined']) {
      expect(remoteConnection.parse({ ...base, sshConfig }).sshConfig).toBe(sshConfig);
    }
  });

  it('accepts validated optional fields without reading a key or SSH configuration', () => {
    const connection = {
      ...base,
      user: 'build_user',
      port: 2222,
      jump: ['user@jump.example:22', '[2001:db8::1]:2222', 'last-host'],
      identityFile: '/Users/example/.ssh/id_ed25519',
      startPath: '/srv/app',
      autoConnect: true,
      sshConfig: 'allowed',
    };
    expect(remoteConnection.parse(connection)).toEqual(connection);
    expect(() => remoteConnection.parse({ ...base, identityFile: 'C:\\Keys\\identity' })).toThrow();
    expect(remoteConnection.parse({ ...base, name: 'Atelier é' }).name).toBe('Atelier é');
    expect(remoteConnection.parse({ ...base, name: "Build box (Team's 🌍)" }).name).toBe(
      "Build box (Team's 🌍)",
    );
    expect(parseRemoteEndpoint('build_user@[2001:db8::1]:2222')).toEqual({
      user: 'build_user',
      host: '[2001:db8::1]',
      port: 2222,
    });
  });

  it('enforces exact ASCII words and syntactically valid bracketed IPv6 hosts', () => {
    for (const word of ['host', 'host-1.example', '_host', '.host', '123', 'a_b-c.d']) {
      expect(remoteHost.safeParse(word).success).toBe(true);
      expect(remoteUser.safeParse(word).success).toBe(true);
    }
    for (const host of ['[::1]', '[2001:db8::1]', '[::ffff:192.0.2.1]'])
      expect(remoteHost.safeParse(host).success, host).toBe(true);
    for (const host of [
      '',
      '-host',
      'a b',
      'a;id',
      'a@b',
      'a/b',
      'a\\b',
      'éhost',
      'host\n',
      'host\r\n',
      '[::1]\n',
      '[:::]',
      '[not-ip]',
      '[1:2:3]',
      '[::1]:22',
      '::1',
    ]) {
      expect(remoteHost.safeParse(host).success, host).toBe(false);
      expect(remoteConnection.safeParse({ ...base, host }).success, host).toBe(false);
    }
    for (const user of ['-user', 'user@host', 'u;id', 'a b', 'é', '[::1]', 'user\n', 'user\r\n'])
      expect(remoteConnection.safeParse({ ...base, user }).success, user).toBe(false);
  });

  it('rejects extra authority, invalid ports, jump options and nonlocal identity files', () => {
    for (const fields of [
      { password: 'secret' },
      { options: '-oProxyCommand=bad' },
      { executable: '/bin/sh' },
      { autoConnect: 'false' },
      { sshConfig: true },
      { id: 'short' },
      { name: 'Bad\nname' },
      { name: 'Bad\u0085name' },
      { name: 'Bad\u2028name' },
      { name: ' ' },
      { name: 'a'.repeat(201) },
      { startPath: 'relative' },
      { startPath: '/srv/../etc' },
      { identityFile: 'relative/key' },
      { identityFile: 'viewer-sftp://abc123/key' },
      { identityFile: '/key\0file' },
      { jump: ['one', 'two', 'three', 'four'] },
      { jump: ['user@-host'] },
      { jump: ['host:0'] },
      { jump: ['host:65536'] },
      { jump: ['-oProxyCommand=bad'] },
      { jump: ['one,two'] },
      { jump: ['host\n'] },
      { jump: ['host:22\n'] },
      { jump: ['user@host:22\r\n'] },
    ])
      expect(
        remoteConnection.safeParse({ ...base, ...fields }).success,
        JSON.stringify(fields),
      ).toBe(false);
    for (const port of [0, -1, 65536, 1.5, NaN, Infinity, '22'])
      expect(remoteConnection.safeParse({ ...base, port }).success, String(port)).toBe(false);
    for (const port of [1, 22, 65535])
      expect(remoteConnection.safeParse({ ...base, port }).success, String(port)).toBe(true);
  });
});

describe('server policy', () => {
  it('keeps every architecture limit in one immutable object', () => {
    expect(remoteLimits).toMatchObject({
      connections: 8,
      channelsPerConnection: 3,
      requestsPerChannel: 64,
      readBytesPerStream: 8 * 1024 * 1024,
      packetBytes: 1024 * 1024,
      namesPerReply: 10000,
      listingEntries: 20000,
      symlinkStatsConcurrent: 16,
      symlinkStatsPerListing: 2000,
      pollFoldersPerConnection: 4,
      pollBaseMs: 5000,
      pollMaximumMs: 30000,
      pollListingTimeMultiplier: 10,
      metadataTimeoutMs: 30000,
      metadataSlowMs: 4000,
      transferStallTimeoutMs: 60000,
      sshConnectTimeoutSeconds: 15,
      sshServerAliveIntervalSeconds: 15,
      sshServerAliveCountMax: 3,
      promptTimeoutMs: 120000,
      thumbnailImageBytes: 16000000,
      thumbnailsPerConnection: 2,
      previewCacheFileBytes: 256 * 1024 * 1024,
      previewCacheTotalBytes: 1024 * 1024 * 1024,
      searchResults: 20000,
      searchVisited: 100000,
      searchTimeoutMs: 120000,
      reconnectDelayMs: [2000, 5000, 15000, 30000, 60000],
      reconnectAttempts: 10,
      idleBrowseMs: 300000,
      controlPersistSeconds: 600,
      controlPathBytes: 104,
      quitTimeoutMs: 2000,
    });
    expect(Object.isFrozen(remoteLimits)).toBe(true);
    expect(Object.isFrozen(remoteLimits.reconnectDelayMs)).toBe(true);
  });

  it('protects system and home roots while allowing ordinary children of them', () => {
    const home = '/home/person';
    for (const root of [...remoteSystemRoots, '/lib', '/lib32', '/lib64', '/libexec', home]) {
      expect(isProtectedRemotePath(root, home), root).toBe(true);
      if (root !== '/')
        expect(isProtectedRemotePath(root + '/ordinary-file', home), root).toBe(false);
    }
    expect(isProtectedRemotePath('/srv/app', home)).toBe(false);
    expect(isProtectedRemotePath('/srv/app/..', home)).toBe(true);
    expect(isProtectedRemotePath('//srv/./../etc/', home)).toBe(true);
    expect(isProtectedRemotePath('/home/person/../person/.', home)).toBe(true);
    expect(isProtectedRemotePath('/home/person2', home)).toBe(false);
  });

  it('protects both server Trash subtrees and caller-supplied resolved Trash roots', () => {
    const home = '/home/person';
    for (const root of [home + '/.local/share/Trash', home + '/.viewer-trash']) {
      for (const suffix of ['', '/files', '/info', '/files/folder/file'])
        expect(isProtectedRemotePath(root + suffix, home), root + suffix).toBe(true);
      expect(isProtectedRemotePath(root + '2/files', home)).toBe(false);
      expect(isProtectedRemotePath(root + '/files/../info', home, [])).toBe(true);
    }
    expect(isProtectedRemotePath('/data/trash/files/file', home, ['/data/./trash/'])).toBe(true);
    expect(isProtectedRemotePath('/data/trashcan/file', home, ['/data/trash'])).toBe(false);
    expect(isProtectedRemotePath('/.viewer-trash/files/file', '/')).toBe(true);
  });

  it('fails closed when protected-path inputs are invalid', () => {
    for (const path of [
      '',
      'relative',
      'viewer-sftp://abc123/srv',
      '/a\0b',
      '/\ud800',
      '/' + 'a'.repeat(4096),
    ]) {
      expect(() => isProtectedRemotePath(path, '/home/person'), path).toThrow();
      expect(() => isProtectedRemotePath('/srv', path), path).toThrow();
      expect(() => isProtectedRemotePath('/srv', '/home/person', [path]), path).toThrow();
    }
  });

  it('names every connection lifecycle state without starting one', () => {
    expect(remoteConnectionState.options).toEqual([
      'saved',
      'connecting',
      'ready',
      'slow',
      'offline',
      'reconnecting',
      'needs-sign-in',
      'host-key-changed',
      'unreachable',
      'disconnected',
    ]);
    expect(remoteConnectionState.safeParse('connected').success).toBe(false);
  });

  it('enables the feature only for an explicitly supplied VIEWER_REMOTE=1', () => {
    expect(remoteFeatureEnabled()).toBe(false);
    expect(remoteFeatureEnabled({})).toBe(false);
    expect(remoteFeatureEnabled({ VIEWER_REMOTE: '1' })).toBe(true);
    for (const value of [undefined, '', '0', 'true', 'yes', '01', ' 1', '1 '])
      expect(remoteFeatureEnabled({ VIEWER_REMOTE: value }), String(value)).toBe(false);
  });
});

describe('reviewed location bounds and errors', () => {
  it('validates deep ancestry once before constructing every prefix', () => {
    const parse = vi.spyOn(remotePath, 'safeParse');
    try {
      const location = 'viewer-sftp://abc123' + '/a'.repeat(2048);
      const ancestry = remoteAncestry(location);
      expect(ancestry).toHaveLength(2049);
      expect(ancestry[0]).toBe('viewer-sftp://abc123/');
      expect(ancestry.at(-1)).toBe(location);
      expect(parse.mock.calls.length).toBe(1);
    } finally {
      parse.mockRestore();
    }
  });
  it('rejects huge input before regex, Unicode walks or UTF-8 encoding', () => {
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    try {
      const path = '/a'.repeat(5_000_000);
      expect(() => remotePath.safeParse(path)).not.toThrow();
      expect(remotePath.safeParse(path).success).toBe(false);
      expect(isRemoteLocation('viewer-sftp://abc123' + path)).toBe(false);
      expect(remoteLocation.safeParse('viewer-sftp://abc123' + path).success).toBe(false);
      expect(encode).not.toHaveBeenCalled();
    } finally {
      encode.mockRestore();
    }
  });
  it('applies the same name byte limit to existing paths and joined children', () => {
    for (const name of ['a'.repeat(1025), 'é'.repeat(513), '🦋'.repeat(257)]) {
      expect(remotePath.safeParse('/' + name).success).toBe(false);
      expect(isRemoteLocation('viewer-sftp://abc123/' + name)).toBe(false);
      expect(() => remoteJoin('viewer-sftp://abc123/', name)).toThrow();
    }
  });
  it.each(['.', '..', 'a..b', 'host\u202e', 'host\u200b'])('refuses invalid host %s', (host) => {
    expect(remoteHost.safeParse(host).success).toBe(false);
  });
  it.each(['\u202e', '\u200b', '\u2066', '\u00ad', '\u034f', '\ufe0f'])(
    'refuses invisible prompt label characters %s',
    (invisible) => {
      const base = { id: 'abc123', name: 'Build', host: 'host' };
      expect(remoteConnection.safeParse({ ...base, name: 'Build' + invisible }).success).toBe(
        false,
      );
      expect(remoteUser.safeParse('user' + invisible).success).toBe(false);
      expect(remoteHost.safeParse('host' + invisible).success).toBe(false);
    },
  );
  it('gives invalid-location helpers a typed plain error', () => {
    for (const location of [
      'viewer-sftp:notes.txt',
      'viewer-sftp://bad/path',
      'viewer-sftp://abc123/a/../b',
    ]) {
      for (const work of [
        () => parseRemoteLocation(location),
        () => remoteParent(location),
        () => remoteBaseName(location),
        () => remoteAncestry(location),
        () => displayLocation(location, { host: 'host' }),
      ]) {
        let error: unknown;
        try {
          work();
        } catch (caught) {
          error = caught;
        }
        expect(error).toMatchObject({ code: 'VIEWER_REMOTE_INVALID_LOCATION' });
        expect((error as Error).name).not.toBe('ZodError');
        expect((error as Error).message).not.toMatch(/[\n\[\]{}]/);
      }
    }
  });
  it('centralizes codec, Trash, proof and resource bounds', () => {
    expect(remoteLimits).toMatchObject({
      codecStringBytes: 65536,
      codecNameBytes: 4096,
      codecExtensionPairs: 128,
      trashInfoAttempts: 1000,
      trashListItems: 4000,
      proofEntries: 10000,
      resourceGrants: 256,
    });
  });
});
