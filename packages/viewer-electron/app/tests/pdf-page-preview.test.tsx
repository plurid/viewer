// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { PDFPagePreview } from '../src/renderer/pdf-tools/PDFPagePreview';
const getDocument = vi.hoisted(() => vi.fn());
vi.mock('pdfjs-dist', () => ({ getDocument, GlobalWorkerOptions: {} }));
it('clears the slow-load notice when the requested page arrives', async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  getDocument.mockReturnValue({
    promise: new Promise((resolve) => {
      finish = resolve;
    }),
    destroy: async () => {},
  });
  vi.stubGlobal('viewer', {
    onEvent: () => () => {},
    resource: async () => ({ id: 'pdf', url: '/pdf' }),
    release: async () => {},
  });
  const view = render(<PDFPagePreview file="/fixture/read.pdf" page={1} rotate={0} />);
  try {
    await act(() => vi.advanceTimersByTimeAsync(15001));
    expect(screen.getByText(/taking longer/)).toBeTruthy();
    await act(async () => finish({ getPage: () => new Promise(() => {}) }));
    expect(screen.queryByText(/taking longer/)).toBeNull();
  } finally {
    view.unmount();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
