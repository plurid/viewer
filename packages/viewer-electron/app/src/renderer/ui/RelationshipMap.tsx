import { useId } from 'react';
import type { FileRelation } from '../../domain/relationships';
import { relationshipBasis } from './relationship-labels';
const name = (file: string) => file.split('/').pop() ?? file;
const parent = (file: string) => file.split('/').slice(-3, -1).join('/') || '/';
const shorten = (value: string) => (value.length > 30 ? value.slice(0, 27) + '…' : value);
const shortenParent = (value: string) =>
  value.length > 30 ? value.slice(0, 7) + '…' + value.slice(-22) : value;
/** A bounded diagram supplements the full paged relationship list. */
export function RelationshipMap({
  file,
  relations,
  select,
}: {
  file: string;
  relations: readonly FileRelation[];
  select(file: string): void;
}) {
  const marker = 'relation-arrow-' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const others = [
    ...new Set(relations.flatMap((relation) => [relation.from.path, relation.to.path])),
  ]
    .filter((path) => path !== file)
    .slice(0, 20);
  const incoming = others.filter((path) =>
    relations.some((relation) => relation.from.path === path && relation.to.path === file),
  );
  const outgoing = others.filter((path) => !incoming.includes(path));
  const rows = Math.max(incoming.length, outgoing.length, 1);
  const positions = new Map([
    [file, { x: 320, y: 24 + Math.min(rows - 1, 4) * 36 }],
    ...incoming.map((path, index) => [path, { x: 20, y: 28 + index * 72 }] as const),
    ...outgoing.map((path, index) => [path, { x: 620, y: 28 + index * 72 }] as const),
  ]);
  const height = rows * 72 + 36;
  const links = relations
    .filter(
      (relation) =>
        relation.from.path !== relation.to.path &&
        positions.has(relation.from.path) &&
        positions.has(relation.to.path),
    )
    .slice(0, 100);
  return (
    <div className="relationship-map">
      <svg
        width="900"
        height={height}
        viewBox={'0 0 900 ' + height}
        role="img"
        aria-label="Related files diagram"
      >
        <defs>
          <marker
            id={marker}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted)" />
          </marker>
        </defs>
        {links.map((relation) => {
          const from = positions.get(relation.from.path),
            to = positions.get(relation.to.path);
          if (!from || !to || from === to) return null;
          const right = from.x < to.x;
          return (
            <path
              key={relation.id}
              d={`M ${from.x + (right ? 240 : 0)} ${from.y + 24} L ${to.x + (right ? 0 : 240)} ${to.y + 24}`}
              fill="none"
              stroke="var(--muted)"
              strokeWidth="1"
              strokeDasharray={relation.basis === 'inferred' ? '4 4' : undefined}
              markerEnd={`url(#${marker})`}
            />
          );
        })}
        {[...positions].map(([path, point]) => (
          <g key={path} transform={`translate(${point.x} ${point.y})`}>
            <rect
              width="240"
              height="48"
              rx="5"
              fill={path === file ? 'var(--selection)' : 'var(--field)'}
              stroke="var(--line)"
            />
            <title>{path}</title>
            <text x="12" y="20" fill="var(--ink)">
              {shorten(name(path))}
            </text>
            <text
              x="12"
              y="37"
              fill={path === file ? 'var(--selection-muted)' : 'var(--muted)'}
              fontSize="11"
            >
              {shortenParent(parent(path))}
            </text>
          </g>
        ))}
      </svg>
      <ul className="relationship-map-links" aria-label="Diagram relationships">
        {links.map((relation) => (
          <li key={relation.id}>
            <div>
              <strong>{relation.kind}</strong>
              <span className="muted">{relationshipBasis[relation.basis]}</span>
            </div>
            <small>
              From {parent(relation.from.path)}/{name(relation.from.path)} to{' '}
              {parent(relation.to.path)}/{name(relation.to.path)}
            </small>
          </li>
        ))}
      </ul>
      <div className="settings-actions" aria-label="Explore diagram files">
        {others.map((path) => (
          <button key={path} title={path} onClick={() => select(path)}>
            {name(path)}
            <small>{parent(path)}</small>
          </button>
        ))}
      </div>
      {relations.some((relation) => relation.basis === 'inferred') && (
        <p className="muted">Dashed links are inferred.</p>
      )}
      {others.length === 20 && (
        <p className="muted">
          Diagram shows up to 20 related files. The list includes every retained relationship.
        </p>
      )}
    </div>
  );
}
