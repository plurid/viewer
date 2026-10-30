import { useId } from 'react';
import type { Placement } from '../../../domain/layout/nesting/plan';
import type { BoxPlacement } from '../../../domain/layout/nesting/rectangles';
import { placementMatrix } from '../../../domain/layout/nesting/geometry';
import type { PartView } from './protocol';

/** SVG path data for x, y pairs. */
function pathData(values: readonly number[], closed: boolean): string {
  let data = '';
  for (let i = 0; i < values.length; i += 2)
    data += `${i ? 'L' : 'M'}${round(values[i]!)} ${round(values[i + 1]!)}`;
  return closed ? data + 'Z' : data;
}
const round = (value: number) => Math.round(value * 100) / 100;

/** A part as drawn: material filled, holes empty, open cuts and marks as lines. Drawing y runs
 * up, so the shapes are flipped inside a box of the part's size. */
function PartShape({ part, flip }: { part: PartView; flip?: boolean }) {
  const body = (
    <>
      <path
        className="nesting-material"
        d={part.rings.map((ring) => pathData(ring, true)).join('')}
      />
      {part.paths.map((path, index) => (
        <path key={`p${index}`} className="nesting-open" d={pathData(path, false)} />
      ))}
      {part.marks.map((path, index) => (
        <path key={`m${index}`} className="nesting-mark" d={pathData(path, false)} />
      ))}
    </>
  );
  return flip ? <g transform={`translate(0 ${round(part.height)}) scale(1 -1)`}>{body}</g> : body;
}

export function PartThumbnail({ part }: { part: PartView }) {
  const pad = Math.max(part.width, part.height) * 0.04;
  return (
    <svg
      className="nesting-thumbnail"
      viewBox={`${-pad} ${-pad} ${part.width + 2 * pad} ${part.height + 2 * pad}`}
      aria-hidden="true"
    >
      <PartShape part={part} flip />
    </svg>
  );
}

export interface SheetPicture {
  length: number;
  width: number;
  margin: number;
  title: string;
  /** True-shape placements, or boxes from the instant estimate. */
  placements?: readonly Placement[];
  boxes?: readonly (BoxPlacement & { width: number; height: number })[];
}

/** One sheet to scale, length along x, with each part's number. */
export function SheetView({
  sheet,
  parts,
  zoom,
}: {
  sheet: SheetPicture;
  parts: readonly PartView[];
  zoom: number;
}) {
  const id = useId().replace(/:/g, '');
  const used = new Set(sheet.placements?.map((placement) => placement.part));
  const label = (part: PartView) =>
    Math.max(6, Math.min(40, Math.min(part.width, part.height) * 0.35));
  return (
    <figure className="nesting-sheet">
      <figcaption>{sheet.title}</figcaption>
      <div className="nesting-sheet-scroll">
        <svg
          viewBox={`0 0 ${sheet.length} ${sheet.width}`}
          style={{ width: `${zoom * 100}%` }}
          role="img"
          aria-label={sheet.title}
        >
          <defs>
            {[...used].map((index) => (
              <g key={index} id={`${id}-part-${index}`}>
                <PartShape part={parts[index]!} />
              </g>
            ))}
          </defs>
          <rect className="nesting-stock" width={sheet.length} height={sheet.width} />
          {sheet.margin > 0 && (
            <rect
              className="nesting-margin"
              x={sheet.margin}
              y={sheet.margin}
              width={Math.max(0, sheet.length - 2 * sheet.margin)}
              height={Math.max(0, sheet.width - 2 * sheet.margin)}
            />
          )}
          <g transform={`translate(0 ${sheet.width}) scale(1 -1)`}>
            {sheet.placements?.map((placement, index) => {
              const m = placementMatrix(
                placement.rotation,
                placement.mirror,
                placement.x,
                placement.y,
              );
              return (
                <use
                  key={index}
                  href={`#${id}-part-${placement.part}`}
                  transform={`matrix(${m.map(round).join(' ')})`}
                />
              );
            })}
            {sheet.boxes?.map((box, index) => (
              <rect
                key={index}
                className="nesting-box"
                x={box.x}
                y={box.y}
                width={box.turned ? box.height : box.width}
                height={box.turned ? box.width : box.height}
              />
            ))}
          </g>
          {sheet.placements?.map((placement, index) => {
            const part = parts[placement.part]!;
            const m = placementMatrix(
              placement.rotation,
              placement.mirror,
              placement.x,
              placement.y,
            );
            const x = m[0] * part.label.x + m[2] * part.label.y + m[4],
              y = m[1] * part.label.x + m[3] * part.label.y + m[5];
            const size = label(part);
            return (
              <text
                key={index}
                className="nesting-number"
                x={round(x)}
                y={round(sheet.width - y + size * 0.35)}
                fontSize={round(size)}
              >
                {placement.part + 1}
              </text>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}
