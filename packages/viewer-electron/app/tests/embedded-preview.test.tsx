// @vitest-environment jsdom
/**
 * A document shown by the picture it saved: the largest the desktop serves, said to be the saved
 * image with the document's kind and facts, or an honest absence. A `.key` file written as text
 * keeps the preview it had.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type {
  ArchiveEntry,
  ArchiveListing,
  FileEntry,
  Resource,
  ResourceRead,
} from '../src/domain/contracts';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import EmbeddedPreview from '../src/renderer/previews/modules/EmbeddedPreview';
import { choosePreview, previewModules } from '../src/renderer/previews/registry';

vi.mock('../src/renderer/ui/navigation/NativeOpenActions', () => ({
  NativeOpenActions: ({ path }: { path: string }) => <p>Open {path} in its app</p>,
}));
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const file = (name: string, directory = false): FileEntry => ({
  path: `/fixtures/${name}`,
  name,
  parent: '/fixtures',
  extension: name.split('.').pop()!.toLowerCase(),
  mime: 'application/octet-stream',
  size: 64,
  kind: directory ? 'directory' : 'file',
  directory,
  identity: name,
  modified: 1,
  created: 1,
  hidden: false,
});
const listed = (name: string, size = 100): ArchiveEntry => ({
  name,
  size,
  directory: false,
  previewable: true,
});
const child = (name: string): Resource => ({
  id: `child:${name}`,
  url: `viewer-resource://child/asset/${encodeURIComponent(name)}`,
  dimensions: { width: 640, height: 480 },
  entry: { ...file(name.split('/').pop()!), path: `/fixtures/source → ${name}` },
});

/** Services over a container's listing and member texts; a picture in `refused` fails its check. */
function fixture(
  entry: FileEntry,
  listing: ArchiveListing | Error,
  texts: Record<string, string> = {},
  refused: string[] = [],
) {
  const services = {
    archive: vi.fn(async () => {
      if (listing instanceof Error) throw listing;
      return listing;
    }),
    archiveEntry: vi.fn(async (_id: string, name: string) => {
      if (refused.includes(name))
        throw new Error('This picture is not the PNG or JPEG it is named.');
      return child(name);
    }),
    read: vi.fn(async (id: string): Promise<ResourceRead> => {
      const name = id.replace(/^child:/, '');
      if (id === 'source')
        return { text: '-----BEGIN PRIVATE KEY-----', binary: false, truncated: false };
      return { text: texts[name] ?? '', binary: false, truncated: false };
    }),
    release: vi.fn(async () => {}),
  };
  const context = {
    resource: { id: 'source', url: '', entry },
    active: true,
    interactive: true,
    signal: new AbortController().signal,
    look: 'dark',
    services,
    editImage: vi.fn(),
    optimize: vi.fn(),
  } as unknown as PreviewContext;
  return { context, services };
}
const picture = (view: ReturnType<typeof render>) =>
  waitFor(() => {
    const image = view.container.querySelector<HTMLImageElement>('.embedded-viewer img');
    expect(image).toBeTruthy();
    return image!;
  });

it('shows the largest picture a Pages document saved, said to be that, and releases it', async () => {
  const { context, services } = fixture(file('Field notes.pages'), {
    entries: [listed('preview-micro.jpg', 900), listed('preview.jpg', 64000)],
    truncated: false,
  });
  const view = render(<EmbeddedPreview {...context} />);
  expect((await picture(view)).getAttribute('src')).toBe(child('preview.jpg').url);
  expect(services.archiveEntry).toHaveBeenCalledTimes(1);
  expect(services.archiveEntry).toHaveBeenCalledWith('source', 'preview.jpg');
  // said in a caption above the picture, so a plane's header keeps one row of controls
  const caption = screen.getByText('Pages document').closest('.embedded-caption');
  expect(caption?.textContent).toContain('The image this document saved, not a live rendering');
  expect(caption?.closest('.preview-toolbar')).toBeNull();
  // the picture is no image file to edit or optimize
  expect(screen.queryByText('Image tools…')).toBeNull();
  expect(screen.queryByText('Optimize…')).toBeNull();
  view.unmount();
  expect(services.release).toHaveBeenCalledWith('child:preview.jpg');
  expect(services.release).not.toHaveBeenCalledWith('source');
});

it('reads a Krita canvas size and tries the next picture when one fails its check', async () => {
  const { context, services } = fixture(
    file('Study.kra'),
    {
      entries: [
        listed('maindoc.xml', 200),
        listed('mergedimage.png', 90000),
        listed('preview.png', 4000),
      ],
      truncated: false,
    },
    { 'maindoc.xml': '<DOC><IMAGE width="640" height="480"/></DOC>' },
    ['mergedimage.png'],
  );
  const view = render(<EmbeddedPreview {...context} />);
  expect((await picture(view)).getAttribute('src')).toBe(child('preview.png').url);
  expect(screen.getByText('Krita image · 640 × 480 canvas')).toBeTruthy();
  expect(services.archiveEntry.mock.calls.map(([, name]) => name)).toEqual([
    'maindoc.xml',
    'mergedimage.png',
    'preview.png',
  ]);
  // the member read for the canvas size is released once read
  expect(services.release).toHaveBeenCalledWith('child:maindoc.xml');
});

it('says an XPS document saved no picture, with its page count', async () => {
  const { context } = fixture(
    file('Plain.oxps'),
    {
      entries: [listed('FixedDocumentSequence.fdseq'), listed('Documents/1/FixedDocument.fdoc')],
      truncated: false,
    },
    {
      'FixedDocumentSequence.fdseq':
        '<FixedDocumentSequence><DocumentReference Source="/Documents/1/FixedDocument.fdoc"/>' +
        '</FixedDocumentSequence>',
      'Documents/1/FixedDocument.fdoc':
        '<FixedDocument><PageContent/><PageContent/></FixedDocument>',
    },
  );
  render(<EmbeddedPreview {...context} />);
  await screen.findByText('No preview image in this document');
  expect(screen.getByText('OpenXPS document · 2 pages')).toBeTruthy();
  expect(screen.getByText('Open /fixtures/Plain.oxps in its app')).toBeTruthy();
});

it('shows the picture inside an iWork package folder', async () => {
  const { context, services } = fixture(file('Report.key', true), {
    entries: [listed('QuickLook/Thumbnail.jpg')],
    truncated: false,
  });
  const view = render(<EmbeddedPreview {...context} />);
  expect((await picture(view)).getAttribute('src')).toBe(child('QuickLook/Thumbnail.jpg').url);
  expect(screen.getByText('Keynote presentation')).toBeTruthy();
  expect(services.read).not.toHaveBeenCalled();
});

it('hands a `.key` file written as text to the preview it would otherwise have', async () => {
  const entry = file('server.key');
  const next = choosePreview(
    entry,
    previewModules.filter((module) => module.id !== 'embedded'),
  );
  const load = next.load;
  next.load = async () => ({ default: () => <p>Read as text</p> });
  try {
    const { context, services } = fixture(entry, new Error('ZIP directory was not found.'));
    render(<EmbeddedPreview {...context} />);
    await screen.findByText('Read as text');
    expect(services.read).toHaveBeenCalledWith('source', 4096);
    expect(services.archiveEntry).not.toHaveBeenCalled();
  } finally {
    next.load = load;
  }
});

it('says a damaged document could not be read', async () => {
  const { context, services } = fixture(
    file('Broken.pages'),
    new Error('ZIP directory was not found.'),
  );
  services.read.mockResolvedValue({ text: '', binary: true, truncated: false });
  render(<EmbeddedPreview {...context} />);
  await screen.findByText('This document could not be read');
  expect(screen.getByText('ZIP directory was not found.')).toBeTruthy();
});
