import { useLayoutEffect, useRef, useState } from 'react';
import type { FileEntry } from '../../domain/contracts';
import { usePreviewSize } from './PreviewSize';

/** Keep the extension and the end of the stem when a filename loses its middle. */
export function middleFilename(
  name: string,
  width: number,
  measure: (text: string) => number,
): string {
  if (measure(name) <= width) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot) : '';
  const stem = Array.from(dot > 0 ? name.slice(0, dot) : name);
  const shorten = (count: number) => {
    const start = Math.ceil(count * 0.6);
    const end = count - start;
    return stem.slice(0, start).join('') + '…' + (end ? stem.slice(-end).join('') : '') + extension;
  };
  let low = 0;
  let high = Math.max(0, stem.length - 1);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measure(shorten(middle)) <= width) low = middle;
    else high = middle - 1;
  }
  return shorten(low);
}

/** A fact in the footer, and how long it stays: 0 longest. */
interface Fact {
  text: string;
  keep: number;
}
/** What is laid out, and for which name and facts. */
interface FactsLayout {
  key: string;
  name?: string;
  kept: number;
}

const pixels = (value: string) => Number.parseFloat(value) || 0;

/**
 * A PREVIEW'S FOOTER LINE (DESIGN.md, the Preview Identity Rule): the filename, then its kind, size
 * and the facts its toolbar gave, such as an image's dimensions, on one line that never grows.
 * The filename keeps its extension and loses its middle; it keeps 96 px before any fact gives way.
 * Facts give way from the last: dimensions, then kind, then size. The whole line is the tooltip
 * and the accessible name. Without a name, where a dialog's title already shows it, only the
 * facts.
 */
export function PreviewFacts({
  name,
  kind,
  size,
  details = [],
}: {
  name?: string;
  kind: string;
  size: string;
  details?: readonly string[];
}) {
  const facts: Fact[] = [
    { text: kind, keep: 1 },
    { text: size, keep: 0 },
    ...details.map((text, index) => ({ text, keep: 2 + index })),
  ].filter((fact) => fact.text);
  const full = [name, ...facts.map((fact) => fact.text)].filter(Boolean).join(' · ');
  const key = JSON.stringify([name ?? null, facts]);
  const root = useRef<HTMLDivElement>(null);
  const nameRuler = useRef<HTMLSpanElement>(null);
  const factsRuler = useRef<HTMLSpanElement>(null);
  const [layout, setLayout] = useState<FactsLayout>();
  useLayoutEffect(() => {
    const element = root.current;
    const names = nameRuler.current;
    const widths = factsRuler.current;
    if (!element || !names || !widths) return;
    const [shownName, shown] = JSON.parse(key) as [string | null, Fact[]];
    const update = () => {
      const room = element.clientWidth;
      // laid out nowhere yet: the name and facts show whole, clipped, until there is room
      if (!room) return;
      const measure = (text: string) => {
        names.textContent = text;
        return Math.max(names.offsetWidth, names.scrollWidth);
      };
      // each fact as it is drawn, its separator and spacing included
      const drawn = [...widths.children].map((child) => (child as HTMLElement).offsetWidth);
      const between = pixels(getComputedStyle(widths).columnGap);
      const beside = pixels(getComputedStyle(element).columnGap);
      const order = shown
        .map((fact, index) => ({ ...fact, index }))
        .sort((a, b) => a.keep - b.keep);
      const cost = (kept: number) =>
        kept === 0
          ? 0
          : order.slice(0, kept).reduce((total, fact) => total + drawn[fact.index]!, 0) +
            between * (kept - 1) +
            (shownName === null ? 0 : beside);
      const minimum = shownName === null ? 0 : Math.min(measure(shownName), 96);
      let kept = order.length;
      while (kept > 0 && room - cost(kept) < minimum) kept--;
      const next: FactsLayout = {
        key,
        kept,
        name:
          shownName === null ? undefined : middleFilename(shownName, room - cost(kept), measure),
      };
      setLayout((previous) =>
        previous?.key === next.key && previous.name === next.name && previous.kept === next.kept
          ? previous
          : next,
      );
    };
    update();
    // test documents may lack ResizeObserver; Chromium always has it
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [key]);
  // a layout for other words is stale: show these whole until they are measured
  const current = layout?.key === key ? layout : undefined;
  const kept = new Set(
    [...facts].sort((a, b) => a.keep - b.keep).slice(0, current?.kept ?? facts.length),
  );
  const visible = facts.filter((fact) => kept.has(fact));
  return (
    <div className="preview-file-info" ref={root} role="group" title={full} aria-label={full}>
      {name !== undefined && (
        <span className="preview-filename" aria-hidden="true">
          {current?.name ?? name}
        </span>
      )}
      <span className="preview-file-details" aria-hidden="true">
        {visible.map((fact, index) => (
          <span className="preview-file-detail" key={fact.keep}>
            {(name !== undefined || index > 0) && <span className="separator">·</span>}
            {fact.text}
          </span>
        ))}
      </span>
      <span className="preview-filename preview-info-measure" ref={nameRuler} aria-hidden="true" />
      <span
        className="preview-file-details preview-info-measure"
        ref={factsRuler}
        aria-hidden="true"
      >
        {facts.map((fact) => (
          <span className="preview-file-detail" key={fact.keep}>
            <span className="separator">·</span>
            {fact.text}
          </span>
        ))}
      </span>
    </div>
  );
}

/** A previewed file's footer line: its name, kind and size, a package's measured total. */
export function PreviewFileInfo({
  entry,
  kind,
  details,
  named = true,
}: {
  entry: FileEntry;
  kind: string;
  details?: readonly string[];
  /** False where a title already shows the name, as Quick Preview's does. */
  named?: boolean;
}) {
  const size = usePreviewSize(entry);
  return (
    <PreviewFacts name={named ? entry.name : undefined} kind={kind} size={size} details={details} />
  );
}
