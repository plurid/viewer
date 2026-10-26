import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import type { WordInline, WordParagraph, WordTable } from '../../domain/previews/documents/office';
import type { Resource } from '../../domain/contracts';
import type { PreviewContext } from './contracts';
import { errorMessage } from '../../domain/errors';
type Image = Extract<WordInline, { kind: 'image' }>;
function WordImage({ image, context }: { image: Image; context: PreviewContext }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false),
    [resource, setResource] = useState<Resource>(),
    [error, setError] = useState('');
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { root: element.closest('.office-document-scroll'), rootMargin: '240px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { services } = context;
  useEffect(() => {
    setResource(undefined);
    if (!visible || !context.active || !image.part || image.warning) return;
    let live = true,
      owned: Resource | undefined;
    const requestID = crypto.randomUUID();
    setError('');
    void services
      .officeImage(context.resource.id, image.part, requestID)
      .then((value) => {
        if (!live) {
          void services.release(value.id);
          return;
        }
        owned = value;
        setResource(value);
      })
      .catch((value) => {
        if (live) setError(errorMessage(value));
      });
    return () => {
      live = false;
      void services.cancelDocument(context.resource.id, requestID);
      if (owned) void services.release(owned.id);
    };
  }, [visible, context.active, context.resource.id, services, image.part, image.warning]);
  const warning = image.warning || error;
  return (
    <span className="office-inline-image" ref={ref}>
      {warning ? (
        <span
          className="office-image-placeholder"
          role="img"
          aria-label={image.alt + '. ' + warning}
        >
          <strong>{image.alt}</strong>
          <small>{warning}</small>
        </span>
      ) : resource ? (
        <img
          src={resource.url}
          alt={image.alt}
          width={image.width ? Math.round(image.width) : undefined}
          onError={() => setError('This embedded image could not be decoded.')}
        />
      ) : (
        <span className="office-image-placeholder" role="status" aria-label={image.alt}>
          Reading embedded image…
        </span>
      )}
    </span>
  );
}
function Inlines({ items, context }: { items: readonly WordInline[]; context: PreviewContext }) {
  return (
    <>
      {items.map((item, index) =>
        item.kind === 'text' ? item.text : <WordImage key={index} image={item} context={context} />,
      )}
    </>
  );
}
export function WordBlock({
  block,
  context,
}: {
  block: WordParagraph | WordTable;
  context: PreviewContext;
}) {
  const media = useMemo(
    () =>
      new Map(
        block.kind === 'table'
          ? (block.media?.map((cell) => [cell.row + ':' + cell.column, cell.inlines]) ?? [])
          : [],
      ),
    [block],
  );
  if (block.kind === 'paragraph')
    return createElement(
      block.heading ? 'h' + block.heading : 'p',
      {},
      block.inlines ? <Inlines items={block.inlines} context={context} /> : block.text || '\u00a0',
    );
  return (
    <div className="office-table-scroll">
      <table>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => {
                const items = media.get(r + ':' + c);
                return (
                  <td key={c}>{items ? <Inlines items={items} context={context} /> : cell}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
