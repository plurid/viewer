import { expect, it } from 'vitest';
import { indexedCoverage } from '../src/domain/search/coverage';
import type { IndexedResult, IndexStatus } from '../src/domain/services';

function result(roots: IndexStatus['roots'], extra: Partial<IndexedResult> = {}): IndexedResult {
  return {
    entries: [],
    more: false,
    indexed: true,
    status: { roots, running: roots.some((root) => root.status === 'indexing'), count: 4 },
    ...extra,
  };
}
const ready = { path: '/Books', status: 'ready', count: 4, errors: 0 } as const;

it('does not confuse pagination or unrelated indexing with incomplete coverage', () => {
  const coverage = indexedCoverage(
    result([ready, { ...ready, path: '/Pictures', status: 'indexing' }], { more: true }),
    { root: '/Books' },
    [],
  );
  expect(coverage.state).toBe('complete');
  expect(coverage.roots).toEqual([ready]);
});
it.each(['indexing', 'paused', 'offline'] as const)('reports %s as partial', (status) => {
  expect(indexedCoverage(result([{ ...ready, status }]), { root: '/Books' }, []).state).toBe(
    'partial',
  );
});
it('distinguishes a candidate limit from additional result pages', () => {
  const coverage = indexedCoverage(result([ready], { scanLimited: true }), { root: '/Books' }, []);
  expect(coverage.state).toBe('partial');
  expect(coverage.reasons.join(' ')).toContain('20,000');
});
it('identifies unsupported text coverage and grants narrower than the requested folder', () => {
  const coverage = indexedCoverage(result([ready]), { root: '/Books', content: true }, [
    '/Books/Some',
  ]);
  expect(coverage.reasons.join(' ')).toContain('not enabled for every location');
  expect(coverage.reasons.join(' ')).toContain('without OCR');
  expect(
    indexedCoverage(result([ready]), { root: '/Books/Some', content: true }, ['/Books']).reasons,
  ).toHaveLength(1);
});
it('reports missing locations and read errors, with path boundaries', () => {
  expect(indexedCoverage(result([ready]), { root: '/Bookshelf' }, []).state).toBe('unavailable');
  expect(indexedCoverage(result([{ ...ready, errors: 1 }]), {}, []).state).toBe('partial');
});
