import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import { choosePreview } from '../src/renderer/previews/registry';
import { nativeOpening } from '../src/renderer/explorer/opening';
import { fileFamily } from '../src/domain/files/entries';
import { documentTypes } from '../tools/document-types';

const file = (name: string, fields: Partial<FileEntry> = {}): FileEntry => ({
  path: `/fixtures/${name}`,
  name,
  parent: '/fixtures',
  extension: name.split('.').pop()!.toLowerCase(),
  mime: 'application/octet-stream',
  size: 0,
  kind: 'file',
  directory: false,
  identity: 'fixture',
  modified: 0,
  created: 0,
  hidden: false,
  ...fields,
});

describe('email, FictionBook and web archive routes', () => {
  it('opens each in its own preview, ahead of text', () => {
    const routes = {
      'Trip.eml': 'mail',
      'Trip.EMLX': 'mail',
      'Archive.mbox': 'mail',
      'Lighthouse.fb2': 'fictionbook',
      'Saved.webarchive': 'webarchive',
    };
    for (const [name, module] of Object.entries(routes)) {
      expect([name, choosePreview(file(name)).id]).toEqual([name, module]);
      expect(choosePreview(file(name, { mime: 'text/plain' })).id).toBe(module);
    }
    expect(choosePreview(file('Trip.eml', { mime: 'message/rfc822' })).id).toBe('mail');
  });

  it('browses a folder Mail exported, and does not read it as a mailbox', () => {
    expect(choosePreview(file('Inbox.mbox', { directory: true })).id).not.toBe('mail');
    expect(fileFamily(file('Inbox.mbox', { directory: true }))).toBe('folder');
  });

  it('gives email a family of its own and keeps opening it in Viewer', () => {
    for (const name of ['Trip.eml', 'Trip.emlx', 'Archive.mbox'])
      expect(fileFamily(file(name))).toBe('mail');
    const policy = { default: 'automatic' as const, types: {} };
    for (const name of ['Trip.eml', 'Archive.mbox', 'Lighthouse.fb2', 'Saved.webarchive'])
      expect([name, nativeOpening(file(name), policy)]).toEqual([name, false]);
    expect(
      nativeOpening(file('Trip.eml'), { default: 'automatic', types: { eml: 'native' } }),
    ).toBe(true);
  });

  it('offers Viewer in Open With for each', () => {
    const extensions = documentTypes.flatMap((type) => type.CFBundleTypeExtensions ?? []);
    expect(extensions).toEqual(expect.arrayContaining(['eml', 'emlx', 'mbox', 'fb2']));
    expect(documentTypes.flatMap((type) => type.LSItemContentTypes ?? [])).toContain(
      'com.apple.webarchive',
    );
  });
});
