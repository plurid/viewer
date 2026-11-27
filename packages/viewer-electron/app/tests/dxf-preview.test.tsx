// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import DXFPreview from '../src/renderer/previews/modules/DXFPreview';
import { dxf, entity } from './dxf-fixtures';
import { PreviewFrameFixture } from './support/preview-frame';

let read: (event: MessageEvent) => unknown;
beforeAll(async () => {
  const original = self.onmessage;
  await import('../src/renderer/previews/dxf/dxf.worker');
  read = self.onmessage!.bind(self);
  self.onmessage = original;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderDrawing(retry = vi.fn()) {
  vi.stubGlobal(
    'Worker',
    class {
      onmessage?: (event: MessageEvent) => void;
      postMessage(request: { url: string }) {
        vi.spyOn(self, 'postMessage').mockImplementation((data) => {
          this.onmessage?.(new MessageEvent('message', { data }));
        });
        void read(new MessageEvent('message', { data: request }));
      }
      terminate() {}
    },
  );
  const context = {
    resource: {
      id: 'drawing',
      url: '/fixture.dxf',
      entry: { size: 1024, extension: 'dxf' },
    },
    active: true,
    interactive: true,
    look: 'dark',
    signal: new AbortController().signal,
    retry,
  } as unknown as PreviewContext;
  render(
    <PreviewFrameFixture>
      <DXFPreview {...context} />
    </PreviewFrameFixture>,
  );
}

it.each([
  ['empty model space', dxf(''), 'No supported model-space geometry was found.'],
  ['3D solids only', dxf(entity('3DSOLID', [])), 'No supported model-space geometry was found.'],
  [
    'a DOS850 text entity',
    dxf(entity('TEXT', [10, 0, 20, 0, 40, 1, 1, 'Caf\x82']))
      .replace('AC1027', 'AC1015')
      .replace('0\nENDSEC', '9\n$DWGCODEPAGE\n3\nDOS850\n0\nENDSEC'),
    'Drawing text encoding DOS850 is not supported. Export a UTF-8 ASCII DXF (2007 or newer).',
  ],
  [
    'AutoCAD Binary DXF',
    'AutoCAD Binary DXF',
    'Binary DXF is not supported yet. Export an ASCII DXF from your CAD app.',
  ],
  [
    'ANSI_9999',
    '$DWGCODEPAGE\n3\nANSI_9999\n',
    'Drawing text encoding windows-9999 is not supported. Export a UTF-8 ASCII DXF (2007 or newer).',
  ],
])('shows the reader’s export instruction for %s', async (_label, source, instruction) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(Uint8Array.from(source, (letter) => letter.charCodeAt(0)))),
  );
  const diagnosticReport = vi.fn(async () => {});
  vi.stubGlobal('viewer', { diagnosticReport });
  renderDrawing();
  await screen.findByText("Can't show this drawing");
  expect(screen.getByText(instruction)).toBeTruthy();
  if (_label === '3D solids only') {
    expect(screen.queryByText(/3DSOLID/)).toBeNull();
    expect(diagnosticReport).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.stringContaining('Unsupported entity: 3DSOLID'),
      }),
    );
  }
  expect(screen.getByRole('button', { name: 'Try Again' })).toBeTruthy();
});

it('offers a retry for a failed resource read', async () => {
  vi.stubGlobal('fetch', async () => new Response(null, { status: 500 }));
  const retry = vi.fn();
  renderDrawing(retry);
  await screen.findByText("Viewer couldn't read this drawing.");
  fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
  expect(retry).toHaveBeenCalledOnce();
});
