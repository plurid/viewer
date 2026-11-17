import type { IndexedQuery, IndexedResult } from '../../domain/services';
import { indexedCoverage } from '../../domain/search/coverage';
import { useViewer, report } from '../state/store';
import type { SearchBatch } from '../../domain/contracts';
import { Disclosure } from '../ui/Disclosure';
import { useHome } from '../ui/PathLabel';
import { pathText } from '../../domain/files/path-label';
import { plural } from '../../domain/plural';
import { statusLabel } from '../ui/status-labels';

export function SearchCoverage({
  result,
  request,
  streamed,
  cancelled,
}: {
  result?: IndexedResult;
  request: IndexedQuery;
  streamed?: Omit<SearchBatch, 'id' | 'entries'>;
  cancelled?: boolean;
}) {
  const settings = useViewer((state) => state.settings.settings.search);
  const coverage = result && indexedCoverage(result, request, settings.contentRoots);
  const home = useHome();
  return (
    <Disclosure
      variant="inline"
      className="search-coverage"
      summary={
        <>
          {request.content ? 'Names and document text' : 'Names'} ·{' '}
          {request.recursive === false ? 'This folder' : 'Including subfolders'} ·{' '}
          {cancelled
            ? 'Search stopped'
            : streamed
              ? !streamed.done
                ? 'Searching folders…'
                : streamed.errors || streamed.truncated
                  ? 'Partial coverage'
                  : 'Search finished'
              : (coverage?.summary ?? 'Searching…')}
        </>
      }
    >
      <div>
        <p>
          {request.root || 'All indexed locations'}
          {request.showHidden ? ' · Hidden files included' : ' · Hidden files excluded'}
        </p>
        {streamed && (
          <p>
            Live folder scan · {plural(streamed.visited, 'item')} checked
            {streamed.errors ? ` · ${plural(streamed.errors, 'item')} not readable` : ''}
            {streamed.truncated ? ' · Stopped at the scan limit. Narrow the query.' : ''}
          </p>
        )}
        {cancelled && <p>The search stopped before every folder was checked.</p>}
        {coverage?.roots.map((root) => (
          <p key={root.path}>
            {pathText(root.path, home)} · {plural(root.count, 'item')} indexed ·{' '}
            {statusLabel(root.status)}
            {root.errors ? ` · ${plural(root.errors, 'item')} not readable` : ''}
          </p>
        ))}
        {coverage?.reasons.map((reason) => (
          <p key={reason}>{reason}</p>
        ))}
        {result?.more && <p>More matches are available on the next page.</p>}
        <p>
          {settings.exclusions.length
            ? `Excluded names and paths: ${settings.exclusions.join(', ')}`
            : 'No configured exclusions.'}
        </p>
        <button onClick={() => void window.viewer.openSettings('search').catch(report)}>
          Search Settings…
        </button>
      </div>
    </Disclosure>
  );
}
