/**
 * Internet shortcuts name an address. Viewer reads it and never loads it; Open hands only web and
 * email addresses to the person's apps, and the desktop service checks the scheme again.
 */
import { describe, expect, it, vi } from 'vitest';
import { linkAddress, readShortcut, shortcutFacts } from '../src/domain/previews/data/shortcuts';
import { binaryWebloc } from '../tools/playground/samples/inspection';

const opened = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('electron', () => ({
  shell: { openExternal: opened, openPath: vi.fn(), showItemInFolder: vi.fn() },
}));
const { createFileHandlers } = await import('../src/desktop/ipc/file-handlers');

const text = (value: string) => new TextEncoder().encode(value);

describe('reading shortcuts', () => {
  it('reads a Windows shortcut’s InternetShortcut section, and a BASEURL without one', () => {
    const shortcut = readShortcut(
      text(
        '[{000214A0-0000-0000-C000-000000000046}]\r\nProp3=19,2\r\n[InternetShortcut]\r\nIDList=\r\nURL=https://example.org/a?b=c\r\n',
      ),
      'url',
    );
    expect(shortcut).toEqual({
      url: 'https://example.org/a?b=c',
      host: 'example.org',
      scheme: 'https',
      refusal: undefined,
    });
    expect(readShortcut(text('[DEFAULT]\nBASEURL=http://example.com/\n'), 'url').url).toBe(
      'http://example.com/',
    );
    const wide = new Uint8Array(
      Buffer.from('﻿[InternetShortcut]\r\nURL=https://example.net/\r\n', 'utf16le'),
    );
    expect(readShortcut(wide, 'url').host).toBe('example.net');
  });

  it('reads a web location as an XML or a binary property list', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>URL</key><string>https://www.example.com/x</string></dict></plist>`;
    expect(readShortcut(text(xml), 'webloc').host).toBe('www.example.com');
    const mail = readShortcut(new Uint8Array(binaryWebloc('mailto:samples@example.com')), 'webloc');
    expect(mail).toMatchObject({ scheme: 'mailto', host: 'samples@example.com' });
    expect(mail.refusal).toBeUndefined();
  });

  it('says what it cannot read', () => {
    expect(() => readShortcut(new Uint8Array(), 'webloc')).toThrow('resource fork');
    expect(() => readShortcut(text('[InternetShortcut]\nIconIndex=0\n'), 'url')).toThrow(
      'names no address',
    );
    expect(() => readShortcut(new Uint8Array(70 * 1024), 'url')).toThrow('too large');
  });

  it('shows an international host as the browser would address it', () => {
    expect(shortcutFacts('https://bücher.example/').host).toBe('xn--bcher-kva.example');
  });
});

describe('opening an address', () => {
  it.each(['https://example.org/', 'http://example.com:8080/a', 'mailto:someone@example.com'])(
    'opens %s',
    (address) => {
      expect(linkAddress(address)).toBe(new URL(address).href);
      expect(shortcutFacts(address).refusal).toBeUndefined();
    },
  );

  it.each([
    ['javascript:alert(1)', 'not javascript addresses'],
    ['file:///Applications/Calculator.app', 'not file addresses'],
    ['ftp://files.example.net/', 'not ftp addresses'],
    ['data:text/html,<p>hi</p>', 'not data addresses'],
    ['vnc://example.com', 'not vnc addresses'],
    ['https://user:secret@example.com/', 'user name or password'],
    ['not an address', 'not a valid address'],
  ])('refuses %s', (address, reason) => {
    expect(() => linkAddress(address)).toThrow(reason);
    expect(shortcutFacts(address).refusal).toContain(reason);
  });

  it('checks the address again in the desktop service before another app sees it', async () => {
    const handlers = createFileHandlers({} as never);
    await expect(handlers.openAddress(['javascript:alert(1)'], 1)).rejects.toThrow('javascript');
    await expect(handlers.openAddress(['file:///etc/hosts'], 1)).rejects.toThrow('file');
    expect(opened).not.toHaveBeenCalled();
    await handlers.openAddress(['https://example.org/viewer'], 1);
    expect(opened).toHaveBeenCalledWith('https://example.org/viewer');
  });
});
