import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { columnName } from '../../../domain/previews/documents/office';
import type { PreviewContext } from '../contracts';
import { usePreviewState } from '../state';
import { usePreviewScroll } from '../scroll';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import { DataTable, type TableControls } from '../DataTable';
import { ChoiceButton } from '../../ui/ChoiceMenu';
import { Empty, Loading } from '../../ui/primitives';
import { report } from '../../state/store';
import { useOfficeDocument } from '../useOfficeDocument';
import { WorksheetNavigation } from '../WorksheetNavigation';
import { WordBlock } from '../WordBlock';
import OfficeLayoutPreview from './OfficeLayoutPreview';
import { WorksheetTabs } from '../WorksheetTabs';
import { worksheetTSV } from '../worksheet-copy';
import type { TableAddress } from '../../../domain/previews/documents/table-navigation';

export default function OfficePreview(context: PreviewContext) {
  const extension = context.resource.entry.extension;
  const content = extension === 'docx' || extension === 'xlsx';
  const workbook = extension === 'xls' || extension === 'xlsx';
  const [mode, setMode] = usePreviewState(
    context,
    'office.mode',
    extension === 'xlsx' || context.evidence ? 'content' : 'layout',
  );
  if (!context.services.officeLayout && content) return <OfficeContent {...context} />;
  const viewControls = (
    <>
      <button aria-pressed={mode !== 'content' || !content} onClick={() => setMode('layout')}>
        {workbook ? 'Print layout' : 'Layout'}
      </button>
      {content && (
        <button aria-pressed={mode === 'content'} onClick={() => setMode('content')}>
          {workbook ? 'Sheet' : 'Reading'}
        </button>
      )}
    </>
  );
  return mode === 'content' && content ? (
    <OfficeContent {...context} viewControls={viewControls} />
  ) : (
    <div className="office-viewer">
      <PreviewToolbar context={context}>{viewControls}</PreviewToolbar>
      <OfficeLayoutPreview {...context} />
    </div>
  );
}

function OfficeContent(context: PreviewContext & { viewControls?: ReactNode }) {
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
  const [cellTarget, setCellTarget] = useState<TableAddress>();
  const surface = useRef<HTMLDivElement>(null);
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
  const chooseSheet = (name: string, focus = false) => {
    setIgnoredCitation(citationKey);
    setSheetName(name);
    setHistory([]);
    setCellTarget(focus ? { row: positions?.[name] ?? 1, column: 1 } : undefined);
    if (focus) surface.current?.focus({ preventScroll: true });
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
  const toolbar = (filter?: TableControls) => (
    <PreviewToolbar context={context}>
      {context.viewControls}
      {filter && (
        <input
          type="search"
          aria-label="Filter current worksheet page"
          placeholder="Filter rows shown"
          value={filter.query}
          onChange={(event) => filter.setQuery(event.target.value)}
        />
      )}
      <span className="toolbar-spacer" />
      {filter && (
        <span className="muted office-row-count">
          {filter.rows.toLocaleString()} rows · {filter.columns} columns
        </span>
      )}
      <ChoiceButton
        label="Preview options"
        value=""
        placeholder="More"
        choices={[
          ...(office.kind === 'workbook'
            ? [
                {
                  value: 'formatted',
                  label: 'Formatted values',
                  detail: formatted ? 'Selected' : undefined,
                },
                {
                  value: 'stored',
                  label: 'Stored values',
                  detail: !formatted ? 'Selected' : undefined,
                },
              ]
            : []),
          { value: 'details', label: details ? 'Hide preview details' : 'Show preview details' },
        ]}
        onChoose={(value) =>
          value === 'details'
            ? setDetails((previous) => !previous)
            : setFormatted(value === 'formatted')
        }
      />
    </PreviewToolbar>
  );
  return (
    <div
      className="office-viewer"
      data-office-preview="worksheet-pages-v1"
      ref={surface}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (
          !event.ctrlKey ||
          event.altKey ||
          event.metaKey ||
          office.kind !== 'workbook' ||
          (event.key !== 'PageUp' && event.key !== 'PageDown')
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const index = office.sheets.findIndex((item) => item.name === sheet?.name);
        const next = Math.max(
          0,
          Math.min(office.sheets.length - 1, index + (event.key === 'PageUp' ? -1 : 1)),
        );
        const name = office.sheets[next]?.name;
        if (name && name !== sheet?.name) chooseSheet(name, true);
      }}
    >
      {(office.kind !== 'workbook' || loading || error) && toolbar()}
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
          renderControls={toolbar}
          copyRange={
            page
              ? (range, signal) => worksheetTSV(context, sheet.name, range, formatted, signal)
              : undefined
          }
          target={cellTarget}
          navigate={
            page
              ? (target) => {
                  surface.current?.focus({ preventScroll: true });
                  setCellTarget(target);
                  navigate(target.row, 'jump');
                }
              : undefined
          }
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
      {sheet && page && !error && (page.fromRow > 1 || page.nextRow !== undefined) && (
        <WorksheetNavigation
          page={page}
          sheet={sheet}
          loading={loading}
          previous={history.at(-1) ?? Math.max(1, page.fromRow - 100)}
          navigate={(row, direction) => {
            setCellTarget(undefined);
            navigate(row, direction);
          }}
        />
      )}
      {office.kind === 'workbook' && sheet && (
        <WorksheetTabs sheets={office.sheets} value={sheet.name} choose={chooseSheet} />
      )}
    </div>
  );
}
