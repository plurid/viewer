import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentData } from '../../../domain/services';
import { columnName } from '../../../domain/office';
import type { PreviewContext } from '../contracts';
import { usePreviewState } from '../state';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import { DataTable } from '../DataTable';
import { Empty, Loading } from '../../ui/primitives';
import { ChoiceButton } from '../../ui/ChoiceMenu';
import { report } from '../../state/store';

/* THESIS: Read Word text and inspect worksheet cells within the existing file plane.
   OWN-WORLD: Existing flat toolbar, theme surfaces, borders and type; no source fonts or HTML.
   STORY: Choose a sheet, filter rows, inspect saved values, return to a source citation.
   FIRST VIEWPORT: Sheet selector and coverage controls above the full-height table or readable body.
   FORM: Ordinary extension of the incumbent preview system; office-preview-v1.
   FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance */
export default function OfficePreview(context: PreviewContext) {
  const [document, setDocument] = useState<DocumentData>();
  const [error, setError] = useState('');
  const [details, setDetails] = useState(false);
  const [sheetName, setSheetName] = usePreviewState(context, 'office.sheet', '');
  const wordRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    setDocument(undefined);
    setError('');
    context.services
      .document(context.resource.id)
      .then((value) => {
        if (alive && !context.signal.aborted) setDocument(value);
      })
      .catch((error) => {
        if (alive && !context.signal.aborted) setError(String(error.message || error));
      });
    return () => {
      alive = false;
    };
  }, [context.services, context.resource.id, context.signal]);
  const anchor = context.evidence?.anchor;
  useEffect(() => {
    if (anchor?.kind === 'cells' && anchor.sheet) setSheetName(anchor.sheet);
  }, [anchor, setSheetName]);
  useEffect(() => {
    if (anchor?.kind === 'document' && document)
      wordRef.current
        ?.querySelector(`[data-document-block="${anchor.block}"]`)
        ?.scrollIntoView({ block: 'center' });
  }, [anchor, document]);
  const office = document?.office;
  const sheet =
    office?.kind === 'workbook'
      ? office.sheets.find((sheet) => sheet.name === sheetName) ||
        office.sheets.find((sheet) => !sheet.hidden) ||
        office.sheets[0]
      : undefined;
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
  if (error || (document && !office))
    return (
      <Empty
        icon="file"
        title="Office preview unavailable"
        detail={error || 'This document has no supported text or worksheets.'}
      >
        <button
          onClick={() => {
            void window.viewer.openExternal(context.resource.entry.path).catch(report);
          }}
        >
          Open in Default App
        </button>
      </Empty>
    );
  if (!document || !office) return <Loading label="Reading Office document…" />;
  return (
    <div className="office-viewer">
      <PreviewToolbar context={context}>
        {office.kind === 'workbook' && (
          <label className="workbook-sheet-picker">
            Worksheet{' '}
            <ChoiceButton
              label="Worksheet"
              value={sheet?.name ?? ''}
              choices={office.sheets.map((sheet) => ({
                value: sheet.name,
                label: sheet.name + (sheet.hidden ? ' (hidden)' : ''),
              }))}
              onChoose={setSheetName}
            />
          </label>
        )}
        <span className="muted">
          {office.kind === 'workbook' ? 'Saved values' : 'Text and tables'}
        </span>
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
          {office.kind === 'workbook' && (
            <p>
              {office.formulas} formula cells · {office.missingCached} without a saved value
            </p>
          )}
        </section>
      )}
      {document.truncated && (
        <p className="inline-warning">The reader limit was reached. Some content is not shown.</p>
      )}
      {anchor?.kind === 'cells' &&
        anchor.sheet &&
        office.kind === 'workbook' &&
        !office.sheets.some((sheet) => sheet.name === anchor.sheet) && (
          <p className="inline-warning">
            The referenced worksheet is outside the available preview.
          </p>
        )}
      {sheet ? (
        <DataTable
          key={sheet.name}
          label={sheet.name}
          rows={sheet.rows}
          headers={headers}
          anchor={
            anchor?.kind === 'cells' && (!anchor.sheet || anchor.sheet === sheet.name)
              ? anchor
              : undefined
          }
          numbered
        />
      ) : (
        office.kind === 'word' && (
          <div className="office-document-scroll" ref={wordRef}>
            {anchor?.kind === 'document' && anchor.block >= office.blocks.length && (
              <p className="inline-warning">
                The referenced passage is outside the available preview.
              </p>
            )}
            <article className="office-document" aria-label="Document body">
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
                  {block.kind === 'paragraph' ? (
                    createElement(
                      block.heading ? 'h' + block.heading : 'p',
                      {},
                      block.text || '\u00a0',
                    )
                  ) : (
                    <div className="office-table-scroll">
                      <table>
                        <tbody>
                          {block.rows.map((row, r) => (
                            <tr key={r}>
                              {row.map((cell, c) => (
                                <td key={c}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
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
