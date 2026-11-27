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
it.each([
  ['OFFICE_LAYOUT_TIMEOUT', 'docx', 'Office layout exceeded 45 seconds. Try Reading view.'],
  [
    'OFFICE_LAYOUT_CONVERSION',
    'xlsx',
    'Viewer couldn’t lay out this document. It may be protected or damaged. Try Sheet view.',
  ],
  [
    'OFFICE_LAYOUT_INPUT_LIMIT',
    'xls',
    'The document exceeds the 64 MB layout limit. Open it in its own app.',
  ],
  [
    'OFFICE_LAYOUT_INPUT_LIMIT',
    'docx',
    'The document exceeds the 64 MB layout limit. Open it in its own app.',
  ],
  [
    'OFFICE_LAYOUT_INPUT_LIMIT',
    'xlsx',
    'The document exceeds the 64 MB layout limit. Open it in its own app.',
  ],
  [
    'OFFICE_LAYOUT_OUTPUT_LIMIT',
    'docx',
    'The generated PDF exceeds the 32 MB layout limit. Try Reading view.',
  ],
])('shows the recovery for %s on a %s document', async (code, extension, message) => {
  const { context, services, values, child } = fixture(extension);
  values.set('office.mode', 'layout');
  services.officeLayout
    .mockRejectedValueOnce(Object.assign(new Error('Engine detail'), { code }))
    .mockResolvedValueOnce(child('retry'));
  render(<OfficePreview {...context} />);
  await screen.findByText("Can't lay out this document");
  expect(screen.getByText(message)).toBeTruthy();
  expect(screen.queryByText('Engine detail')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
  await screen.findByText('Rendered retry');
});

it('offers a retry after a render failure and detects all six Office extensions', async () => {
  const { context, services, child } = fixture('doc');
  services.officeLayout
    .mockRejectedValueOnce(new Error('Protected document'))
    .mockResolvedValueOnce(child('retry'));
  render(<OfficePreview {...context} />);
  await screen.findByText('The file is protected. Open it in its own app.');
  fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
  await screen.findByText('Rendered retry');
  const office = previewModules.find((module) => module.id === 'office')!;
  for (const extension of ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'])
    expect(office.detect({ ...context.resource.entry, extension })).toBeGreaterThan(0);
});
