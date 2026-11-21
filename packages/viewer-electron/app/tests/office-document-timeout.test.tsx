// @vitest-environment jsdom
/**
 * Word document Reading timeout cancels only its own document read request rather than releasing
 * PreviewHost's resource lease, keeping Show as Hex usable after a timeout.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useOfficeDocument } from '../src/renderer/previews/useOfficeDocument';
import OfficePreview from '../src/renderer/previews/modules/OfficePreview';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import type { DocumentRequest } from '../src/domain/previews/documents/requests';
import { documentRequestSchema } from '../src/domain/previews/documents/requests';
import { createResourceHandlers } from '../src/desktop/ipc/resource-handlers';
import { initialize } from '../src/renderer/state/store';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Probe({ context }: { context: PreviewContext }) {
  const state = useOfficeDocument(context);
  return <div>{state.error || (state.loading ? 'loading' : 'ready')}</div>;
}

it('cancels a timed-out Word document read by requestID without releasing the preview resource lease', async () => {
  vi.useFakeTimers();
  const document = vi.fn((_id: string, _request?: DocumentRequest) => new Promise<never>(() => {}));
  const cancelDocument = vi.fn(async () => {});
  const release = vi.fn(async () => {});
  const context = {
    resource: {
      id: 'word-res',
      url: 'viewer-resource://word-res/asset/Report.docx',
      entry: { path: '/fixtures/Report.docx', name: 'Report.docx', extension: 'docx' },
    },
    active: true,
    interactive: true,
    look: 'dark',
    signal: new AbortController().signal,
    services: { document, cancelDocument, release },
  } as unknown as PreviewContext;
  const view = render(<Probe context={context} />);
  expect(document).toHaveBeenCalledTimes(1);
  const request = document.mock.calls[0]?.[1];
  expect(request).toEqual({ requestID: expect.any(String) });
  if (!request) throw new Error('Expected a document request.');
  const parsed = documentRequestSchema.parse(request);
  expect(parsed).toEqual({ requestID: request.requestID });
  expect('fromRow' in parsed).toBe(false);
  expect('limit' in parsed).toBe(false);
  const extract = vi.fn(async () => ({
    path: '/fixtures/Report.docx',
    metadata: {},
    evidence: [],
    text: 'hello',
    truncated: false,
  }));
  const handlers = createResourceHandlers({
    resources: {
      documentRead: (
        _id: string,
        _requestID: string,
        fn: (file: string, signal: AbortSignal, format: string) => Promise<unknown>,
      ) => fn('/fixtures/Report.docx', new AbortController().signal, 'docx'),
    } as never,
    thumbnails: { get: vi.fn() },
    webPreviews: { releaseResource: vi.fn() },
    files: { extract },
    fileAccess: { require: vi.fn() },
    forgetGitResource: vi.fn(),
    warmOffice: vi.fn(),
  });
  await handlers.document(['word-res', parsed], 1);
  expect(extract).toHaveBeenCalledWith(
    '/fixtures/Report.docx',
    expect.any(AbortSignal),
    true,
    undefined,
    'docx',
  );
  await act(async () => {
    vi.advanceTimersByTime(15000);
  });
  expect(view.container.textContent).toContain('taking longer than expected');
  expect(cancelDocument).toHaveBeenCalledWith('word-res', request.requestID);
  expect(release).not.toHaveBeenCalled();
});

it('keeps the Office layout switch reachable when content extraction fails', async () => {
  initialize({ home: '/fixtures', platform: 'darwin', locations: [], state: null, openPaths: [] });
  const document = vi.fn(async () => {
    throw new Error('Could not read workbook content.');
  });
  const context = {
    resource: {
      id: 'wb-res',
      url: 'viewer-resource://wb-res/asset/Budget.xlsm',
      entry: {
        path: '/fixtures/Budget.xlsm',
        name: 'Budget.xlsm',
        extension: 'xlsm',
        directory: false,
        kind: 'file',
        size: 1024,
        mime: 'application/vnd.ms-excel.sheet.macroEnabled.12',
      },
    },
    active: true,
    interactive: true,
    look: 'dark',
    signal: new AbortController().signal,
    services: {
      document,
      officeLayout: vi.fn(async () => {
        throw new Error('Layout not started in test');
      }),
      cancelDocument: vi.fn(async () => {}),
      release: vi.fn(async () => {}),
    },
  } as unknown as PreviewContext;
  render(<OfficePreview {...context} />);
  expect(await screen.findByText('Could not read workbook content.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Print Layout' })).toBeTruthy();
});
