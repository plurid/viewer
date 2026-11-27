import { useLayoutEffect, useRef, useState } from 'react';
import { middleName, twoLineName } from '../../domain/files/path-label';
import { measurerFor, watchFit } from './text-fit';
import './file-name.css';

/**
 * How a file name meets its room: one line losing its middle, two lines as a grid tile or a
 * Finder icon name, or whole and wrapping where a list wraps long names.
 */
export type FileNameFit = 'line' | 'two-lines' | 'wrap';

interface Fitted {
  name: string;
  text: string;
}

/**
 * A FILE NAME as Finder shows it: too long for its room, it loses its middle and keeps its
 * extension (`Quarterly re…port.xlsx`). The full name is its `data-file-name`, its tooltip only
 * when cut, and what a screen reader hears. It measures on a canvas through the shared observer,
 * so a virtual list pays only for the rows it has mounted.
 */
export function FileName({
  name,
  fit = 'line',
  className = '',
  id,
}: {
  name: string;
  fit?: FileNameFit;
  className?: string;
  id?: string;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const [fitted, setFitted] = useState<Fitted>({ name, text: name });
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || fit === 'wrap') return;
    const refit = () => {
      const style = getComputedStyle(element);
      // The used width, fractional and before any plane transform: the font measures the same.
      const width = Number.parseFloat(style.width) || 0;
      const measure =
        width > 0
          ? measurerFor(
              `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
            )
          : undefined;
      if (!measure) return;
      // Layout rounds a box's width, the canvas does not: a pixel of slack keeps a box sized by
      // its own text from cutting a little more on every refit.
      const text =
        fit === 'two-lines'
          ? twoLineName(name, width, measure)
          : middleName(name, (candidate) => measure(candidate) <= width + 1);
      setFitted((previous) =>
        previous.name === name && previous.text === text ? previous : { name, text },
      );
    };
    refit();
    return watchFit(element, refit);
  }, [name, fit]);
  const text = fit !== 'wrap' && fitted.name === name ? fitted.text : name;
  const cut = (fit === 'two-lines' ? text.replace('\n', '') : text) !== name;
  return (
    <span
      ref={root}
      id={id}
      className={`file-name-label ${className}`}
      data-fit={fit}
      data-file-name={name}
      title={cut ? name : undefined}
    >
      {text !== name ? (
        <>
          <span aria-hidden="true">{text}</span>
          <span className="visually-hidden">{name}</span>
        </>
      ) : (
        name
      )}
    </span>
  );
}
