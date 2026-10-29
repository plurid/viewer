import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FileEntry, ResourceRead } from '../../../domain/contracts';
import type { SubtitleCue, Subtitles } from '../../../domain/previews/data/subtitles';
import type { PreviewContext } from '../contracts';
import type { ParsedText } from '../ParsedDocument';
import {
  formatSubtitleDuration,
  formatSubtitleTime,
  parseSubtitles,
  subtitleFormat,
  subtitleLimits,
} from '../../../domain/previews/data/subtitles';
import { ParsedDocument } from '../ParsedDocument';
import { usePreviewState } from '../state';
import { usePreviewScroll } from '../scroll';

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

function readSubtitles(read: ResourceRead, entry: FileEntry): ParsedText<Subtitles> {
  const format = subtitleFormat(entry.extension, read.text);
  if (!format)
    return {
      notice: 'This file is not in a subtitle format Viewer reads, so it is shown as text.',
    };
  const subtitles = parseSubtitles(read.text, format);
  if (!subtitles.cues.length)
    return { notice: 'No timed cues were found, so the file is shown as text.' };
  const notes: string[] = [];
  if (read.truncated) notes.push('Only the first 4 MB of this file is read.');
  if (subtitles.truncated)
    notes.push(`Showing the first ${plural(subtitleLimits.cues, 'cue', 'cues')}.`);
  if (subtitles.skipped === 1) notes.push('A block without a readable time was left out.');
  else if (subtitles.skipped > 1)
    notes.push(
      `${subtitles.skipped.toLocaleString()} blocks without readable times were left out.`,
    );
  return { document: subtitles, notice: notes.join(' ') || undefined };
}

function subtitlesSummary(subtitles: Subtitles): string {
  const cues = plural(subtitles.cues.length, 'cue', 'cues');
  return `${cues} · ${formatSubtitleDuration(subtitles.duration)}`;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text with each match of the search marked. */
function Marked({ text, query }: { text: string; query: string }) {
  if (!query) return text;
  // a capturing split keeps the matches at the odd positions
  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'giu'));
  return parts.map((part, index) => (index % 2 ? <mark key={index}>{part}</mark> : part));
}

function matches(cue: SubtitleCue, pattern: RegExp, query: string): boolean {
  return (
    pattern.test(cue.text) ||
    (!!cue.speaker && pattern.test(cue.speaker)) ||
    formatSubtitleTime(cue.start).includes(query)
  );
}

function SubtitlesView({ context, subtitles }: { context: PreviewContext; subtitles: Subtitles }) {
  const [search, setSearch] = usePreviewState(context, 'subtitles.query', '');
  const query = search.trim();
  const rows = useMemo(() => {
    if (!query) return subtitles.cues;
    const pattern = new RegExp(escapeRegExp(query), 'iu');
    return subtitles.cues.filter((cue) => matches(cue, pattern, query));
  }, [query, subtitles.cues]);
  const scroll = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 40,
    overscan: 12,
  });
  usePreviewScroll(context.state, scroll, 'subtitles', { restore: !context.evidence && !query });
  return (
    <div className="subtitles-viewer">
      <div className="preview-toolbar subtitles-toolbar">
        <input
          type="search"
          aria-label="Search cues"
          placeholder="Search cues"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span className="toolbar-spacer" />
        {query && (
          <span className="muted tabular" role="status">
            {rows.length.toLocaleString()} of {plural(subtitles.cues.length, 'cue', 'cues')}
          </span>
        )}
      </div>
      <div
        className="subtitles-table"
        role="table"
        aria-label="Subtitle cues"
        aria-rowcount={rows.length + 1}
      >
        <div className="subtitles-row subtitles-header" role="row" aria-rowindex={1}>
          <span role="columnheader">#</span>
          <span role="columnheader">Start</span>
          <span role="columnheader">End</span>
          <span role="columnheader">Text</span>
        </div>
        <div className="subtitles-scroll" ref={scroll} tabIndex={0} aria-label="Cues">
          {!rows.length && <p className="muted subtitles-empty">No cues match this search.</p>}
          <div className="subtitles-body" style={{ height: virtual.getTotalSize() }}>
            {virtual.getVirtualItems().map((item) => {
              const cue = rows[item.index];
              if (!cue) return null;
              return (
                <div
                  key={item.key}
                  className="subtitles-row"
                  role="row"
                  aria-rowindex={item.index + 2}
                  data-index={item.index}
                  ref={virtual.measureElement}
                  style={{ top: item.start }}
                >
                  <span role="cell" className="muted tabular">
                    {cue.index}
                  </span>
                  <span role="cell" className="tabular">
                    {formatSubtitleTime(cue.start)}
                  </span>
                  <span role="cell" className="tabular">
                    {formatSubtitleTime(cue.end)}
                  </span>
                  <span role="cell" className="subtitles-text">
                    {cue.speaker && <span className="muted">{cue.speaker}: </span>}
                    <Marked text={cue.text} query={query} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** SubRip, WebVTT and SubStation Alpha cues as a searchable table of times and text. */
export default function SubtitlesPreview(context: PreviewContext) {
  return (
    <ParsedDocument context={context} label="Cues" parse={readSubtitles} summary={subtitlesSummary}>
      {(subtitles) => <SubtitlesView context={context} subtitles={subtitles} />}
    </ParsedDocument>
  );
}
