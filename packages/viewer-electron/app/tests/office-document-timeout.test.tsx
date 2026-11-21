// @vitest-environment jsdom
/**
 * Word document Reading timeout cancels only its own document read request rather than releasing
 * PreviewHost's resource lease, keeping Show as Hex usable after a timeout.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useOfficeDocument } from '../src/renderer/previews/useOfficeDocument';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import { documentRequestSchema } from '../src/domain/previews/documents/requests';

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
  const document = vi.fn(() => new Promise<never>(() => {}));
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
  const request = document.mock.calls[0]![1];
  expect(request).toEqual({ requestID: expect.any(String) });
  expect(documentRequestSchema.safeParse(request).success).toBe(true);
  await act(async () => {
    vi.advanceTimersByTime(15000);
  });
  expect(view.container.textContent).toContain('taking longer than expected');
  expect(cancelDocument).toHaveBeenCalledWith('word-res', request.requestID);
  expect(release).not.toHaveBeenCalled();
});
