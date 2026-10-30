import { memo, useId } from 'react';
import type { LayoutFormat, LayoutItem, LayoutPage } from '../../domain/layout/plan';
import { turned } from '../../domain/layout/geometry';
import type { Size } from '../../domain/layout/geometry';
import { usePicture } from './pictures';
import type { LayoutPictures, PictureSize } from './pictures';
import { shownLine } from './text';

type PictureItem = Extract<LayoutItem, { kind: 'image' | 'page' }>;
export interface SheetSource {
  path: string;
  /** The picture's size before the item's rotation: pixels or points, only its shape matters. */
  size(page?: number): Size;
}

/**
 * One page of a plan, drawn from its items as the desktop writer draws them: each picture turned
 * clockwise, then cropped, then stretched to its frame; shapes, lines and text in order. A page
 * without a background is paper, or transparent in a PNG, shown as checks.
 */
export const LayoutSheet = memo(function LayoutSheet({
  page,
  format,
  sources,
  pictures,
  size,
  label,
}: {
  page: LayoutPage;
  format: LayoutFormat;
  /** By the plan's source numbers. */
  sources: readonly SheetSource[];
  pictures: LayoutPictures;
  size: PictureSize;
  label: string;
}) {
  const clear = !page.background && format === 'png';
  const checks = useId();
  // drawn on the page, not the element: in the stage the element is wider or taller than the page
  const square = Math.max(page.width, page.height) / 50;
  return (
    <svg
      className={'layout-sheet' + (clear ? ' is-transparent' : '')}
      role="img"
      aria-label={label}
      viewBox={`0 0 ${page.width} ${page.height}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {clear ? (
        <>
          <defs>
            <pattern
              id={checks}
              width={square * 2}
              height={square * 2}
              patternUnits="userSpaceOnUse"
            >
              <rect width={square * 2} height={square * 2} fill="#ffffff" />
              <rect width={square} height={square} fill="#d9dce1" />
              <rect x={square} y={square} width={square} height={square} fill="#d9dce1" />
            </pattern>
          </defs>
          <rect width={page.width} height={page.height} fill={`url("#${checks}")`} />
        </>
      ) : (
        <rect width={page.width} height={page.height} fill={page.background ?? '#ffffff'} />
      )}
      {page.items.map((item, index) => (
        <SheetItem key={index} item={item} sources={sources} pictures={pictures} size={size} />
      ))}
    </svg>
  );
});

function SheetItem({
  item,
  sources,
  pictures,
  size,
}: {
  item: LayoutItem;
  sources: readonly SheetSource[];
  pictures: LayoutPictures;
  size: PictureSize;
}) {
  switch (item.kind) {
    case 'image':
    case 'page': {
      const source = sources[item.source];
      return source ? (
        <SheetPicture item={item} source={source} pictures={pictures} size={size} />
      ) : null;
    }
    case 'rect':
      // neither fill nor stroke draws nothing
      return item.fill || item.stroke ? <rect {...item.frame} {...paint(item)} /> : null;
    case 'path': {
      if (!item.fill && !item.stroke) return null;
      const points: string[] = [];
      for (let index = 0; index < item.points.length; index += 2)
        points.push(`${item.points[index]},${item.points[index + 1]}`);
      const Shape = item.closed ? 'polygon' : 'polyline';
      return (
        <Shape points={points.join(' ')} {...paint(item)} strokeDasharray={item.dash?.join(' ')} />
      );
    }
    case 'text': {
      const line = shownLine(item);
      if (!line) return null;
      return (
        <text
          x={item.x}
          y={item.y}
          fontSize={item.size}
          fill={item.color}
          fontWeight={item.weight === 'bold' ? 700 : 400}
          textAnchor={item.align === 'center' ? 'middle' : item.align}
          fontFamily={line.font === 'helvetica' ? 'Helvetica, Arial, sans-serif' : 'sans-serif'}
          xmlSpace="preserve"
        >
          {line.text}
        </text>
      );
    }
  }
}
/** A shape's fill and stroke; a 0 line width is a hairline, one pixel at any size. */
function paint(item: Extract<LayoutItem, { kind: 'rect' | 'path' }>) {
  return {
    fill: item.fill ?? 'none',
    stroke: item.stroke ?? 'none',
    strokeWidth: item.lineWidth || 1,
    ...(item.lineWidth ? {} : { vectorEffect: 'non-scaling-stroke' as const }),
  };
}

/** Where a picture of `size` lands once turned clockwise by `rotate`. */
function turning(size: Size, rotate: PictureItem['rotate']): string | undefined {
  switch (rotate) {
    case 0:
      return undefined;
    case 90:
      return `translate(${size.height} 0) rotate(90)`;
    case 180:
      return `translate(${size.width} ${size.height}) rotate(180)`;
    case 270:
      return `translate(0 ${size.width}) rotate(270)`;
  }
}

function SheetPicture({
  item,
  source,
  pictures,
  size,
}: {
  item: PictureItem;
  source: SheetSource;
  pictures: LayoutPictures;
  size: PictureSize;
}) {
  const page = item.kind === 'page' ? item.page : undefined;
  const url = usePicture(pictures, source.path, page, size);
  const natural = source.size(page);
  const shown = turned(natural, item.rotate);
  const { crop, frame } = item;
  return (
    <svg
      {...frame}
      viewBox={`${crop.x * shown.width} ${crop.y * shown.height} ${crop.width * shown.width} ${crop.height * shown.height}`}
      preserveAspectRatio="none"
      data-source={item.source}
      data-page={page}
    >
      {url ? (
        <image
          href={url}
          width={natural.width}
          height={natural.height}
          preserveAspectRatio="none"
          transform={turning(natural, item.rotate)}
        />
      ) : (
        <rect width={shown.width} height={shown.height} className="layout-placeholder" />
      )}
    </svg>
  );
}
