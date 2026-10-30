import type { CheckSource, RenderedPage } from '../../domain/fabrication/check';
import { checkLimits } from '../../domain/fabrication/check';
import { sameSourceVersion, sourceVersion } from '../../domain/files/inspection';
import { errorMessage } from '../../domain/errors';
import { openLayoutDocument } from '../layout/pdf';

/**
 * A CHECK'S DRAWING PAGES: each drawing of the job drawn with pdf.js, as the Layout plane draws its
 * pages, at `checkLimits.pageSide` pixels on the longer side, with its text runs and their boxes.
 * A drawing is drawn only while it is the version the check listed; the desktop checks it again.
 */
export async function drawCheckPages(
  sources: readonly CheckSource[],
  signal: AbortSignal,
  progress: (detail: string) => void = () => {},
): Promise<{ pages: RenderedPage[]; problems: string[] }> {
  const pages: RenderedPage[] = [];
  const problems: string[] = [];
  let left: number = checkLimits.pages;
  for (const source of sources) {
    if (source.kind !== 'drawing') continue;
    if (!left) {
      problems.push(`${source.name}: the check sends at most ${checkLimits.pages} pages.`);
      continue;
    }
    signal.throwIfAborted();
    progress(`Reading ${source.name}`);
    let opened: Awaited<ReturnType<typeof openLayoutDocument>>;
    try {
      opened = await openLayoutDocument(source.path, signal);
    } catch (error) {
      signal.throwIfAborted();
      problems.push(`${source.name}: ${errorMessage(error)}`);
      continue;
    }
    try {
      if (!sameSourceVersion(sourceVersion(opened.entry), source.version))
        throw new Error(`${source.name} changed since the check listed it. Check the job again.`);
      const count = opened.pages.length;
      for (let page = 1; page <= count && left > 0; page++, left--) {
        signal.throwIfAborted();
        progress(
          count === 1
            ? `Drawing ${source.name}`
            : `Drawing page ${page} of ${count} of ${source.name}`,
        );
        const drawn = await opened.drawing(page, checkLimits.pageSide);
        pages.push({
          ref: source.ref,
          version: source.version,
          page,
          pages: count,
          width: drawn.width,
          height: drawn.height,
          image: drawn.data,
          text: await opened.text(page, checkLimits.pageItems),
        });
      }
    } finally {
      opened.close();
    }
  }
  return { pages, problems };
}
