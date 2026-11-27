// @vitest-environment jsdom
import type * as Three from 'three';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { initialize, getState, receiveSettings } from '../src/renderer/state/store';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import { fileStat } from '../src/desktop/files/stats';
import { WebPreviews } from '../src/desktop/previews/web/service';
import { webLimits } from '../src/desktop/previews/web/policy';
import { worksheetReader } from '../src/desktop/previews/office-worksheet';
import { relationships } from '../src/desktop/previews/office-package';
import { officeXML } from '../src/desktop/previews/office-xml';
import { videoDecoder } from '../src/desktop/previews/video-rendition';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import PDFPreview from '../src/renderer/previews/modules/PDFPreview';
import OfficePreview from '../src/renderer/previews/modules/OfficePreview';
import MediaPreview from '../src/renderer/previews/modules/MediaPreview';
import HTMLPreview from '../src/renderer/previews/web/HTMLPreview';
import { PreviewFrameFixture } from './support/preview-frame';

import {
  readerProblems,
  restoreReaderError,
  readerProblemFields,
} from '../src/domain/previews/reader-problem';
import { layoutFailures } from '../src/domain/previews/documents/layout';
import { restoreApiErrors } from '../src/renderer/api-boundary';
import { newModelProvider } from '../src/domain/models/providers';
import { PreviewHost } from '../src/renderer/previews/PreviewHost';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { CommandsContext } from '../src/renderer/commands/context';
import { UnknownFile } from '../src/renderer/previews/UnknownFile';
import { DelimitedTable } from '../src/renderer/previews/DataTable';
import ModelPreview from '../src/renderer/previews/modules/ModelPreview';
import FontPreview from '../src/renderer/previews/modules/FontPreview';
import ArchivePreview from '../src/renderer/previews/modules/ArchivePreview';
import CompressedPreview from '../src/renderer/previews/modules/CompressedPreview';
import EmbeddedPreview from '../src/renderer/previews/modules/EmbeddedPreview';
import EPUBPreview from '../src/renderer/previews/modules/EPUBPreview';
import MailPreview from '../src/renderer/previews/modules/MailPreview';
import DXFPreview from '../src/renderer/previews/modules/DXFPreview';
import DjVuPreview from '../src/renderer/previews/modules/DjVuPreview';
import RenderedImagePreview from '../src/renderer/previews/modules/RenderedImagePreview';
import CertificatePreview from '../src/renderer/previews/modules/CertificatePreview';
import ProvisionPreview from '../src/renderer/previews/modules/ProvisionPreview';
import TorrentPreview from '../src/renderer/previews/modules/TorrentPreview';
import TextPreview from '../src/renderer/previews/modules/TextPreview';
import SQLitePreview from '../src/renderer/previews/modules/SQLitePreview';
import ShortcutPreview from '../src/renderer/previews/modules/ShortcutPreview';
import PostScriptPreview from '../src/renderer/previews/modules/PostScriptPreview';

beforeEach(() => {
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
  vi.stubGlobal('viewer', { diagnosticReport: async () => {}, applications: async () => [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function context(extension: string, services: Partial<PreviewContext['services']>) {
  const name = 'Fixture.' + extension;
  return {
    resource: {
      id: name,
      url: '/fixture/' + name,
      entry: {
        path: '/fixture/' + name,
        parent: '/fixture',
        name,
        extension,
        size: 1024,
        mime: extension === 'ogv' ? 'video/ogg' : 'application/octet-stream',
      },
    },
    signal: new AbortController().signal,
    active: true,
    interactive: true,
    look: 'dark',
    services: {
      cancelDocument: async () => {},
      read: async () => ({ text: '', binary: false, truncated: false }),
      ...services,
    },
  } as PreviewContext;
}

function readCell() {
  const reader = worksheetReader(
    { name: 'Sheet1', rows: [], columns: 1, hidden: false, truncated: false },
    [],
    { cells: 0, characters: 0, formulas: 0, missingCached: 0, truncated: false },
    [],
  );
  reader.write(
    Buffer.from('<worksheet><sheetData><row r="1"><c r="XFE1"/></row></sheetData></worksheet>'),
  );
  reader.end();
}
function readRelationships() {
  const rel = '<Relationship Id="r1" Type="sheet" Target="sheet.xml"/>';
  relationships(officeXML(Buffer.from('<Relationships>' + rel + rel + '</Relationships>')));
}

it.each([
  ['cell outside Excel limits', readCell, 'Worksheet cell address exceeds Excel limits.'],
  [
    'duplicate relationship',
    readRelationships,
    'This Office document has damaged package relationships.',
  ],
] as const)('shows the workbook reader failure from %s', async (_case, read, expected) => {
  render(
    <OfficePreview
      {...context('xlsx', {
        document: async () => {
          read();
          throw new Error('Expected the workbook reader to refuse.');
        },
      })}
    />,
  );
  await screen.findByText("Can't show this document");
  expect(screen.getByText(expected)).toBeTruthy();
});

it('shows the HTML reader refusal for a local page one byte over the limit', async () => {
  const root = await temporaryRoot('viewer-html-card-');
  try {
    const file = path.join(root, 'large.html');
    const handle = await open(file, 'wx');
    try {
      await handle.truncate(webLimits.htmlBytes + 1);
    } finally {
      await handle.close();
    }
    const pages = new WebPreviews(async () => {});
    render(
      <HTMLPreview
        {...context('html', {
          htmlPreview: () => pages.openHtml(1, file, 'large'),
          htmlPreviewClose: async () => {},
        })}
      />,
    );
    await screen.findByRole('button', { name: 'View Source' });
    expect(screen.getByText('The asset is too large.')).toBeTruthy();
  } finally {
    await trashTemporary(root);
  }
});

it.each([
  [[], 'The compatibility copy could not be verified through its final frame.'],
  [
    [{ codec_type: 'video', codec_name: 'h264', width: 720, height: 400, nb_read_frames: '10' }],
    'A complete compatibility copy could not be verified. Open this video in its original app.',
  ],
] as const)('shows the converter refusal for final probe %j', async (streams, expected) => {
  const root = await temporaryRoot('viewer-video-card-');
  const file = path.join(root, 'input.ogv');
  const handle = await open(file, 'wx+');
  try {
    await handle.writeFile('fixture');
    const source = { file, handle, info: await fileStat(handle) };
    const facts = {
      format: { duration: '3' },
      streams: [{ codec_type: 'video', codec_name: 'theora', width: 720, height: 400 }],
    };
    const execute = vi
      .fn()
      .mockResolvedValueOnce(Buffer.from(JSON.stringify(facts)))
      .mockResolvedValueOnce(Buffer.from('copy'))
      .mockResolvedValueOnce(Buffer.from(JSON.stringify({ streams })));
    const view = render(
      <PreviewFrameFixture>
        <MediaPreview
          {...context('ogv', {
            videoRendition: async () => {
              await videoDecoder('/unused', execute)(source, 'video', new AbortController().signal);
              throw new Error('Expected the converter to refuse.');
            },
          })}
        />
      </PreviewFrameFixture>,
    );
    fireEvent.error(view.container.querySelector('video')!);
    await screen.findByText("Can't convert this video to play here");
    expect(screen.getByText(expected)).toBeTruthy();
    expect(execute).toHaveBeenCalledTimes(3);
  } finally {
    await handle.close();
    await trashTemporary(root);
  }
});

type ReaderCard = keyof typeof readerProblems;
const cases = (Object.keys(readerProblems) as ReaderCard[]).flatMap((card) =>
  readerProblems[card].map((definition) => ({
    card,
    sentence: typeof definition === 'string' ? definition : definition.example,
  })),
);

// The model still constructs its production card when the graphics driver refuses to start.
let graphicsFailure: Error;
let pdfFailure: Error;
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  PixelsPerInch: { PDF: 72, CSS: 96 },
  PasswordResponses: {},
  getDocument: () => ({ promise: Promise.reject(pdfFailure), destroy: async () => {} }),
}));
vi.mock('three', async (original) => ({
  ...(await original<typeof Three>()),
  WebGLRenderer: class {
    constructor() {
      throw graphicsFailure;
    }
  },
}));

it.each(cases)('renders the $card reader refusal "$sentence"', async ({ card, sentence }) => {
  const diagnostic = 'Internal reader detail for diagnostics.';
  const fields = readerProblemFields(new Error(sentence));
  expect(fields.readerProblem).toBe(sentence);
  const failure = restoreReaderError(diagnostic, fields);
  // As in the preload, only plain fields can cross contextBridge.
  const code = Object.entries(layoutFailures).find(([, reason]) => reason === sentence)?.[0];
  const { read } = restoreApiErrors({
    read: (): Promise<never> =>
      Promise.reject(structuredClone({ message: diagnostic, code, ...fields })),
  });
  const viewer = {
    ...window.viewer,
    resource: read,
    identifyFile: read,
    release: async () => {},
    watch: async () => {},
    unwatch: async () => {},
    onEvent: () => () => {},
  };
  vi.stubGlobal('viewer', viewer);
  const services = {
    document: read,
    archive: read,
    rendition: read,
    videoRendition: read,
    sqlite: read,
    inspectPostscript: read,
    htmlPreview: read,
    htmlPreviewClose: async () => {},
  };
  if (card === 'pdf') pdfFailure = failure;
  if (card === 'model') graphicsFailure = failure;
  if (card === 'font' || card === 'shortcut') vi.stubGlobal('fetch', read);
  if (card === 'identify') {
    const settings = structuredClone(getState().settings);
    settings.revision++;
    settings.settings.providers = [
      { ...newModelProvider('local', 'fixture'), name: 'Fixture model' },
    ];
    receiveSettings(settings);
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([0, 1])));
  }
  if (card === 'drawing' || card === 'djvu' || card === 'table') {
    vi.stubGlobal(
      'Worker',
      class {
        onmessage?: (event: MessageEvent) => void;
        postMessage(request: { id: number }) {
          const data = {
            id: request.id,
            kind: card === 'drawing' ? 'failed' : 'error',
            error: diagnostic,
            message: diagnostic,
            ...fields,
          };
          this.onmessage?.(new MessageEvent('message', { data: structuredClone(data) }));
        }
        terminate() {}
      },
    );
  }
  const views = {
    resource: () => (
      <CommandsContext value={new CommandRegistry()}>
        <PreviewHost path="/fixture/file" />
      </CommandsContext>
    ),
    image: () => <RenderedImagePreview {...context('tiff', services)} />,
    media: () => <MediaPreview {...context('ogv', services)} />,
    archive: () => <ArchivePreview {...context('zip', services)} />,
    compressed: () => <CompressedPreview {...context('gz', services)} />,
    embedded: () => <EmbeddedPreview {...context('pages', { ...services, read })} />,
    book: () => <EPUBPreview {...context('epub', services)} />,
    office: () => <OfficePreview {...context('xlsx', services)} />,
    mail: () => <MailPreview {...context('eml', services)} />,
    html: () => <HTMLPreview {...context('html', services)} />,
    pdf: () => <PDFPreview {...context('pdf', services)} />,
    djvu: () => <DjVuPreview {...context('djvu', services)} />,
    postscript: () => <PostScriptPreview {...context('ps', services)} />,
    shortcut: () => <ShortcutPreview {...context('url', services)} />,
    text: () => <TextPreview {...context('json', { ...services, read })} />,
    provision: () => <ProvisionPreview {...context('mobileprovision', services)} />,
    torrent: () => <TorrentPreview {...context('torrent', services)} />,
    keys: () => <CertificatePreview {...context('pem', services)} />,
    table: () => <DelimitedTable text="a,b" delimiter="," />,
    sqlite: () => <SQLitePreview {...context('sqlite', services)} />,
    font: () => <FontPreview {...context('ttf', services)} />,
    identify: () => <UnknownFile {...context('bin', services)} openInApp={() => {}} />,
    model: () => <ModelPreview {...context('stl', services)} />,
    drawing: () => <DXFPreview {...context('dxf', services)} />,
    layout: () => <OfficePreview {...context('docx', { ...services, officeLayout: read })} />,
  } satisfies Record<ReaderCard, () => ReactNode>;
  const view = render(<PreviewFrameFixture>{views[card]()}</PreviewFrameFixture>);
  if (card === 'media') fireEvent.error(view.container.querySelector('video')!);
  if (card === 'identify')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Fixture model' }));
  await act(async () => {});
  expect(view.container.textContent).toContain(sentence);
  expect(view.container.textContent).not.toContain(diagnostic);
});
