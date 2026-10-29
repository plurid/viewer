import type { IndexedQuery, IndexedResult, IndexStatus } from '../services';
import { pathContains } from '../files/paths';

export interface SearchCoverage {
  state: 'complete' | 'partial' | 'unavailable';
  summary: string;
  reasons: string[];
  roots: IndexStatus['roots'];
}

/** Coverage is scoped to this search, rather than indexing work elsewhere in the app. */
export function indexedCoverage(
  result: IndexedResult,
  request: Pick<IndexedQuery, 'root' | 'content'>,
  contentRoots: readonly string[],
): SearchCoverage {
  const roots = result.status.roots.filter(
    (root) =>
      !request.root ||
      pathContains(root.path, request.root) ||
      pathContains(request.root, root.path),
  );
  const reasons: string[] = [];
  const unavailable = !result.indexed || !roots.length;
  if (unavailable) reasons.push('This location is not in the filename index.');
  for (const root of roots) {
    if (root.status === 'indexing') reasons.push('Indexing is still in progress.');
    if (root.status === 'paused')
      reasons.push('Indexing is paused; saved results may be incomplete.');
    if (root.status === 'offline') reasons.push('An indexed location is unavailable.');
    if (root.errors) reasons.push('Some files or folders could not be read.');
  }
  if (result.scanLimited)
    reasons.push('The query reached its 20,000-candidate scan limit. Narrow the query.');
  if (request.content) {
    const locations = request.root ? [request.root] : roots.map((root) => root.path);
    if (locations.some((location) => !contentRoots.some((root) => pathContains(root, location))))
      reasons.push('Document text is not enabled for every location in this search.');
    reasons.push('Document text covers supported formats and bounded extracts, without OCR.');
  }
  const state = unavailable ? 'unavailable' : reasons.length ? 'partial' : 'complete';
  return {
    state,
    summary: unavailable
      ? 'Location not indexed'
      : roots.some((root) => root.status === 'indexing')
        ? 'Indexing in progress'
        : state === 'partial'
          ? 'Partial coverage'
          : 'Search finished',
    roots,
    reasons: [...new Set(reasons)],
  };
}
