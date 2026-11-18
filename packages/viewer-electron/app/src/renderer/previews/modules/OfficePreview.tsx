import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { columnName } from '../../../domain/previews/documents/office';
import type { PreviewContext, PreviewModule } from '../contracts';
import { usePreviewState } from '../state';
import { usePreviewScroll } from '../scroll';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import { headerItem } from '../../workspace/header-overflow';
import { DataTable, type TableControls } from '../DataTable';
import { MenuButton } from '../../ui/ChoiceMenu';
import { Loading } from '../../ui/primitives';
import { PreviewFailure } from '../PreviewFailure';
import { plural } from '../../../domain/plural';
import { useOfficeDocument } from '../useOfficeDocument';
import { WorksheetNavigation } from '../WorksheetNavigation';
import { WordBlock } from '../WordBlock';
import OfficeLayoutPreview from './OfficeLayoutPreview';
import { WorksheetTabs } from '../WorksheetTabs';
import { worksheetTSV } from '../worksheet-copy';
import type { TableAddress } from '../../../domain/previews/documents/table-navigation';
import {
  officeFamily,
  readsOfficeContent,
  sharedOfficeExtensions,
} from '../../../domain/previews/documents/layout';
import { choosePreview, previewModules } from '../registry';
import { preloadPreviewModule } from '../module-loading';

/** Office layout and content. A file with a shared name written as text goes to the preview ranked
 * below Office for it: any ranked above has already handed it on. */
export default function OfficePreview(context: PreviewContext) {
  const { resource, services } = context;
  const shared = sharedOfficeExtensions.includes(resource.entry.extension);
  // undefined while its first bytes are read; null for the Office document it is
  const [other, setOther] = useState<ComponentType<PreviewContext> | null | undefined>(
    shared ? undefined : null,
  );
  useEffect(() => {
    if (!shared) return;
    let live = true;
    void services
      .read(resource.id, 4096)
      .then((read) => {
        if (read.binary) return null;
        const rank = (module: PreviewModule) => module.detect(resource.entry);
        const office = rank(previewModules.find((module) => module.id === 'office')!);
        const below = previewModules.filter((module) => rank(module) < office);
        return preloadPreviewModule(choosePreview(resource.entry, below));
      })
      .catch(() => null)
      .then((Viewer) => {
        if (live) setOther(() => Viewer);
      });
    return () => {
      live = false;
    };
  }, [shared, resource.id, resource.entry, services]);
  if (other === undefined) return <Loading />;
  if (other) {
    const Other = other;
    return <Other {...context} />;
  }
  return <OfficeDocument {...context} />;
}

function OfficeDocument(context: PreviewContext) {
  const extension = context.resource.entry.extension;
  // OpenDocument and the older formats have the engine's layout only
  const content = readsOfficeContent(extension);
  const workbook = officeFamily(extension) === 'workbook';
  const [mode, setMode] = usePreviewState(
    context,
    'office.mode',
    (workbook && content) || context.evidence ? 'content' : 'layout',
  );
  if (!context.services.officeLayout && content) return <OfficeContent {...context} />;
  const viewControls = (
    <>
      <button aria-pressed={mode !== 'content' || !content} onClick={() => setMode('layout')}>
        {workbook ? 'Print Layout' : 'Layout'}
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
  const workbook = officeFamily(context.resource.entry.extension) === 'workbook';
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
          label: details ? 'Hide Preview Details' : 'Show Preview Details',
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
      <PreviewFailure
        context={context}
        icon="file"
        title="Can't show this document"
        detail={error || 'Viewer found no text or worksheets it can show in this document.'}
        onRetry={workbook ? retry : (context.retry ?? retry)}
      >
        {workbook && <button onClick={firstWorksheet}>First Worksheet</button>}
      </PreviewFailure>
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
        // a fact, which the footer shows with the file's others
        <span {...headerItem('rows', 9, 'detail')}>
          {plural(filter.rows, 'row')} · {plural(filter.columns, 'column')}
        </span>
      )}
      {/* actions, as a menu button: each row does something, none is checked */}
      <MenuButton
        label="More"
        className="office-more"
        items={[
          ...(office.kind === 'workbook'
            ? [
                formatted
                  ? { value: 'stored', label: 'Show Stored Values' }
                  : { value: 'formatted', label: 'Show Formatted Values' },
              ]
            : []),
          { value: 'details', label: details ? 'Hide Preview Details' : 'Show Preview Details' },
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
              {plural(office.formulas, 'formula cell')}
              {page ? ' on this page' : ''} · {office.missingCached.toLocaleString('en-US')} without
              a saved value
            </p>
          )}
        </section>
      )}
      {!loading && !error && (page ? page.limited : document.truncated) && (
        <p className="inline-warning">
          {page
            ? 'Some long cells and columns are cut short.'
            : 'Only the first part of this document is shown.'}
        </p>
      )}
      {!loading &&
        !error &&
        sheet?.rows.some((row) => row.cells.some((cell) => cell.formatWarning)) && (
          <p className="inline-warning">
            Some cells show plain numbers because Viewer can't apply their format. Select a cell for
            details.
          </p>
        )}
      {!loading && !error && sheet?.mergeLimited && (
        <p className="inline-warning">Some merged cells are too large to show merged.</p>
      )}
      {anchor?.kind === 'cells' &&
        anchor.sheet &&
        office.kind === 'workbook' &&
        !office.sheets.some((sheet) => sheet.name === anchor.sheet) && (
          <p className="inline-warning">The linked sheet isn't in this preview.</p>
        )}
      {loading ? (
        <Loading label={workbook ? 'Reading worksheet rows…' : 'Reading Office document…'} />
      ) : error ? (
        <PreviewFailure
          context={context}
          icon="file"
          title={workbook ? "Can't show this worksheet page" : "Can't show this document"}
          detail={error}
          onRetry={workbook ? retry : (context.retry ?? retry)}
        >
          {workbook && <button onClick={firstWorksheet}>First Worksheet</button>}
        </PreviewFailure>
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
