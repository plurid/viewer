import { describe, expect, it } from 'vitest';
import { parseRemoteAddress } from '../src/domain/remote/address';
import type { RemoteAddress } from '../src/domain/remote/address';

describe('typed server addresses', () => {
  const addresses: [string, RemoteAddress][] = [
    ['ssh://host', { kind: 'sftp', host: 'host' }],
    ['sftp://host/', { kind: 'sftp', host: 'host', path: '/' }],
    ['SSH://user@host/srv/app', { kind: 'sftp', user: 'user', host: 'host', path: '/srv/app' }],
    [
      'sftp://build_user@host.example:2222/srv/app',
      { kind: 'sftp', user: 'build_user', host: 'host.example', port: 2222, path: '/srv/app' },
    ],
    ['ssh://host:1/', { kind: 'sftp', host: 'host', port: 1, path: '/' }],
    ['ssh://host:65535/', { kind: 'sftp', host: 'host', port: 65535, path: '/' }],
    [
      'ssh://user@[2001:db8::1]:2222/path',
      { kind: 'sftp', user: 'user', host: '[2001:db8::1]', port: 2222, path: '/path' },
    ],
    ['user@host:/srv/app', { kind: 'sftp', user: 'user', host: 'host', path: '/srv/app' }],
    ['host:/', { kind: 'sftp', host: 'host', path: '/' }],
    ['user@[::1]:/srv/app', { kind: 'sftp', user: 'user', host: '[::1]', path: '/srv/app' }],
    ['[::1]:/srv/app', { kind: 'sftp', host: '[::1]', path: '/srv/app' }],
    ['user@host', { kind: 'sftp', user: 'user', host: 'host' }],
    ['user@[::1]', { kind: 'sftp', user: 'user', host: '[::1]' }],
    ['user@host:2222', { kind: 'sftp', user: 'user', host: 'host', port: 2222 }],
    ['host:/100% ready\\file', { kind: 'sftp', host: 'host', path: '/100% ready\\file' }],
    ['host:/%2e%2e', { kind: 'sftp', host: 'host', path: '/%2e%2e' }],
    ['sftp://host/caf%C3%A9%20notes%25', { kind: 'sftp', host: 'host', path: '/café notes%' }],
    ['sftp://host/%252e%252e', { kind: 'sftp', host: 'host', path: '/%2e%2e' }],
    ['sftp://host/space here\\file', { kind: 'sftp', host: 'host', path: '/space here\\file' }],
    ['build-box', { kind: 'unknown-name', name: 'build-box' }],
    ['Build box', { kind: 'unknown-name', name: 'Build box' }],
    ['Atelier é', { kind: 'unknown-name', name: 'Atelier é' }],
    ['  build-box  ', { kind: 'unknown-name', name: 'build-box' }],
  ];
  it.each(addresses)('parses %s without creating an internal location', (input, expected) => {
    expect(parseRemoteAddress(input)).toEqual(expected);
  });

  it('resolves punctuation and endpoint-like labels only by exact known saved names', () => {
    for (const name of ["Build box (Team's 🌍)", 'Build: east', 'name@label', '-o label'])
      expect(parseRemoteAddress(name, [name])).toEqual({ kind: 'saved', name });
    expect(() =>
      parseRemoteAddress('viewer-sftp://abc123/path', ['viewer-sftp://abc123/path']),
    ).toThrow();
    expect(() => parseRemoteAddress('Build: east')).toThrow();
  });

  it.each(['smb', 'afp', 'nfs', 'ftp', 'cifs'])(
    'keeps %s shares distinct from direct SSH addresses',
    (scheme) => {
      expect(parseRemoteAddress(scheme + '://host/share')).toEqual({
        kind: 'share',
        url: scheme + '://host/share',
      });
    },
  );

  it.each([
    ['http://host/files', 'http://host/files', true],
    ['https://host/files', 'https://host/files', false],
    ['webdav://host/files', 'http://host/files', true],
    ['davs://host/files', 'https://host/files', false],
    ['WEBDAV://host:8080/files', 'http://host:8080/files', true],
    ['https://[2001:db8::1]/files', 'https://[2001:db8::1]/files', false],
  ])('parses WebDAV %s', (input, url, insecure) => {
    expect(parseRemoteAddress(input as string)).toEqual({ kind: 'webdav', url, insecure });
  });

  it.each([
    '',
    ' ',
    'viewer-sftp://abc123/srv/app',
    'VIEWER-SFTP://abc123/srv/app',
    'viewer-sftp:broken',
    'ssh://',
    'sftp:///',
    'ssh:/host/path',
    'sftp://host:',
    'ssh://user@',
    'ssh://@host',
    'user@',
    '@host',
    'host:',
    'host:relative',
    'host:2222:/path',
    'ssh://-host/path',
    'ssh://-user@host/path',
    '-user@host:/path',
    'user@-host',
    'user@höst:/path',
    'sftp://usér@host/path',
    'sftp://user:password@host/path',
    'sftp://user%40host@host/path',
    'sftp://host:0/path',
    'sftp://host:65536/path',
    'sftp://host:-22/path',
    'sftp://host:1.5/path',
    'sftp://host:22x/path',
    'sftp://host/path?query',
    'sftp://host/path#fragment',
    'sftp://host/../secret',
    'sftp://host/%2e%2e/secret',
    'sftp://host/a/%2E/secret',
    'sftp://host/path//file',
    'sftp://host/path/',
    'sftp://host/%00',
    'sftp://host/%ED%A0%80',
    'sftp://host/%FF',
    'sftp://host/%',
    'sftp://host/%2',
    'host:/../secret',
    'host:/a//b',
    'host:/a\0b',
    'host:/\ud800',
    'ssh://[:::]/path',
    'ssh://[not-ip]/path',
    'ssh://[1:2:3]/path',
    'ssh://::1/path',
    'user@[::1',
    'ssh://host;id/path',
    'user@host;id',
    'user@$(id)',
    '-oProxyCommand=anything',
    'build-box;id',
    'host\nid',
    'user@host\n',
    'sftp://host:22\r\n',
    'sftp://host\u0085',
    'host:/file\nname',
    'file:///tmp/file',
    'javascript:alert(1)',
    'unknown://host/path',
    'smb://',
    'smb:///share',
    'ftp://host:0/share',
    'http:/host/path',
    'webdav:///path',
    'https://host:65536/path',
  ])('rejects %s', (input) => {
    expect(() => parseRemoteAddress(input)).toThrow();
  });
});

describe('reviewed address validation', () => {
  const passwordMessage =
    'Viewer does not keep passwords in addresses. Enter the address without it; macOS asks for the password.';
  it.each(['http', 'https', 'webdav', 'davs', 'smb', 'afp', 'nfs', 'cifs', 'ftp', 'ssh', 'sftp'])(
    'rejects a password in %s URLs without returning or exposing it',
    (scheme) => {
      const message = ['ssh', 'sftp'].includes(scheme)
        ? passwordMessage.replace(
            'macOS asks for the password',
            'Viewer asks for the password when it connects',
          )
        : passwordMessage;
      expect(() => parseRemoteAddress(scheme + '://user:secret@host/files')).toThrow(message);
      expect(() => parseRemoteAddress(scheme + '://user:sec%72et@host/files')).toThrow(message);
    },
  );
  it.each([
    'sftp://us er@host/',
    'host:/a/../b',
    'ssh://[fe80::1%25en0]/',
    'host:/viewer-sftp://abc123/path',
    'a'.repeat(201),
  ])('gives a plain address error for %s', (input) => {
    let error: unknown;
    try {
      parseRemoteAddress(input);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).not.toBe('ZodError');
    expect((error as Error).message).not.toMatch(/[\n\[\]{}]/);
    expect((error as Error).message.length).toBeLessThan(180);
  });
  it('distinguishes unknown words from exact saved names', () => {
    expect(parseRemoteAddress('build-box')).toEqual({ kind: 'unknown-name', name: 'build-box' });
    expect(parseRemoteAddress('build-box', ['build-box'])).toEqual({
      kind: 'saved',
      name: 'build-box',
    });
  });
  it.each([
    'file',
    'javascript',
    'mailto',
    'data',
    'ftp',
    'http',
    'https',
    'smb',
    'ssh',
    'sftp',
    'webdav',
    'davs',
  ])('refuses scheme-like %s hosts without a user', (scheme) => {
    expect(() => parseRemoteAddress(scheme + ':/srv')).toThrow();
    expect(parseRemoteAddress('user@' + scheme + ':/srv')).toMatchObject({
      kind: 'sftp',
      host: scheme,
    });
  });
});

it.each(['ssh', 'sftp', 'http', 'https', 'webdav', 'davs', 'smb', 'afp', 'nfs', 'ftp', 'cifs'])(
  'refuses empty host labels in %s addresses',
  (scheme) => {
    for (const host of ['.', '..', 'a..b'])
      expect(() => parseRemoteAddress(scheme + '://' + host + '/srv')).toThrow();
  },
);
