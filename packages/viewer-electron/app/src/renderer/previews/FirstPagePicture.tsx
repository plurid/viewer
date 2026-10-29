import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Resource } from '../../domain/contracts';
import type { PreviewContext } from './contracts';
import { pdfScale, pdfZoom } from './pdf-viewport';
import { carriesThumbnail, openDocumentThumbnail } from '../../domain/previews/documents/layout';

interface Size {
  width: number;
  height: number;
}
export type PagePicture = Resource & { dimensions: Size };

/**
 * The picture of its first page an OpenDocument package carries, while its layout renders. The
 * desktop checks its size, PNG signature and dimensions; a document without a usable picture
 * shows the layout's own progress. The picture is released once it is no longer wanted.
 */
export function useFirstPagePicture(
  context: PreviewContext,
  wanted: boolean,
): PagePicture | undefined {
  const { services } = context;
  const id = context.resource.id;
  const carried = carriesThumbnail(context.resource.entry.extension);
  const [picture, setPicture] = useState<{ source: string; value: PagePicture }>();
  useEffect(() => {
    if (!wanted || !carried) return;
    let live = true,
      owned: Resource | undefined;
    void services.archiveEntry(id, openDocumentThumbnail.name).then(
      (resource) => {
        if (!live || !resource.dimensions) {
          void services.release(resource.id).catch(() => {});
          return;
        }
        owned = resource;
        setPicture({ source: id, value: { ...resource, dimensions: resource.dimensions } });
      },
      // missing, oversized or not a PNG: the layout's progress shows instead
      () => {},
    );
    return () => {
      live = false;
      if (owned) void services.release(owned.id).catch(() => {});
    };
  }, [id, services, wanted, carried]);
  return wanted && picture?.source === id ? picture.value : undefined;
}

/**
 * Fitted as the layout's first page will be, in the same scroller and sheet, so the page replaces
 * it in place. A numeric zoom needs the page's own size, which only the layout has: the picture
 * fits the page then.
 */
export function FirstPagePicture({
  picture,
  state,
  label,
}: {
  picture: PagePicture;
  state: PreviewContext['state'];
  label: string;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const measure = (width: number, height: number) =>
      setAvailable((before) =>
        before.width === width && before.height === height ? before : { width, height },
      );
    // the content box, as the layout measures it, before the first paint: the picture never
    // shows unfitted or a frame late
    const style = getComputedStyle(element);
    const pixels = (value: string) => parseFloat(value) || 0;
    measure(
      element.clientWidth - pixels(style.paddingLeft) - pixels(style.paddingRight),
      element.clientHeight - pixels(style.paddingTop) - pixels(style.paddingBottom),
    );
    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const zoom = pdfZoom(state?.get('pdf.view'));
  const scale = pdfScale(picture.dimensions, available, typeof zoom === 'number' ? 'page' : zoom);
  return (
    <div className="pdf-viewer office-first-page" role="status" aria-label={label}>
      <div className="pdf-body">
        <div className="pdf-scroll" ref={scroll}>
          <div className="pdf-sheet" style={scale ? undefined : { visibility: 'hidden' }}>
            <img
              src={picture.url}
              alt=""
              draggable={false}
              style={{
                width: picture.dimensions.width * scale,
                height: picture.dimensions.height * scale,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
