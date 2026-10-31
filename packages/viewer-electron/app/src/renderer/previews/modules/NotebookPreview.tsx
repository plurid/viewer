import { useRef } from 'react';
import type { ResourceRead } from '../../../domain/contracts';
import type {
  Notebook,
  NotebookCell,
  NotebookOutput,
} from '../../../domain/previews/data/notebook';
import type { PreviewContext } from '../contracts';
import type { ParsedText } from '../ParsedDocument';
import { notebookLimits, parseNotebook } from '../../../domain/previews/data/notebook';
import { ParsedDocument } from '../ParsedDocument';
import { HighlightedCode, MarkdownContent } from '../Markdown';
import { usePreviewScroll } from '../scroll';
import { Disclosure } from '../../ui/Disclosure';

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

function readNotebook(read: ResourceRead): ParsedText<Notebook> {
  if (read.truncated)
    return {
      notice: 'This notebook is larger than the 4 MB preview limit, so it is shown as text.',
    };
  const reading = parseNotebook(read.text);
  if (!reading.ok) return { notice: `This notebook could not be read. ${reading.reason}` };
  const { notebook } = reading;
  return {
    document: notebook,
    notice:
      notebook.total > notebookLimits.cells
        ? `Showing the first ${plural(notebookLimits.cells, 'cell', 'cells')} of ` +
          `${notebook.total.toLocaleString()}. Source has the whole notebook.`
        : undefined,
  };
}

function notebookSummary(notebook: Notebook): string {
  const cells = plural(notebook.total, 'cell', 'cells');
  return notebook.kernel ? `${notebook.kernel} · ${cells}` : cells;
}

const shortened = `Shortened to its first ${notebookLimits.text.toLocaleString()} characters.`;

function Output({ output, context }: { output: NotebookOutput; context: PreviewContext }) {
  switch (output.kind) {
    case 'text':
      return (
        <div className={`notebook-output is-${output.source}`}>
          <pre>{output.text}</pre>
          {output.truncated && <p className="notebook-note">{shortened}</p>}
        </div>
      );
    case 'markdown':
      return (
        <div className="notebook-output">
          <div className="markdown notebook-markdown">
            <MarkdownContent
              text={output.text}
              path={context.resource.entry.path}
              openRelated={context.openRelated}
            />
          </div>
          {output.truncated && <p className="notebook-note">{shortened}</p>}
        </div>
      );
    case 'image':
      return (
        <div className="notebook-output">
          <img className="notebook-image" src={output.url} alt={output.alt || 'Cell output'} />
        </div>
      );
    case 'html':
      return (
        <div className="notebook-output">
          <p className="notebook-note">HTML output is not rendered.</p>
          <Disclosure variant="compact" className="notebook-html" summary="HTML source">
            <pre>{output.source}</pre>
            {output.truncated && <p className="notebook-note">{shortened}</p>}
          </Disclosure>
        </div>
      );
    case 'error':
      return (
        <div className="notebook-output is-error">
          <pre>
            <strong>
              {output.name}
              {output.message && `: ${output.message}`}
            </strong>
            {output.traceback && `\n${output.traceback}`}
          </pre>
          {output.truncated && <p className="notebook-note">{shortened}</p>}
        </div>
      );
    case 'omitted':
      return <p className="notebook-note">{output.reason}</p>;
  }
}

function Cell({
  cell,
  language,
  context,
}: {
  cell: NotebookCell;
  language: string;
  context: PreviewContext;
}) {
  // Jupyter's execution count: `[ ]` for a cell that has not run
  const prompt = cell.kind === 'code' ? `[${cell.execution ?? ' '}]` : '';
  return (
    <section className={`notebook-cell is-${cell.kind}`}>
      <span className="notebook-prompt">{prompt}</span>
      <div className="notebook-cell-body">
        {cell.kind === 'markdown' ? (
          <div className="markdown notebook-markdown">
            <MarkdownContent
              text={cell.source}
              path={context.resource.entry.path}
              openRelated={context.openRelated}
              images={cell.attachments}
            />
          </div>
        ) : cell.kind === 'code' ? (
          <pre className="notebook-source">
            <HighlightedCode language={language} text={cell.source} />
          </pre>
        ) : (
          <pre className="notebook-raw">{cell.source}</pre>
        )}
        {cell.truncated && <p className="notebook-note">{shortened}</p>}
        {cell.outputs.map((output, index) => (
          <Output key={index} output={output} context={context} />
        ))}
        {cell.omittedOutputs > 0 && (
          <p className="notebook-note">
            {plural(cell.omittedOutputs, 'more output is', 'more outputs are')} not shown.
          </p>
        )}
      </div>
    </section>
  );
}

function NotebookView({ context, notebook }: { context: PreviewContext; notebook: Notebook }) {
  const scroll = useRef<HTMLDivElement>(null);
  usePreviewScroll(context.state, scroll, 'notebook', { restore: !context.evidence });
  // a kernel's language names its grammar (python, r, julia); its file extension is the fallback
  const language = (notebook.language ?? notebook.extension ?? 'text').toLowerCase();
  return (
    <div className="notebook-scroll" ref={scroll} tabIndex={0} aria-label="Notebook cells">
      <article className="notebook">
        {notebook.cells.map((cell, index) => (
          <Cell key={index} cell={cell} language={language} context={context} />
        ))}
        {!notebook.cells.length && <p className="notebook-note">This notebook has no cells.</p>}
      </article>
    </div>
  );
}

/** A Jupyter notebook's cells in order: Markdown, highlighted code and their saved outputs. */
export default function NotebookPreview(context: PreviewContext) {
  return (
    <ParsedDocument
      context={context}
      label="Notebook"
      parse={readNotebook}
      summary={notebookSummary}
    >
      {(notebook) => <NotebookView context={context} notebook={notebook} />}
    </ParsedDocument>
  );
}
