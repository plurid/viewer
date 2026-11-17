import { describe, expect, it, vi } from 'vitest';
import { remoteConnectionName } from '../src/domain/remote/connections';
import { parseRemoteAddress } from '../src/domain/remote/address';
import { remoteLimits } from '../src/domain/remote/limits';
import { FileAccess } from '../src/desktop/files/file-access';
import { createPasteboardHandlers } from '../src/desktop/ipc/pasteboard-handlers';

vi.mock('electron', () => ({ app: {}, shell: {} }));

describe('connection labels with visible emoji', () => {
  it.each(['Mac mini 🖥️', 'Home ❤️', 'Dev 👩‍💻', 'Text ☀︎', 'Flag 🏴\u{e0067}\u{e0062}\u{e007f}'])(
    'keeps %s',
    (name) => expect(remoteConnectionName.parse(name)).toBe(name),
  );
  it.each([
    'a️',
    '️',
    'a‍b',
    '👩‍x',
    'x‍👩',
    'a\u{e0020}',
    '🏴\u{e0067}',
    'x\u202e',
    'a\u200b',
    'a\u00ad',
    'a\u034f',
    'a\u2060',
  ])('refuses invisible sequence %s', (name) =>
    expect(remoteConnectionName.safeParse(name).success).toBe(false),
  );
});

describe('address follow-ups', () => {
  it.each(['https', 'smb', 'webdav', 'davs', 'ssh', 'sftp'])(
    'refuses decoded credentials and invisible users in %s',
    (scheme) => {
      expect(() => parseRemoteAddress(scheme + '://user%3Asecret@host/files')).toThrow(
        'Viewer does not keep passwords',
      );
      expect(() => parseRemoteAddress(scheme + '://us%E2%80%8Ber@host/files')).toThrow('invisible');
      const provider = ['ssh', 'sftp'].includes(scheme)
        ? 'Viewer asks for the password when it connects'
        : 'macOS asks for the password';
      expect(() => parseRemoteAddress(scheme + '://user:secret@host/files')).toThrow(provider);
    },
  );
  it('explains path and address length limits', () => {
    expect(() => parseRemoteAddress('host:/' + 'a/'.repeat(2050) + 'a')).toThrow('too long');
    expect(() => parseRemoteAddress('a'.repeat(remoteLimits.addressCharacters + 1))).toThrow(
      'address is too long',
    );
    expect(() => parseRemoteAddress('FILE:/etc/passwd')).toThrow('complete server URL');
  });
});

it('refuses nonabsolute local paths with a typed plain error before pasteboard access', async () => {
  const access = new FileAccess('/fixtures');
  const readForPaste = vi.fn();
  const handlers = createPasteboardHandlers({
    pasteboard: { readForPaste } as never,
    operations: {} as never,
    isAgent: () => false,
    fileAccess: access,
    window: () => undefined,
  });
  for (const value of [
    'relative/folder',
    ' viewer-sftp://server01/path',
    '\ufeffviewer-sftp://server01/path',
  ]) {
    await expect(access.require([value])).rejects.toMatchObject({
      code: 'VIEWER_INVALID_LOCAL_PATH',
      message: 'Choose an absolute local file or folder path.',
    });
    await expect(handlers.clipboardPaste([value], 1)).rejects.toMatchObject({
      code: 'VIEWER_INVALID_LOCAL_PATH',
    });
  }
  expect(readForPaste).not.toHaveBeenCalled();
});

it('keeps a variation selector in an emoji keycap', () => {
  expect(remoteConnectionName.parse('Level 1️⃣')).toBe('Level 1️⃣');
});
