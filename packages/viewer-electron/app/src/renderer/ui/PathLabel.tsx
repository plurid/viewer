import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import type { ClipboardEvent, MouseEvent } from 'react';
import {
  fitPathLabel,
  homeText,
  pathCopyText,
  pathLabelParts,
  pathLabelText,
  pathText,
} from '../../domain/files/path-label';
import type { TextMeasure } from '../../domain/files/path-label';
import { hasRemoteLocationScheme } from '../../domain/remote/location';
import { useViewer } from '../state/core';
import { useRemoteLabels } from './remote-labels';
import './path-label.css';

/** One line shortened from the start to fit its room, or the whole path wrapping. */
export type PathLabelLayout = 'line' | 'wrap';

/** What a copy button copies for a path: the path itself, or a server location as text. */
export type PathCopy = { paths: readonly string[] } | { text: string };

interface FittedLabel {
  whole: string;
  text: string;
}

/**
 * The home folder for a window without the workspace state: Settings gives its snapshot's.
 * Without one, a path keeps its absolute start.
 */
export const PathHome = createContext('');

/** The home folder `~` stands for. */
export function useHome(): string {
  const given = useContext(PathHome);
  const stored = useViewer((state) => state?.bootstrap.home ?? '');
  return given || stored;
}

/** A path as a sentence or a choice names it: whole, with home as `~`. */
export function usePathText(path: string): string {
  const remote = useRemoteLabels(hasRemoteLocationScheme(path));
  return pathText(path, useHome(), { remote });
}

/** A message whose paths name home as `~`. */
export function useHomeText(text: string): string {
  return homeText(text, useHome());
}

/** What copying `path` copies: a local path through the pasteboard, a server location as text. */
export function usePathCopy(path: string): PathCopy {
  const remote = useRemoteLabels(hasRemoteLocationScheme(path));
  return remote ? { text: pathCopyText(path, remote) } : { paths: [path] };
}

/** One canvas measures every label, in each label's computed font. */
let canvas: CanvasRenderingContext2D | null | undefined;
let canvasFont = '';
const widths = new Map<string, number>();

function measurer(element: HTMLElement): TextMeasure | undefined {
  if (canvas === undefined) canvas = document.createElement('canvas').getContext('2d');
  const context = canvas;
  if (!context) return undefined;
  const style = getComputedStyle(element);
  const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return (text) => {
    const key = font + '\n' + text;
    let width = widths.get(key);
    if (width === undefined) {
      if (canvasFont !== font) {
        context.font = font;
        canvasFont = font;
      }
      width = context.measureText(text).width;
      // Candidates repeat as windows resize; a long session starts the memory over.
      if (widths.size >= 5000) widths.clear();
      widths.set(key, width);
    }
    return width;
  };
}

const fitters = new WeakMap<Element, () => void>();
let observer: ResizeObserver | undefined;
let observerType: typeof ResizeObserver | undefined;

/** One observer refits every label in the window when its room changes. */
function watch(element: Element, fit: () => void): () => void {
  if (typeof ResizeObserver !== 'function') return () => {};
  if (!observer || observerType !== ResizeObserver) {
    observerType = ResizeObserver;
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) fitters.get(entry.target)?.();
    });
  }
  const current = observer;
  fitters.set(element, fit);
  current.observe(element);
  return () => {
    fitters.delete(element);
    current.unobserve?.(element);
  };
}

/**
 * A PATH LABEL: home as `~`, and on one line the names after it give way from the start, so the
 * item's own name stays (`~/…/Job 1042/3D`). The tooltip and the accessible name keep the whole
 * path, and copying the label copies the whole path. A server location starts at its server
 * (`al@build:~/Jobs`) and copies as one.
 */
export function PathLabel({
  path,
  layout = 'line',
  className = '',
  id,
  tooltip = true,
  base,
  onClick,
}: {
  path: string;
  layout?: PathLabelLayout;
  className?: string;
  id?: string;
  /** Off when what holds the label already shows the whole path on hover. */
  tooltip?: boolean;
  /** Read the path from this folder, as the copies in one group of duplicates are. */
  base?: string;
  onClick?(event: MouseEvent<HTMLElement>): void;
}) {
  const home = useHome();
  const remote = useRemoteLabels(hasRemoteLocationScheme(path));
  const whole = pathLabelText(pathLabelParts(path, home, { remote, base }));
  const full = pathCopyText(path, remote);
  const root = useRef<HTMLSpanElement>(null);
  const [fitted, setFitted] = useState<FittedLabel>({ whole, text: whole });
  useLayoutEffect(() => {
    const element = root.current;
    if (layout !== 'line' || !element) return;
    const parts = pathLabelParts(path, home, { remote, base });
    const fit = () => {
      // The used width, fractional and before any plane transform: the font measures the same.
      const room = Number.parseFloat(getComputedStyle(element).width) || 0;
      const measure = room > 0 ? measurer(element) : undefined;
      if (!measure) return;
      const text = fitPathLabel(parts, room, measure);
      setFitted((previous) =>
        previous.whole === whole && previous.text === text ? previous : { whole, text },
      );
    };
    fit();
    return watch(element, fit);
  }, [path, home, layout, whole, remote, base]);
  const shown = layout === 'line' && fitted.whole === whole ? fitted.text : whole;
  const copy = (event: ClipboardEvent<HTMLSpanElement>) => {
    const selection = window.getSelection();
    const label = event.currentTarget;
    if (!selection || !label.contains(selection.anchorNode) || !label.contains(selection.focusNode))
      return;
    // The shown text drops names and spells home as `~`: a copy is the whole path.
    event.clipboardData.setData('text/plain', full);
    event.preventDefault();
  };
  return (
    <span
      ref={root}
      id={id}
      className={`path-label ${className}`}
      data-layout={layout}
      title={tooltip ? full : undefined}
      onClick={onClick}
      onCopy={copy}
    >
      <span className="path-label-text" aria-hidden="true">
        {shown}
      </span>
      <span className="visually-hidden path-label-whole">{full}</span>
    </span>
  );
}
