import { describe, expect, it, vi } from 'vitest';
import type { DesktopEvent, ViewerAPI } from '../src/domain/contracts';
import type { JournalPage, JournalQuery } from '../src/domain/journal/events';
import { JournalSession } from '../src/renderer/journal/session';

function page(latest: number, filter = 'git'): JournalPage {
  return {
    records: latest
      ? [
          {
            version: 1,
            id: `00000000-0000-4000-8000-${String(latest).padStart(12, '0')}`,
            sessionID: '00000000-0000-4000-8000-000000000001',
            sequence: latest,
            at: 1,
            producer: 'desktop',
            source: filter === 'chat' ? 'chat' : 'git',
            action: 'status',
            phase: 'succeeded',
            level: 'info',
            origin: {},
            traceID: crypto.randomUUID(),
          },
        ]
      : [],
    through: latest,
    matched: latest,
    status: {
      generation: 'one',
      latest,
      stored: latest,
      bytes: 100,
      byteLimit: 1000,
      recordLimit: 100,
      dropped: 0,
      state: 'ready',
    },
  };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function api(query: ViewerAPI['journalQuery']) {
  let listener: (event: DesktopEvent) => void = () => {};
  const unsubscribe = vi.fn();
  return {
    journalQuery: query,
    onEvent: (next: (event: DesktopEvent) => void) => {
      listener = next;
      return unsubscribe;
    },
    changed: () => listener({ type: 'journal-changed' }),
    unsubscribe,
  };
}

describe('Journal reader cursors', () => {
  it('holds the paused rows and cursor, reports new matches and follows only on request', async () => {
    let latest = 1;
    const ports = api(vi.fn(async () => page(latest)));
    const session = new JournalSession(ports, {});
    const close = session.connect();
    await settle();
    const rows = session.snapshot().page?.records;
    session.pause();
    latest = 3;
    ports.changed();
    await settle();
    expect(session.snapshot().page?.records).toBe(rows);
    expect(session.snapshot().page?.through).toBe(1);
    expect(session.snapshot().unseen).toBe(2);
    session.follow();
    await settle();
    expect(session.snapshot().page?.through).toBe(3);
    expect(session.snapshot().unseen).toBe(0);
    close();
    expect(ports.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('discards stale filters and disconnected results while bounding simultaneous queries', async () => {
    const pending: { query: JournalQuery; finish(value: JournalPage): void }[] = [];
    const ports = api(
      (query) => new Promise((resolve) => pending.push({ query, finish: resolve })),
    );
    const session = new JournalSession(ports, {});
    const close = session.connect();
    session.setFilter({ source: 'chat' });
    ports.changed();
    ports.changed();
    expect(pending).toHaveLength(1);
    pending[0]!.finish(page(1));
    await settle();
    expect(session.snapshot().page).toBeUndefined();
    expect(pending).toHaveLength(2);
    expect(pending[1]?.query.filter.source).toBe('chat');
    pending[1]!.finish(page(2, 'chat'));
    await settle();
    expect(session.snapshot().page?.records[0]?.source).toBe('chat');
    const previous = session.snapshot().page;
    session.setFilter({ since: 20, until: 10 });
    expect(session.snapshot().page).toBe(previous);
    expect(session.snapshot().error).toContain('previous results are kept');
    ports.changed();
    close();
    pending[2]!.finish(page(3));
    await settle();
    expect(session.snapshot().page).toBe(previous);
  });

  it('keeps useful history after a query failure and resets a cleared generation explicitly', async () => {
    const query = vi.fn<ViewerAPI['journalQuery']>().mockResolvedValue(page(1));
    const ports = api(query);
    const session = new JournalSession(ports, {});
    const close = session.connect();
    await settle();
    session.pause();
    query.mockRejectedValueOnce(new Error('Journal temporarily offline'));
    ports.changed();
    await settle();
    expect(session.snapshot().page?.records).toHaveLength(1);
    expect(session.snapshot().error).toContain('offline');
    query.mockResolvedValue({ ...page(0), status: { ...page(0).status, generation: 'new' } });
    ports.changed();
    await settle();
    expect(session.snapshot().page?.records).toEqual([]);
    close();
  });
});
