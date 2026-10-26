// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OfficePreview from '../src/renderer/previews/modules/OfficePreview';
import type { Resource } from '../src/domain/contracts';
import type { OfficeLayoutRequest } from '../src/domain/previews/documents/layout';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import { previewModules } from '../src/renderer/previews/registry';

vi.mock('../src/renderer/previews/modules/PDFPreview', () => ({
  default: ({ resource }: PreviewContext) => <div>Rendered {resource.id}</div>,
}));
afterEach(cleanup);
function fixture(extension = 'xls') {
  const values = new Map<string, unknown>();
  const services = {
    officeLayout: vi.fn<(id: string, request: OfficeLayoutRequest) => Promise<Resource>>(),
    cancelDocument: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
  };
  const context = {
    resource: {
      id: 'source',
      entry: { extension, name: 'Sample.' + extension, path: '/fixture/Sample.' + extension },
    },
    services,
    active: true,
    interactive: true,
    signal: new AbortController().signal,
    look: 'dark',
    state: {
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => values.set(key, value),
    },
  } as unknown as PreviewContext;
  const child = (id: string, sheet = 'Budget') =>
    ({
      id,
      url: 'viewer-resource://' + id + '/asset.pdf',
      entry: { extension: 'pdf' },
      office: {
        sheets: [
          { name: 'Budget', hidden: false },
          { name: 'Notes', hidden: false },
        ],
        selectedSheet: sheet,
        limited: false,
      },
    }) as Resource;
  return { context, services, values, child };
}
it('navigates legacy worksheets by tabs and keyboard, preserving the selected worksheet', async () => {
  const { context, services, values, child } = fixture();
  services.officeLayout
    .mockResolvedValueOnce(child('first'))
    .mockResolvedValueOnce(child('second', 'Notes'));
  const view = render(<OfficePreview {...context} />);
  await screen.findByText('Rendered first');
  const budget = screen.getByRole('tab', { name: 'Budget' });
  budget.focus();
  fireEvent.keyDown(budget, { key: 'ArrowRight' });
  await screen.findByText('Rendered second');
  expect(services.officeLayout.mock.calls[1][1].sheet).toBe('Notes');
  expect(values.get('office.sheet')).toBe('Notes');
  expect(document.activeElement?.textContent).toBe('Notes');
  expect(services.release).toHaveBeenCalledWith('first');
  view.unmount();
  expect(services.release).toHaveBeenCalledWith('second');
});
it('cancels a closed view and releases a late child without releasing its source', async () => {
  const { context, services, child } = fixture('ppt');
  let finish!: (resource: Resource) => void;
  services.officeLayout.mockImplementation(
    () =>
      new Promise<Resource>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<OfficePreview {...context} />);
  view.unmount();
  expect(services.cancelDocument).toHaveBeenCalledWith('source', expect.any(String));
  await act(async () => finish(child('late')));
  await waitFor(() => expect(services.release).toHaveBeenCalledWith('late'));
  expect(services.release).not.toHaveBeenCalledWith('source');
});
it('offers a retry after a render failure and detects all six Office extensions', async () => {
  const { context, services, child } = fixture('doc');
  services.officeLayout
    .mockRejectedValueOnce(new Error('Protected document'))
    .mockResolvedValueOnce(child('retry'));
  render(<OfficePreview {...context} />);
  await screen.findByText('Protected document');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('Rendered retry');
  const office = previewModules.find((module) => module.id === 'office')!;
  for (const extension of ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'])
    expect(office.detect({ ...context.resource.entry, extension })).toBeGreaterThan(0);
});
