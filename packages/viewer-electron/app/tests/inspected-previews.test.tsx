// @vitest-environment jsdom
/**
 * Certificates and keys, shortcuts, torrents and provisioning profiles, as their previews show
 * them: the fields the desktop service read, never a private key's bytes, and an address only
 * handed to the person's apps when they choose Open.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { generateKeyPairSync } from 'node:crypto';
import type { FileEntry } from '../src/domain/contracts';
import type { InspectedFile } from '../src/domain/previews/inspected';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import { initialize } from '../src/renderer/state/store';
import { readInspected, readKeyFile } from '../src/desktop/previews/inspected';
import CertificatePreview from '../src/renderer/previews/modules/CertificatePreview';
import ShortcutPreview from '../src/renderer/previews/modules/ShortcutPreview';
import TorrentPreview from '../src/renderer/previews/modules/TorrentPreview';
import ProvisionPreview from '../src/renderer/previews/modules/ProvisionPreview';
import { pem } from '../tools/playground/keys';
import { inspectionSamples, sampleCertificates } from '../tools/playground/samples/inspection';
import { mockElementBox } from './support/layout';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize(): number }) => ({
    measure: () => {},
    measureElement: () => {},
    scrollToIndex: () => {},
    getTotalSize: () => count * estimateSize(),
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, 50) }, (_, index) => ({
        index,
        key: index,
        start: index * estimateSize(),
        size: estimateSize(),
      })),
  }),
}));

const samples = inspectionSamples();
const sampleBytes = (suffix: string) =>
  new Uint8Array(Buffer.from(samples.find((sample) => sample.path.endsWith(suffix))!.bytes));
const chain = sampleCertificates();
const viewer = { openAddress: vi.fn(async () => {}), save: vi.fn(async () => {}) };
let served = new Uint8Array();
const fetched = vi.fn(async (_url: string, init?: RequestInit) => {
  const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get('range') ?? '');
  return new Response(range ? served.slice(Number(range[1]), Number(range[2]) + 1) : served);
});

/** A preview of `name`, whose document read gives `inspected` and whose text read gives `text`. */
function preview(name: string, inspected?: InspectedFile, text = '') {
  const values = new Map<string, unknown>();
  const entry = {
    path: `/fixtures/${name}`,
    name,
    parent: '/fixtures',
    extension: name.split('.').pop()!,
    mime: 'application/octet-stream',
    size: served.length || 1024,
    kind: 'file',
    directory: false,
    identity: '1:1',
    modified: 1,
    created: 1,
    hidden: false,
  } as FileEntry;
  const read = vi.fn(async () => ({ text, binary: false, truncated: false }));
  const showHex = vi.fn();
  const context = {
    resource: { id: 'resource', entry, url: `viewer-resource://resource/asset/${name}` },
    active: true,
    interactive: true,
    look: 'dark',
    signal: new AbortController().signal,
    state: {
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => values.set(key, value),
    },
    showHex,
    services: {
      read,
      document: vi.fn(async () => ({
        path: entry.path,
        metadata: {},
        evidence: [],
        text: '',
        truncated: false,
        inspected,
      })),
    },
  } as unknown as PreviewContext;
  return { context, read, showHex };
}

beforeAll(() => {
  initialize({ home: '/fixtures', platform: 'darwin', locations: [], state: null, openPaths: [] });
  mockElementBox(800, 800);
});
beforeEach(() => {
  Object.assign(window, { viewer });
  vi.stubGlobal('fetch', fetched);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  served = new Uint8Array();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  viewer.openAddress.mockClear();
  fetched.mockClear();
});

describe('certificates and keys', () => {
  it('shows each certificate’s fields and the chain they form', async () => {
    const text =
      pem('CERTIFICATE', chain.server) +
      pem('CERTIFICATE', chain.intermediate) +
      pem('CERTIFICATE', chain.root);
    const { context, showHex } = preview(
      'Sample chain.pem',
      readKeyFile(new TextEncoder().encode(text)),
      text,
    );
    const view = render(<CertificatePreview {...context} />);
    const server = await view.findByRole('article', { name: 'viewer.example' });
    expect(server.textContent).toContain('DNS:www.viewer.example');
    expect(server.textContent).toContain('EC P-256');
    expect(server.textContent).toContain('Server authentication');
    expect(server.textContent).toMatch(/SHA-256([0-9A-F]{2}:){31}[0-9A-F]{2}/);
    const root = view.getByRole('article', { name: 'Viewer Sample Root CA' });
    expect(root.textContent).toContain('Certificate authority');
    expect(root.textContent).toContain('Self-signed');
    const links = view.getByRole('region', { name: 'Certificate chain' }).querySelectorAll('li');
    expect([...links].map((item) => item.textContent)).toEqual([
      'viewer.example',
      'Viewer Sample Intermediate CA',
      'Viewer Sample Root CA',
    ]);
    expect(view.getByText('3 certificates')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Show as hex' }));
    expect(showHex).toHaveBeenCalledOnce();
    fireEvent.click(view.getByRole('button', { name: 'Source' }));
    expect(await view.findAllByText('-----BEGIN CERTIFICATE-----')).toHaveLength(3);
  });

  it('calls out an expired certificate', async () => {
    const { context } = preview('Expired sample.cer', readKeyFile(new Uint8Array(chain.expired)));
    const view = render(<CertificatePreview {...context} />);
    const card = await view.findByRole('article', { name: 'expired.viewer.example' });
    expect(card.textContent).toContain('Expired');
    expect(card.textContent).toMatch(/Expired on .*2021/);
  });

  it('shows a private key by its type and size, offering neither its source nor its bytes', async () => {
    const key = generateKeyPairSync('ec', { namedCurve: 'P-384' })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    const text = pem('CERTIFICATE', chain.server) + key;
    const { context, read } = preview(
      'server.key',
      readKeyFile(new TextEncoder().encode(text)),
      text,
    );
    const view = render(<CertificatePreview {...context} />);
    const card = await view.findByRole('article', { name: 'Private key' });
    expect(card.textContent).toContain(
      'This file holds a private key. Viewer shows only its type and size.',
    );
    expect(card.textContent).toContain('EC P-384');
    expect(card.textContent).toContain('384 bits');
    expect(view.queryByRole('button', { name: 'Source' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Show as hex' })).toBeNull();
    const body = key.split('\n').slice(1, -2).join('');
    for (const piece of body.match(/.{16}/g)!)
      expect(view.container.textContent).not.toContain(piece);
    expect(read).not.toHaveBeenCalled();
  });

  it('shows a file of text without PEM as text', async () => {
    const line = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGVsZXBoYW50 someone@example.com';
    const { context } = preview(
      'id_ed25519.pub',
      readKeyFile(new TextEncoder().encode(line)),
      line,
    );
    const view = render(<CertificatePreview {...context} />);
    expect(await view.findByText(line)).toBeTruthy();
  });
});

describe('Internet shortcuts', () => {
  it('shows the address and host, and opens it only when asked, without loading it', async () => {
    served = sampleBytes('Viewer guide.url');
    const { context } = preview('Viewer guide.url');
    const view = render(<ShortcutPreview {...context} />);
    expect(await view.findByText('https://example.org/viewer/guide?topic=previews')).toBeTruthy();
    expect(view.getByRole('heading', { name: 'example.org' })).toBeTruthy();
    expect(viewer.openAddress).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Open in Browser' }));
    expect(viewer.openAddress).toHaveBeenCalledWith(
      'https://example.org/viewer/guide?topic=previews',
    );
    for (const [url] of fetched.mock.calls) expect(url).toBe(context.resource.url);
  });

  it('opens an email address in the mail app, from a binary web location', async () => {
    served = sampleBytes('Write to samples.webloc');
    const { context } = preview('Write to samples.webloc');
    const view = render(<ShortcutPreview {...context} />);
    fireEvent.click(await view.findByRole('button', { name: 'Open in Mail App' }));
    expect(viewer.openAddress).toHaveBeenCalledWith('mailto:samples@example.com?subject=Viewer');
    expect(view.queryByRole('button', { name: 'Source' })).toBeNull();
  });

  it('offers no Open for another scheme, and says why', async () => {
    served = sampleBytes('File server.url');
    const { context } = preview('File server.url');
    const view = render(<ShortcutPreview {...context} />);
    expect(
      await view.findByText('Viewer opens web and email addresses only, not ftp addresses.'),
    ).toBeTruthy();
    expect(view.queryByRole('button', { name: /^Open in/ })).toBeNull();
  });
});

describe('torrents and profiles', () => {
  it('shows a torrent’s name, size, trackers, info-hash and its files', async () => {
    const torrent = readInspected('torrent', sampleBytes('Viewer sample.torrent'));
    const { context } = preview('Viewer sample.torrent', torrent);
    const view = render(<TorrentPreview {...context} />);
    const card = await view.findByRole('article', { name: 'Torrent' });
    expect(card.textContent).toContain('Viewer sample');
    expect(card.textContent).toContain('udp://tracker.viewer.example:6969/announce');
    expect(card.textContent).toContain(torrent.kind === 'torrent' ? torrent.infoHash : '');
    expect(view.getByText('241 files', { exact: false })).toBeTruthy();
    const files = view.getByRole('list', { name: 'Files' });
    expect(files.textContent).toContain('README.txt');
    expect(files.textContent).toContain('notes/part-001.txt');
  });

  it('shows a profile’s app, team, devices, entitlements and certificates, unchecked', async () => {
    const profile = readInspected('provision', sampleBytes('.mobileprovision'));
    const { context } = preview('Sample development.mobileprovision', profile);
    const view = render(<ProvisionPreview {...context} />);
    expect(await view.findByText('Viewer does not check this profile’s signature.')).toBeTruthy();
    const card = view.getByRole('article', { name: 'Profile' });
    expect(card.textContent).toContain('EXAMPLE123.com.example.viewer-sample');
    expect(card.textContent).toContain('Viewer Playground (EXAMPLE123)');
    expect(card.textContent).toContain('Development, on the listed devices');
    expect(view.getByRole('article', { name: 'Entitlements' }).textContent).toContain(
      'get-task-allow',
    );
    expect(view.getByText('Development: Viewer Sample (EXAMPLE123)')).toBeTruthy();
  });

  it('says what it could not read', async () => {
    const { context } = preview('Broken.torrent');
    (context.services.document as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('The torrent file is not valid bencode.'),
    );
    const view = render(<TorrentPreview {...context} />);
    await waitFor(() =>
      expect(view.getByText('The torrent file is not valid bencode.')).toBeTruthy(),
    );
  });

  it('names its read limit in the decimal units sizes are shown in', async () => {
    const torrent = preview('Large.torrent');
    torrent.context.resource.entry.size = 16_000_001;
    const large = render(<TorrentPreview {...torrent.context} />);
    expect(await large.findByText('Viewer reads files of this kind up to 16 MB.')).toBeTruthy();
    cleanup();
    const profile = preview('Large.mobileprovision');
    profile.context.resource.entry.size = 4_000_001;
    const view = render(<ProvisionPreview {...profile.context} />);
    expect(await view.findByText('Viewer reads files of this kind up to 4 MB.')).toBeTruthy();
    expect(profile.context.services.document).not.toHaveBeenCalled();
  });
});
