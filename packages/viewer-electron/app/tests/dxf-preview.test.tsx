// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

it.each([
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
      entry: { size: source.length, extension: 'dxf' },
    },
    active: true,
    interactive: true,
    look: 'dark',
    signal: new AbortController().signal,
    retry: vi.fn(),
  } as unknown as PreviewContext;
  render(
    <PreviewFrameFixture>
      <DXFPreview {...context} />
    </PreviewFrameFixture>,
  );
  await screen.findByText("Can't show this drawing");
  expect(screen.getByText(instruction)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Try Again' })).toBeTruthy();
});
