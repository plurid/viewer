import { useEffect, useMemo, useRef, useState } from 'react';
import { columnName } from '../../../domain/previews/documents/office';
import type { PreviewContext } from '../contracts';
import { usePreviewState } from '../state';
import { usePreviewScroll } from '../scroll';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import { DataTable } from '../DataTable';
import { Empty, Loading } from '../../ui/primitives';
import { ChoiceButton } from '../../ui/ChoiceMenu';
import { report } from '../../state/store';
import { useOfficeDocument } from '../useOfficeDocument';
import { WorksheetNavigation } from '../WorksheetNavigation';
import { WordBlock } from '../WordBlock';

/* THESIS: Read Word text and inspect worksheet cells within the existing file plane.
   OWN-WORLD: Existing flat toolbar, theme surfaces, borders and type; no source fonts or HTML.
   STORY: Choose a sheet, page or jump to source rows, inspect saved values and follow citations.
   FIRST VIEWPORT: Existing sheet selector, a wrapping Previous/Next/Row strip and the full-height table.
   FORM: Ordinary incumbent extension; office-preview-v1, worksheet-pages-v1; no new visual world.
   FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance */
export default function OfficePreview(context: PreviewContext) {
  const fontSize = context.reading?.fontSize ?? 16;
  const [details, setDetails] = useState(false);
  const [formatted, setFormatted] = usePreviewState(context, 'office.formatted', true);
  const [sheetName, setSheetName] = usePreviewState(context, 'office.sheet', '');
  const [positions, setPositions] = usePreviewState<Record<string, number>>(
    context,
    'office.rows',
    {},
  );
  const [history, setHistory] = useState<number[]>([]);
  const [ignoredCitation, setIgnoredCitation] = useState('');
  const suppliedAnchor = context.evidence?.anchor;
  const citationKey =
    suppliedAnchor?.kind === 'cells'
      ? JSON.stringify([
          context.resource.id,
          suppliedAnchor.sheet,
          suppliedAnchor.row,
          suppliedAnchor.column,
        ])
      : '';
  const anchor = citationKey && citationKey === ignoredCitation ? undefined : suppliedAnchor;
  const requestedSheet = anchor?.kind === 'cells' && anchor.sheet ? anchor.sheet : sheetName;
  const savedRow =
    positions && typeof positions === 'object' ? positions[requestedSheet] : undefined;
  const fromRow =
    anchor?.kind === 'cells'
      ? anchor.row
      : typeof savedRow === 'number' &&
          Number.isInteger(savedRow) &&
          savedRow >= 1 &&
          savedRow <= 1048576
        ? savedRow
        : 1;
  const workbook = context.resource.entry.extension === 'xlsx';
  const request = useMemo(
    () => (workbook ? { sheet: requestedSheet || undefined, fromRow, limit: 100 } : undefined),
    [workbook, requestedSheet, fromRow],
  );
  const { document, loading, error, retry } = useOfficeDocument(context, request);
  const wordRef = useRef<HTMLDivElement>(null);
  usePreviewScroll(context.state, wordRef, 'office', {
    ready: !!document && !workbook,
    restore: !context.evidence,
  });
  useEffect(() => {
    if (anchor?.kind === 'document' && document)
      wordRef.current
        ?.querySelector(`[data-document-block="${anchor.block}"]`)
        ?.scrollIntoView({ block: 'center' });
  }, [anchor, document]);
  const office = document?.office;
  const sheet =
    office?.kind === 'workbook'
      ? office.sheets.find((sheet) => sheet.name === (office.page?.sheet ?? sheetName)) ||
        office.sheets.find((sheet) => !sheet.hidden) ||
        office.sheets[0]
      : undefined;
  const page = office?.kind === 'workbook' ? office.page : undefined;
  const savePosition = (name: string, row: number) =>
    setPositions((previous) => ({
      ...Object.fromEntries(
        Object.entries(previous && typeof previous === 'object' ? previous : {})
          .filter(([key]) => key !== name)
          .slice(-31),
      ),
      [name]: row,
    }));
  const navigate = (row: number, direction: 'previous' | 'next' | 'jump') => {
    if (!sheet || !page) return;
    setIgnoredCitation(citationKey);
    setSheetName(sheet.name);
    savePosition(sheet.name, row);
    setHistory((previous) =>
      direction === 'previous' ? previous.slice(0, -1) : [...previous, page.fromRow].slice(-128),
    );
  };
  const firstWorksheet = () => {
    setIgnoredCitation(citationKey);
    setSheetName('');
    savePosition('', 1);
    setHistory([]);
    retry();
  };
  const headers = useMemo(
    () => Array.from({ length: sheet?.columns || 0 }, (_, index) => columnName(index + 1)),
    [sheet?.columns],
  );
  usePreviewCommands(
    context,
    useMemo(
      () => [
        {
          id: 'office-preview-details',
          label: details ? 'Hide preview details' : 'Show preview details',
          aliases: ['coverage', 'office', 'formula'],
          available: Boolean(office),
          run: () => setDetails((value) => !value),
        },
      ],
      [details, office],
    ),
  );
  if ((!document && error) || (document && !office))
    return (
      <Empty
        icon="file"
        title="Office preview unavailable"
        detail={error || 'This document has no supported text or worksheets.'}
      >
        <button onClick={workbook ? retry : (context.retry ?? retry)}>Try again</button>
        {workbook && <button onClick={firstWorksheet}>First worksheet</button>}
        <button
          onClick={() => {
            void window.viewer.openExternal(context.resource.entry.path).catch(report);
          }}
        >
          Open in Default App
        </button>
      </Empty>
    );
  if (!document || !office)
    return <Loading label={workbook ? 'Reading worksheet rows…' : 'Reading Office document…'} />;
  return (
    <div className="office-viewer" data-office-preview="worksheet-pages-v1">
      <PreviewToolbar context={context}>
        {office.kind === 'workbook' && (
          <label className="workbook-sheet-picker">
            Worksheet{' '}
            <ChoiceButton
              label="Worksheet"
              value={requestedSheet || sheet?.name || ''}
              choices={office.sheets.map((sheet) => ({
                value: sheet.name,
                label: sheet.name + (sheet.hidden ? ' (hidden)' : ''),
              }))}
              onChoose={(name) => {
                setIgnoredCitation(citationKey);
                setSheetName(name);
                setHistory([]);
              }}
            />
          </label>
        )}
        <span className="muted">
          {office.kind === 'workbook' ? 'Saved values' : 'Text, tables and images'}
        </span>
        {office.kind === 'workbook' && (
          <>
            <button aria-pressed={formatted} onClick={() => setFormatted(true)}>
              Formatted
            </button>
            <button aria-pressed={!formatted} onClick={() => setFormatted(false)}>
              Stored
            </button>
          </>
        )}
        <span className="toolbar-spacer" />
        <button
          aria-expanded={details}
          aria-controls={'office-details-' + context.resource.id}
          onClick={() => setDetails(!details)}
        >
          Preview details
        </button>
      </PreviewToolbar>
      {details && (
        <section
          className="office-coverage"
          id={'office-details-' + context.resource.id}
          aria-label="Preview details"
        >
          <p>{document.coverageReason}</p>
          {office.kind === 'workbook' && !loading && !error && (
            <p>
              {office.formulas} formula cells{page ? ' on this page' : ''} · {office.missingCached}{' '}
              without a saved value
            </p>
          )}
        </section>
      )}
      {!loading && !error && (page ? page.limited : document.truncated) && (
        <p className="inline-warning">
          {page
            ? 'Some cell values or columns exceed the preview limits.'
            : 'The reader limit was reached. Some content is not shown.'}
        </p>
      )}
      {!loading &&
        !error &&
        sheet?.rows.some((row) => row.cells.some((cell) => cell.formatWarning)) && (
          <p className="inline-warning">
            Some number formats are unavailable; stored values are shown for those cells. Select a
            cell for details.
          </p>
        )}
      {!loading && !error && sheet?.mergeLimited && (
        <p className="inline-warning">
          Some merged ranges or their anchor values exceed the preview limits.
        </p>
      )}
      {anchor?.kind === 'cells' &&
        anchor.sheet &&
        office.kind === 'workbook' &&
        !office.sheets.some((sheet) => sheet.name === anchor.sheet) && (
          <p className="inline-warning">
            The referenced worksheet is outside the available preview.
          </p>
        )}
      {sheet && page && !error && (
        <WorksheetNavigation
          page={page}
          sheet={sheet}
          loading={loading}
          previous={history.at(-1) ?? Math.max(1, page.fromRow - 100)}
          navigate={navigate}
        />
      )}
      {loading ? (
        <Loading label={workbook ? 'Reading worksheet rows…' : 'Reading Office document…'} />
      ) : error ? (
        <Empty
          icon="file"
          title={workbook ? 'Worksheet page unavailable' : 'Office preview unavailable'}
          detail={error}
        >
          <button onClick={workbook ? retry : (context.retry ?? retry)}>Try again</button>
          {workbook && <button onClick={firstWorksheet}>First worksheet</button>}
        </Empty>
      ) : sheet ? (
        <DataTable
          key={sheet.name + ':' + (page?.fromRow ?? '')}
          state={context.state}
          label={sheet.name}
          rows={sheet.rows}
          headers={headers}
          anchor={
            anchor?.kind === 'cells' && (!anchor.sheet || anchor.sheet === sheet.name)
              ? anchor
              : undefined
          }
          numbered
          sourceLastRow={page?.lastRow}
          paged={Boolean(page)}
          formatted={formatted}
          merges={sheet.merges}
        />
      ) : (
        office.kind === 'word' && (
          <div className="office-document-scroll" ref={wordRef}>
            {anchor?.kind === 'document' && anchor.block >= office.blocks.length && (
              <p className="inline-warning">
                The referenced passage is outside the available preview.
              </p>
            )}
            <article className="office-document" aria-label="Document body" style={{ fontSize }}>
              {office.blocks.map((block, index) => (
                <div
                  className={
                    anchor?.kind === 'document' && anchor.block === index
                      ? 'evidence-passage'
                      : undefined
                  }
                  data-document-block={index}
                  key={index}
                >
                  <WordBlock block={block} context={context} />
                </div>
              ))}
              {!office.blocks.length && <p className="muted">No document body text.</p>}
            </article>
          </div>
        )
      )}
    </div>
  );
}
