import type { IndexedQuery, IndexedResult } from '../../domain/services';
import { indexedCoverage } from '../../domain/search/coverage';
import { useViewer, report } from '../state/store';
import type { SearchBatch } from '../../domain/contracts';
import { Disclosure } from '../ui/Disclosure';

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
            Live folder scan · {streamed.visited.toLocaleString()} entries checked
            {streamed.errors ? ` · ${streamed.errors.toLocaleString()} unavailable` : ''}
            {streamed.truncated ? ' · Scan limit reached; narrow the query.' : ''}
          </p>
        )}
        {cancelled && <p>The search stopped before every folder was checked.</p>}
        {coverage?.roots.map((root) => (
          <p key={root.path}>
            {root.path} · {root.count.toLocaleString()} indexed · {root.status}
            {root.errors ? ` · ${root.errors.toLocaleString()} unreadable` : ''}
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
          Search settings…
        </button>
      </div>
    </Disclosure>
  );
}
