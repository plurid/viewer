import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FileEntry } from '../../domain/contracts';
import { pdfOutput, pdfPageRange } from '../../domain/operations/pdf-pages';
import type { PDFDraftPage, PDFInput } from '../../domain/operations/pdf-pages';
import { Dialog, Failure, IconButton, Loading } from '../ui/primitives';
import { plural } from '../../domain/plural';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { DestinationField } from '../ui/DestinationField';
import { FileNameField, fileNameError } from '../ui/FileNameField';
import { FormField } from '../ui/FormField';
import { useHome } from '../ui/PathLabel';
import { report, useViewer } from '../state/store';
import { useWorkspace } from '../workspace/context';
import { PDFPagePreview } from './PDFPagePreview';
import './pdf-tools.css';
import { isActiveJob } from '../../domain/operations/jobs';
import { errorMessage } from '../../domain/errors';
import { homeText } from '../../domain/files/path-label';

export function PDFToolsDialog({
  files,
  paneID,
  onClose,
}: {
  files: FileEntry[];
  paneID?: string;
  onClose(): void;
}) {
  const workspace = useWorkspace(),
    jobs = useViewer((state) => state.jobs);
  const [inputs, setInputs] = useState<PDFInput[]>([]),
    [pages, setPages] = useState<PDFDraftPage[]>([]),
    [active, setActive] = useState('');
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const [source, setSource] = useState(0),
    [range, setRange] = useState(''),
    [separate, setSeparate] = useState(false);
  const [folder, setFolder] = useState(files[0]!.parent),
    [name, setName] = useState(
      files.length > 1 ? 'Merged' : files[0]!.name.replace(/\.pdf$/i, '') + ' edited',
    );
  const [busy, setBusy] = useState(false),
    [ids, setIDs] = useState<string[]>([]);
  const run = useRef({ cancelled: false, ids: [] as string[] });
  const home = useHome();
  useEffect(() => {
    setIDs([]);
  }, [pages, inputs, name, folder, separate]);
  const load = async (entries: FileEntry[], previous: PDFInput[] = []): Promise<PDFInput[]> => {
    const result = [...previous];
    for (const file of entries) {
      if (result.some((input) => input.file.path === file.path)) continue;
      if (result.length >= 16) throw new Error('PDF Tools takes up to 16 PDFs at once.');
      const value = await window.viewer.pdfInspect(file.path);
      if (result.reduce((total, input) => total + input.pages, value.pages) > 1000)
        throw new Error('PDF Tools takes up to 1,000 pages at once. Choose a smaller document.');
      result.push({ file, ...value });
    }
    return result;
  };
  const initialPages = (values: PDFInput[], offset = 0): PDFDraftPage[] =>
    values.flatMap((input, index) =>
      Array.from({ length: input.pages }, (_, page) => ({
        id: `${index + offset}:${page + 1}`,
        source: index + offset,
        page: page + 1,
        rotate: 0,
        included: true,
      })),
    );
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    setInputs([]);
    setPages([]);
    void load(files)
      .then((values) => {
        if (!live) return;
        const pages = initialPages(values);
        setInputs(values);
        setPages(pages);
        setActive(pages[0]?.id || '');
        setSource(0);
        setRange(`1-${values[0]!.pages}`);
      })
      .catch((reason) => {
        if (live) setError(String(reason.message || reason));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [files, attempt]);
  const scroll = useRef<HTMLDivElement>(null);
  const rows = useVirtualizer({
    count: pages.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 42,
    overscan: 8,
    getItemKey: (index) => pages[index]!.id,
  });
  const selected = pages.find((page) => page.id === active),
    selectedIndex = pages.findIndex((page) => page.id === active),
    included = pages.filter((page) => page.included);
  const exports = jobs.filter((job) => ids.includes(job.id)),
    outputs = exports.flatMap((job) => job.completed).filter((item) => item.destination);
  const working = busy || exports.some((job) => isActiveJob(job));
  const update = (id: string, change: Partial<PDFDraftPage>) =>
    setPages((pages) => pages.map((page) => (page.id === id ? { ...page, ...change } : page)));
  const move = (delta: number) => {
    if (selectedIndex < 0 || selectedIndex + delta < 0 || selectedIndex + delta >= pages.length)
      return;
    setPages((pages) => {
      const next = [...pages],
        index = pages.findIndex((page) => page.id === active);
      if (index < 0 || index + delta < 0 || index + delta >= next.length) return pages;
      [next[index], next[index + delta]] = [next[index + delta]!, next[index]!];
      return next;
    });
    rows.scrollToIndex(selectedIndex + delta);
  };
  const applyRange = () => {
    try {
      const order = pdfPageRange(range, inputs[source]!.pages),
        previous = pages.filter((page) => page.source === source),
        first = pages.findIndex((page) => page.source === source);
      const changed = [
        ...order.map((number) => ({
          ...previous.find((page) => page.page === number)!,
          included: true,
        })),
        ...previous
          .filter((page) => !order.includes(page.page))
          .map((page) => ({ ...page, included: false })),
      ];
      const others = pages.filter((page) => page.source !== source);
      others.splice(first, 0, ...changed);
      setPages(others);
      setActive(changed[0]!.id);
      setError('');
      rows.scrollToIndex(first);
    } catch (reason) {
      setError(String(errorMessage(reason) || reason));
    }
  };
  const add = async () => {
    setLoading(true);
    setError('');
    try {
      const paths = await window.viewer.choosePDFs(),
        entries = await Promise.all(paths.map((file) => window.viewer.stat(file))),
        next = await load(entries, inputs);
      setInputs(next);
      setPages((pages) => [...pages, ...initialPages(next.slice(inputs.length), inputs.length)]);
    } catch (reason) {
      setError(String(errorMessage(reason) || reason));
    } finally {
      setLoading(false);
    }
  };
  const start = async () => {
    const current = { cancelled: false, ids: [] as string[] };
    run.current = current;
    setIDs([]);
    setError('');
    setBusy(true);
    try {
      const groups = separate ? included.map((page) => [page]) : [included];
      if (separate && groups.length > 100)
        throw new Error('Split up to 100 pages at once. Choose a smaller range.');
      for (const [index, group] of groups.entries()) {
        if (current.cancelled) break;
        const output = pdfOutput(group, inputs);
        const id = await window.viewer.operate({
          kind: 'convert',
          sources: output.sources.map((input) => input.file.path),
          destination: folder,
          name: separate ? name + ` ${String(index + 1).padStart(3, '0')}.pdf` : name + '.pdf',
          transform: output.plan,
          expectedSources: output.sources.map((input) => ({
            path: input.file.path,
            version: input.version,
          })),
        });
        current.ids.push(id);
        setIDs([...current.ids]);
        if (current.cancelled) await window.viewer.cancelJob(id);
      }
    } catch (reason) {
      setError(String(errorMessage(reason) || reason));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    run.current.cancelled = true;
    await Promise.all(run.current.ids.map((id) => window.viewer.cancelJob(id)));
  };
  return (
    <Dialog wide title="PDF Tools" className="pdf-tools-dialog" onClose={onClose}>
      <div className="pdf-tools-toolbar">
        <button disabled={loading || working} onClick={() => void add()}>
          Add PDFs…
        </button>
        <span className="muted">
          {plural(inputs.length, 'PDF')} · {included.length.toLocaleString('en-US')} of{' '}
          {plural(pages.length, 'page')} included
        </span>
        <span className="toolbar-spacer" />
        <button
          disabled={!pages.length || working}
          onClick={() => setPages((pages) => pages.map((page) => ({ ...page, included: true })))}
        >
          Include All
        </button>
        <button
          disabled={!included.length || working}
          onClick={() => setPages((pages) => pages.map((page) => ({ ...page, included: false })))}
        >
          Exclude All
        </button>
      </div>
      {inputs.length > 0 && (
        <div className="pdf-tools-range">
          <FormField label="Source PDF">
            <ChoiceButton
              label="Source PDF"
              value={String(source)}
              choices={inputs.map((input, index) => ({
                value: String(index),
                label: input.file.name,
              }))}
              onChoose={(value) => {
                const index = Number(value);
                setSource(index);
                setRange(`1-${inputs[index]!.pages}`);
              }}
            />
          </FormField>
          <FormField label="Pages to include">
            <input
              aria-label="PDF page range"
              value={range}
              placeholder="1-3, 8, 5"
              disabled={working}
              onChange={(event) => setRange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyRange();
              }}
            />
          </FormField>
          <button disabled={working || loading} onClick={applyRange}>
            Apply Range
          </button>
        </div>
      )}
      <div className="pdf-tools-body">
        <div className="pdf-tools-order">
          <div className="pdf-tools-order-actions">
            <span>Output order</span>
            <span className="toolbar-spacer" />
            <IconButton
              icon="up"
              label="Move page up"
              disabled={working || selectedIndex <= 0}
              onClick={() => move(-1)}
            />
            <IconButton
              icon="down"
              label="Move page down"
              disabled={working || selectedIndex < 0 || selectedIndex >= pages.length - 1}
              onClick={() => move(1)}
            />
            <IconButton
              icon="rotate"
              label="Rotate page clockwise"
              disabled={working || !selected}
              onClick={() =>
                selected &&
                update(selected.id, {
                  rotate: ((selected.rotate + 90) % 360) as PDFDraftPage['rotate'],
                })
              }
            />
          </div>
          <div className="pdf-tools-list" ref={scroll} role="list" aria-label="PDF output pages">
            <div style={{ height: rows.getTotalSize(), position: 'relative' }}>
              {rows.getVirtualItems().map((row) => {
                const page = pages[row.index]!,
                  input = inputs[page.source]!;
                return (
                  <div
                    role="listitem"
                    key={page.id}
                    className={`pdf-tools-row${page.id === active ? ' is-active' : ''}${page.included ? '' : ' is-excluded'}`}
                    style={{ height: row.size, transform: `translateY(${row.start}px)` }}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Include ${input.file.name} page ${page.page}`}
                      checked={page.included}
                      disabled={working}
                      onChange={(event) => update(page.id, { included: event.target.checked })}
                    />
                    <button
                      title={`${input.file.path} · page ${page.page}`}
                      aria-pressed={page.id === active}
                      onClick={() => setActive(page.id)}
                    >
                      <span>{input.file.name}</span>
                      <span className="muted">
                        Page {page.page}
                        {page.rotate ? ` · +${page.rotate}°` : ''}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="pdf-tools-inspection">
          {selected && inputs[selected.source] ? (
            <>
              <div className="pdf-tools-page-label">
                {inputs[selected.source]!.file.name} · Page {selected.page}
                {selected.rotate ? ` · +${selected.rotate}°` : ''}
              </div>
              <PDFPagePreview
                file={inputs[selected.source]!.file.path}
                page={selected.page}
                rotate={selected.rotate}
              />
            </>
          ) : loading ? (
            <Loading label="Reading PDFs…" />
          ) : (
            <Failure
              icon="pdf"
              title="No PDF pages loaded"
              detail="Try again, or add another PDF."
              onRetry={() => setAttempt((value) => value + 1)}
            />
          )}
        </div>
      </div>
      <div className="pdf-tools-export dialog-form">
        <FileNameField
          value={name}
          extension="pdf"
          onChange={setName}
          folder={folder}
          disabled={working}
          numberedSuffix={separate ? ' 001' : ''}
        />
        <DestinationField path={folder} onChange={setFolder} disabled={working} />
        <label className="pdf-tools-split dialog-field-toggle">
          <input
            type="checkbox"
            checked={separate}
            disabled={working}
            onChange={(event) => setSeparate(event.target.checked)}
          />
          Save each included page separately
        </label>
        <p className="muted">
          Originals are kept. Exported PDFs lose bookmarks, forms and accessibility tags.
        </p>
        {separate && <p className="muted">File names start with {name} 001.pdf.</p>}
        {error && (
          <p className="dialog-error" role="alert">
            {homeText(error, home)}
          </p>
        )}
        {exports.length > 0 && (
          <div className="pdf-tools-results" aria-live="polite">
            {exports.map((job) => (
              <div key={job.id}>
                <span>
                  {homeText(
                    (job.status === 'running'
                      ? `${Math.round((job.progress || 0) * 100)}% · ${job.detail || 'Exporting…'}`
                      : job.status) + (job.errors[0] ? ` · ${job.errors[0].message}` : ''),
                    home,
                  )}
                </span>
                {job.completed
                  .filter((item) => item.destination)
                  .map((item) => (
                    <button
                      key={item.destination}
                      onClick={() =>
                        void workspace
                          .openPath(item.destination!, { paneID, linked: !!paneID, activate: true })
                          .then(onClose)
                          .catch(report)
                      }
                    >
                      Open {item.destination!.split('/').pop()}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <footer>
        <span className="muted">
          {outputs.length
            ? `${plural(outputs.length, 'PDF')} saved`
            : !included.length
              ? 'Include a page to save a PDF.'
              : separate
                ? `${plural(included.length, 'numbered PDF')}`
                : `${plural(included.length, 'page')} → one PDF`}
        </span>
        <span className="toolbar-spacer" />
        <button onClick={onClose}>Close</button>
        {working ? (
          <button onClick={() => void cancel().catch(report)}>Cancel Export</button>
        ) : (
          <button
            className="primary"
            disabled={
              loading ||
              !included.length ||
              !folder.trim() ||
              !!fileNameError(name, 'pdf', separate ? ' 001' : '')
            }
            onClick={() => void start()}
          >
            {separate ? 'Split Pages' : 'Save PDF'}
          </button>
        )}
      </footer>
    </Dialog>
  );
}
