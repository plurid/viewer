// @vitest-environment jsdom
/**
 * ODF templates, Publisher documents and Windows metafiles go to the Office engine, the last two as
 * drawings. `.pub` also names public keys: one written as text keeps the preview it would have.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { FileEntry, Resource, ResourceRead } from '../src/domain/contracts';
import {
  carriesThumbnail,
  officeFamily,
  type OfficeLayoutRequest,
} from '../src/domain/previews/documents/layout';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import OfficePreview from '../src/renderer/previews/modules/OfficePreview';
import { choosePreview, previewModules, registerPreview } from '../src/renderer/previews/registry';

vi.mock('../src/renderer/previews/modules/PDFPreview', () => ({
  default: () => <div>Rendered layout</div>,
}));
afterEach(cleanup);

function fixture(name: string, read: ResourceRead) {
  const extension = name.split('.').pop()!;
  const services = {
    read: vi.fn(async () => read),
    officeLayout: vi.fn<(id: string, request: OfficeLayoutRequest) => Promise<Resource>>(
      () => new Promise<Resource>(() => {}),
    ),
    archiveEntry: vi.fn(async () => {
      throw new Error('No picture.');
    }),
    cancelDocument: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
  };
  const context = {
    resource: { id: 'source', entry: { extension, name, path: '/fixture/' + name, mime: '' } },
    services,
    active: true,
    interactive: true,
    signal: new AbortController().signal,
    look: 'dark',
    state: { get: () => undefined, set: () => {} },
  } as unknown as PreviewContext;
  return { context, services };
}

it('lays out templates as their documents and the drawing formats as pages', () => {
  const entry = (extension: string) =>
    ({ name: 'File.' + extension, extension, mime: '', directory: false }) as FileEntry;
  const office = previewModules.find((module) => module.id === 'office')!;
  for (const [extension, family] of [
    ['ott', 'word'],
    ['ots', 'workbook'],
    ['otp', 'presentation'],
    ['pub', 'drawing'],
    ['emf', 'drawing'],
    ['wmf', 'drawing'],
  ] as const) {
    expect(office.detect(entry(extension)), extension).toBeGreaterThan(0);
    expect(officeFamily(extension), extension).toBe(family);
    // a key's preview may claim `.pub` first and hand a document on
    if (extension !== 'pub') expect(choosePreview(entry(extension)).id, extension).toBe('office');
  }
  // a packaged template carries the picture of its first page, as its document does
  for (const extension of ['ott', 'ots', 'otp']) expect(carriesThumbnail(extension)).toBe(true);
  // the engine stops on most Visio files
  for (const extension of ['vsd', 'vsdx'])
    expect(choosePreview(entry(extension)).id, extension).not.toBe('office');
});

it('lays out a Publisher document and hands text on below Office, never back up', async () => {
  const below = registerPreview({
    id: 'below-fixture',
    label: 'Below',
    formats: [],
    detect: (entry) => (entry.extension === 'pub' ? 50 : 0),
    load: async () => ({ default: () => <p>Public key</p> }),
  });
  // a preview ranked above Office that handed the file on would take it back, again and again
  const above = registerPreview({
    id: 'above-fixture',
    label: 'Above',
    formats: [],
    detect: (entry) => (entry.extension === 'pub' ? 150 : 0),
    load: async () => ({ default: () => <p>Handed back</p> }),
  });
  try {
    const document = fixture('Brochure.pub', { text: '', binary: true, truncated: true });
    const view = render(<OfficePreview {...document.context} />);
    await screen.findByText('Rendering Office layout…');
    expect(document.services.officeLayout).toHaveBeenCalled();
    view.unmount();

    const key = fixture('id_ed25519.pub', {
      text: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA fixture\n',
      binary: false,
      truncated: false,
    });
    render(<OfficePreview {...key.context} />);
    await screen.findByText('Public key');
    expect(key.services.read).toHaveBeenCalledWith('source', 4096);
    expect(screen.queryByText('Handed back')).toBeNull();
    await waitFor(() => expect(key.services.officeLayout).not.toHaveBeenCalled());
  } finally {
    above();
    below();
  }
});

it('reads no bytes first for a name no other format shares', async () => {
  const { context, services } = fixture('Notes.ott', { text: '', binary: true, truncated: false });
  render(<OfficePreview {...context} />);
  await screen.findByText('Rendering Office layout…');
  expect(services.read).not.toHaveBeenCalled();
});
