import { expect, it, vi } from 'vitest';
import { worksheetTSV } from '../src/renderer/previews/worksheet-copy';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import type { DocumentData } from '../src/domain/services';
import type { WorksheetDocumentRequest } from '../src/domain/previews/documents/office';

function fixture() {
  const cancelDocument = vi.fn(async () => {});
  const document = vi.fn(
    async (_id: string, request?: WorksheetDocumentRequest): Promise<DocumentData> => {
      const fromRow = request!.fromRow!;
      return {
        path: '/Generated.xlsx',
        text: '',
        evidence: [],
        metadata: {},
        truncated: true,
        office: {
          kind: 'workbook',
          formulas: 0,
          missingCached: 0,
          page: {
            sheet: 'Data',
            fromRow,
            lastRow: 4,
            nextRow: fromRow < 3 ? 3 : undefined,
            limited: false,
          },
          sheets: [
            {
              name: 'Data',
              hidden: false,
              columns: 1,
              truncated: false,
              loaded: true,
              rows: [{ row: fromRow, cells: [{ column: 1, value: String(fromRow) }] }],
            },
          ],
        },
      };
    },
  );
  const context = {
    resource: { id: 'owned-workbook' },
    signal: new AbortController().signal,
    services: { document, cancelDocument },
  } as unknown as PreviewContext;
  return { context, document, cancelDocument };
}
const range = { fromRow: 1, toRow: 4, fromColumn: 1, toColumn: 1 };
it('collects source rows across pages without silently dropping blank rows', async () => {
  const f = fixture();
  expect(await worksheetTSV(f.context, 'Data', range, true, new AbortController().signal)).toBe(
    '1\n\n3\n',
  );
  expect(f.document.mock.calls.map((call) => call[1]?.fromRow)).toEqual([1, 3]);
  expect(f.document.mock.calls[0]?.[1]?.requestID).not.toBe(
    f.document.mock.calls[1]?.[1]?.requestID,
  );
});
it('cancels only its own request and returns promptly even if a worker has not replied', async () => {
  const f = fixture(),
    controller = new AbortController();
  f.document.mockImplementationOnce(() => new Promise(() => {}));
  const work = worksheetTSV(f.context, 'Data', range, false, controller.signal);
  const rejected = expect(work).rejects.toThrow('cancelled');
  controller.abort(new Error('Copy cancelled'));
  await rejected;
  expect(f.cancelDocument).toHaveBeenCalledExactlyOnceWith(
    'owned-workbook',
    f.document.mock.calls[0]?.[1]?.requestID,
  );
});
it('rejects partial extraction and selections larger than its budget', async () => {
  const f = fixture();
  const data = await f.document('owned-workbook', { fromRow: 1, requestID: 'fixture' });
  if (data.office?.kind === 'workbook') data.office.page!.limited = true;
  f.document.mockResolvedValueOnce(data);
  await expect(
    worksheetTSV(f.context, 'Data', range, true, new AbortController().signal),
  ).rejects.toThrow('incomplete');
  f.document.mockClear();
  await expect(
    worksheetTSV(f.context, 'Data', { ...range, toRow: 20000 }, true, new AbortController().signal),
  ).rejects.toThrow('10,000');
  expect(f.document).not.toHaveBeenCalled();
});
