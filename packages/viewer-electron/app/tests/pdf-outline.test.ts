import { describe, expect, it } from 'vitest';
import { resolveOutline } from '../src/renderer/previews/pdf/outline';

const reference = { num: 12, gen: 0 };
const pdf = {
  getDestination: async (name: string) => (name === 'chapter-2' ? [reference] : null),
  getPageIndex: async (ref: unknown) => {
    if (ref !== reference) throw new Error('unknown page');
    return 4;
  },
} as unknown as Parameters<typeof resolveOutline>[0];

describe('PDF outline', () => {
  it('resolves named, explicit and numeric destinations, keeping unresolvable titles', async () => {
    const entries = await resolveOutline(pdf, [
      { title: 'Chapter 1', dest: [0, { name: 'XYZ' }] },
      {
        title: 'Chapter 2',
        dest: 'chapter-2',
        items: [{ title: 'Missing', dest: 'nowhere' }],
      },
      { title: 'Web link', dest: null },
      { title: 'Broken', dest: [{ num: 99, gen: 0 }] },
    ]);
    expect(entries.map((entry) => [entry.title, entry.page])).toEqual([
      ['Chapter 1', 1],
      ['Chapter 2', 5],
      ['Web link', undefined],
      ['Broken', undefined],
    ]);
    expect(entries[1].children).toEqual([{ title: 'Missing', page: undefined, children: [] }]);
  });
  it('stops at its entry budget and depth', async () => {
    const deep = (depth: number): { title: string; dest: null; items: unknown[] } => ({
      title: 'Level ' + depth,
      dest: null,
      items: depth < 30 ? [deep(depth + 1)] : [],
    });
    let entries = await resolveOutline(pdf, [deep(0)] as never);
    let levels = 0;
    while (entries.length) {
      levels++;
      entries = entries[0].children;
    }
    expect(levels).toBe(13);
    const wide = Array.from({ length: 3000 }, (_, index) => ({ title: 'T' + index, dest: null }));
    expect(await resolveOutline(pdf, wide)).toHaveLength(2000);
  });
});
