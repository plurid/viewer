import { useMemo } from 'react';
import { prepareCanvasDrawing } from '../../domain/canvases/drawing';

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 });

export function DrawingResult({ content }: { content: string }) {
  const { drawing, measurement } = useMemo(() => prepareCanvasDrawing(content), [content]);
  const { min, max } = drawing.bounds;
  const width = max.x - min.x;
  const height = max.y - min.y;
  const inset = Math.max(width, height) * 0.08;
  return (
    <figure className="canvas-drawing-result">
      <svg
        role="img"
        aria-label="Cutting drawing preview"
        viewBox={`${min.x - inset} ${-max.y - inset} ${width + inset * 2} ${height + inset * 2}`}
      >
        <g transform="scale(1 -1)" fill="none" stroke="currentColor">
          {drawing.entities.map((entity) => (
            <path
              key={entity.id}
              vectorEffect="non-scaling-stroke"
              d={
                entity.points
                  .map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`)
                  .join(' ') + (entity.closed ? ' Z' : '')
              }
            />
          ))}
        </g>
      </svg>
      <figcaption>
        <strong>Drawing dimensions</strong>
        <dl>
          <div>
            <dt>Width</dt>
            <dd>{number.format(measurement.width)} mm</dd>
          </div>
          <div>
            <dt>Height</dt>
            <dd>{number.format(measurement.height)} mm</dd>
          </div>
          <div>
            <dt>Outlines</dt>
            <dd>{measurement.outlines.length}</dd>
          </div>
          <div>
            <dt>Holes</dt>
            <dd>{measurement.holes.length}</dd>
          </div>
          {measurement.holes.map((hole) => (
            <div key={hole.number}>
              <dt>Hole {hole.number}</dt>
              <dd>
                {hole.approximate ? '≈ ' : ''}Ø {number.format(hole.diameter)} mm
              </dd>
            </div>
          ))}
          {measurement.cutouts.length > 0 && (
            <div>
              <dt>Cutouts</dt>
              <dd>{measurement.cutouts.length}</dd>
            </div>
          )}
        </dl>
      </figcaption>
    </figure>
  );
}
