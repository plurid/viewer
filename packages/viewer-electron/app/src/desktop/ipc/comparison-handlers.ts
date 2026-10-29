import type { ApiHandlers } from './schemas';
import type { Comparisons } from '../comparison/comparison';
import type { Duplicates } from '../comparison/duplicates';

type ComparisonHandlers = Pick<ApiHandlers, 'compare' | 'duplicates'>;
interface ComparisonPorts {
  comparisons: Pick<Comparisons, 'run' | 'cancel'>;
  duplicates: Pick<Duplicates, 'run' | 'cancel'>;
}

/** Each run is cancelled by the ID its renderer chose for it. */
export function createComparisonHandlers(ports: ComparisonPorts): ComparisonHandlers {
  return {
    compare: ([request]) => {
      if (request.kind === 'cancel') {
        ports.comparisons.cancel(request.id);
        return null;
      }
      return ports.comparisons.run(request.id, request.left, request.right, request.hashes);
    },
    duplicates: ([request]) => {
      if (request.kind === 'cancel') {
        ports.duplicates.cancel(request.id);
        return null;
      }
      return ports.duplicates.run(request.id, request.roots);
    },
  };
}
