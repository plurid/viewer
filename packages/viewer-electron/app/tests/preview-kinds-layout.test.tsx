// @vitest-environment jsdom
/**
 * EVERY PREVIEW KIND'S TOOLBAR STAYS ONE LINE (DESIGN.md, the Preview Bar Rule): the real modules, in
 * a 320 px Columns preview, where the toolbar measures itself and keeps its own "…", and in a narrow
 * plane, whose header does. jsdom lays nothing out, so widths are mocked from labels.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { useRef, useState } from 'react';
import type { ComponentType } from 'react';
import type * as ThreeModule from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import { initialize } from '../src/renderer/state/store';
import { useHeaderOverflow } from '../src/renderer/workspace/header-overflow';
import ImagePreview from '../src/renderer/previews/modules/ImagePreview';
import PDFPreview from '../src/renderer/previews/modules/PDFPreview';
import ModelPreview from '../src/renderer/previews/modules/ModelPreview';
import MediaPreview from '../src/renderer/previews/modules/MediaPreview';
import TextPreview from '../src/renderer/previews/modules/TextPreview';
import ArchivePreview from '../src/renderer/previews/modules/ArchivePreview';
import { UnknownFile } from '../src/renderer/previews/UnknownFile';
import { PreviewFrameFixture } from './support/preview-frame';

vi.mock('three', async (original) => ({
  ...(await original<typeof ThreeModule>()),
  WebGLRenderer: class {
    domElement = document.createElement('canvas');
    shadowMap = { enabled: false, type: 0 };
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
    forceContextLoss() {}
  },
}));
vi.mock('../src/renderer/previews/model/mesh', async () => {
  const THREE = await import('three');
  return {
    importMesh: vi.fn(async () => undefined),
    meshObjects: () =>
      new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6), new THREE.MeshStandardMaterial()),
  };
});
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  PixelsPerInch: { PDF_TO_CSS_UNITS: 96 / 72 },
  PasswordResponses: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 12,
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 600 * scale,
          height: 800 * scale,
          scale,
        }),
        render: () => ({ promise: Promise.resolve(), cancel() {} }),
        getTextContent: async () => ({ items: [] }),
        cleanup() {},
      }),
    }),
    async destroy() {},
  }),
  TextLayer: class {
    async render() {}
    cancel() {}
  },
}));

/** The Columns preview's narrowest toolbar, and a narrow plane's header. */
const room = 320;
const gap = 6;
const padding = 8;
const shown = (element: Element) => getComputedStyle(element).display !== 'none';

function width(element: HTMLElement): number {
  if (!shown(element)) return 0;
  const standing =
    element.matches('.preview-toolbar') && !element.closest('.plane-module-controls');
  if (standing || element.matches('.plane-controls')) return room;
  if (element.matches('.plane-heading')) return 96;
  if (element.matches('.toolbar-spacer')) return 0;
  if (element.hasAttribute('data-compact') || element.classList.contains('icon-button')) return 30;
  if (element.matches('.preview-toolbar-group, .plane-module-controls, .preview-toolbar')) {
    const children = [...element.children].filter(shown) as HTMLElement[];
    return (
      children.reduce((total, child) => total + width(child), 0) +
      gap * Math.max(0, children.length - 1)
    );
  }
  if (element.matches('input')) return 80;
  const text = Math.min(24, element.textContent?.length ?? 0);
  return element.matches('button') ? text * 7 + 20 : text * 7;
}

beforeEach(() => {
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      onEvent: () => () => {},
      applications: vi.fn(async () => []),
    },
  });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array([0, 3, 9, 2, 0, 1]))),
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return width(this);
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return width(this);
  });
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return width(this);
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
  const style = document.createElement('style');
  style.textContent = [
    ...['previews.css', 'planes.css'].map((file) =>
      readFileSync(path.resolve(import.meta.dirname, '../src/renderer/styles', file), 'utf8'),
    ),
    // what jsdom cannot resolve from the token variables and base.css
    `.preview-host .preview-toolbar { column-gap: ${gap}px; padding: 0 ${padding}px; }`,
    `.preview-toolbar-group, .plane-controls { column-gap: ${gap}px; }`,
    '.toolbar-spacer { flex-grow: 1; }',
  ].join('\n');
  document.head.append(style);
});
afterEach(() => {
  cleanup();
  document.head.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function context(extension: string, mime: string): PreviewContext {
  return {
    resource: {
      id: `fixture-${extension}`,
      url: `https://fixture.invalid/file.${extension}`,
      entry: {
        name: `file.${extension}`,
        path: `/fixtures/file.${extension}`,
        parent: '/fixtures',
        extension,
        mime,
        directory: false,
        kind: 'file',
        size: 6,
        identity: extension,
        hidden: false,
        created: 1,
        modified: 1,
      },
    },
    active: true,
    interactive: true,
    look: 'dark',
    signal: new AbortController().signal,
    optimize: vi.fn(),
    editImage: vi.fn(),
    editPDF: vi.fn(),
    editMedia: vi.fn(),
    services: {
      read: async () => ({
        text: '# A document\n\nIts contents.',
        binary: false,
        truncated: false,
      }),
      archive: async () => ({
        entries: [{ name: 'inside.txt', size: 3, directory: false }],
        truncated: false,
      }),
      release: async () => {},
    } as unknown as PreviewContext['services'],
  };
}

/** A plane: its header measures the format's toolbar portalled into its slot. */
function Plane({
  Preview,
  context,
}: {
  Preview: ComponentType<PreviewContext>;
  context: PreviewContext;
}) {
  const header = useRef<HTMLDivElement>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const lead = useHeaderOverflow(header);
  return (
    <>
      <div className="plane-controls" ref={header} data-lead={JSON.stringify(lead)}>
        <span className="plane-heading">Preview</span>
        <span className="plane-module-controls" ref={setSlot} />
        <button className="icon-button" data-header-menu="" type="button" aria-label="Actions" />
      </div>
      <Preview
        {...context}
        toolbar="essential"
        commands={{ header: slot ?? undefined, register: () => () => {} }}
      />
    </>
  );
}

const formats = [
  { name: 'image', extension: 'png', mime: 'image/png', Preview: ImagePreview },
  { name: 'PDF', extension: 'pdf', mime: 'application/pdf', Preview: PDFPreview },
  { name: '3D', extension: 'stl', mime: 'application/octet-stream', Preview: ModelPreview },
  { name: 'video', extension: 'mp4', mime: 'video/mp4', Preview: MediaPreview },
  { name: 'audio', extension: 'mp3', mime: 'audio/mpeg', Preview: MediaPreview },
  { name: 'text', extension: 'txt', mime: 'text/plain', Preview: TextPreview },
  { name: 'code', extension: 'ts', mime: 'text/plain', Preview: TextPreview },
  { name: 'Markdown', extension: 'md', mime: 'text/markdown', Preview: TextPreview },
  { name: 'archive', extension: 'zip', mime: 'application/zip', Preview: ArchivePreview },
  { name: 'unknown', extension: 'odd', mime: 'application/octet-stream', Preview: UnknownFile },
];

/** Lets the toolbar measure, show its "…" and measure again, each a frame. */
async function settle() {
  await act(async () => {
    for (let frame = 0; frame < 4; frame++)
      await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}
/** What a toolbar's shown children take, and whether any of them could still give way. */
function line(toolbar: HTMLElement) {
  const visible = [...toolbar.children].filter(shown) as HTMLElement[];
  const used =
    visible.reduce((total, child) => total + width(child), 0) +
    gap * Math.max(0, visible.length - 1);
  const yielding = visible.filter((child) => child.matches('[data-header-item]'));
  return { used, yielding };
}

it.each(formats)(
  'keeps the $name toolbar on one line in a 320 px column, the rest in its "…"',
  async ({ extension, mime, Preview }) => {
    const view = render(
      <PreviewFrameFixture>
        <Preview {...context(extension, mime)} />
      </PreviewFrameFixture>,
    );
    const toolbar = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.preview-toolbar');
      expect(element).toBeTruthy();
      return element!;
    });
    if (extension === 'stl')
      await waitFor(() =>
        expect(
          toolbar.querySelector('button[aria-label="Frame model"]')?.hasAttribute('disabled'),
        ).toBe(false),
      );
    await settle();
    const style = getComputedStyle(toolbar);
    expect(style.height).toBe('44px');
    expect(style.whiteSpace).toBe('nowrap');
    expect(style.flexWrap).toBe('nowrap');
    for (const button of toolbar.querySelectorAll('button'))
      expect(getComputedStyle(button).whiteSpace).toBe('nowrap');
    // facts went to the footer
    expect(toolbar.querySelector('[data-header-detail]:not([data-header-item="zoom"])')).toBeNull();
    // what shows fits; it scrolls only when nothing left could give way
    const { used, yielding } = line(toolbar);
    if (used > room - 2 * padding) expect(yielding).toEqual([]);
    // what gave way is in its "…"
    const away = [...toolbar.querySelectorAll<HTMLElement>('[data-spilled]')];
    const more = screen.queryByRole('button', { name: 'More preview actions' });
    expect(!!more).toBe(away.length > 0);
    const enabled = (item: HTMLElement) =>
      !item.matches(':disabled') && !item.querySelector(':disabled');
    if (more && away.some(enabled)) {
      fireEvent.click(more);
      const menu = await screen.findByRole('dialog', { name: 'More preview actions' });
      expect(menu.querySelectorAll('[role="menuitem"], [role="option"]').length).toBeGreaterThan(0);
    }
  },
);

it.each(formats)(
  'keeps the $name toolbar on one line in a narrow plane header',
  async ({ extension, mime, Preview }) => {
    const view = render(
      <PreviewFrameFixture>
        <Plane Preview={Preview} context={context(extension, mime)} />
      </PreviewFrameFixture>,
    );
    const toolbar = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>(
        '.plane-module-controls > .preview-toolbar',
      );
      expect(element).toBeTruthy();
      return element!;
    });
    await settle();
    expect(getComputedStyle(toolbar).height).toBe('28px');
    expect(getComputedStyle(toolbar).whiteSpace).toBe('nowrap');
    // the header's own "…" holds what gave way: the toolbar shows none of its own
    expect(screen.queryByRole('button', { name: 'More preview actions' })).toBeNull();
    const header = view.container.querySelector<HTMLElement>('.plane-controls')!;
    const lead = JSON.parse(header.dataset.lead!) as string[][];
    const away = [...toolbar.querySelectorAll<HTMLElement>('[data-spilled][data-header-commands]')];
    expect(lead.flat()).toEqual(
      away.flatMap((item) => item.dataset.headerCommands!.split(' ').filter(Boolean)),
    );
  },
);
