import { describe, expect, it } from 'vitest';
import type { FolderVisits } from '../src/domain/files/folder-visits';
import {
  boundFolderVisits,
  frecencyScore,
  mergeFolderVisits,
  rankFrecent,
  recordVisit,
} from '../src/domain/files/folder-visits';
import { WorkspaceSessions, mergeChanged } from '../src/desktop/windows/workspace-sessions';
import { restoreBackupState } from '../src/desktop/persistence/backup-state';
import { stateSchema } from '../src/desktop/persistence/storage';
import { agentCommandID } from '../src/domain/agents/safety';
import type { SavedState } from '../src/domain/contracts';

function visitSaver(sessions: WorkspaceSessions) {
  const baselines = new Map<number, FolderVisits>();
  return (owner: number, state: SavedState, clear = false) => {
    const base = baselines.get(owner) ?? {};
    const merged = sessions.save(owner, state, {
      id: crypto.randomUUID(),
      base,
      clear,
      restored: {},
      revision: sessions.folderHistory().revision,
      clearRevision: sessions.folderHistory().clearRevision,
    });
    baselines.set(owner, structuredClone(state.visits ?? {}));
    return merged;
  };
}

const now = Date.UTC(2026, 10, 1, 12);
const day = 86_400_000;

describe('folder visit ranking', () => {
  it('gives daily use priority over a one-off yesterday, then decays over months', () => {
    const daily = { count: 30, last: now - day };
    const once = { count: 1, last: now - day };
    expect(frecencyScore(daily, now)).toBeGreaterThan(frecencyScore(once, now));
    expect(frecencyScore({ ...daily, last: now - 180 * day }, now)).toBeLessThan(
      frecencyScore(once, now),
    );
    expect(frecencyScore({ count: 7, last: now }, now)).toBe(3);
    expect(frecencyScore({ count: 7, last: now - 30 * day }, now)).toBe(1.5);
    expect(frecencyScore({ count: 7, last: now + day }, now)).toBe(3);
  });

  it('matches names, parent fragments, accents and near misses with the shared name matcher', () => {
    const visits = {
      '/fixtures/Design/Drafts': { count: 30, last: now - day },
      '/fixtures/Documents': { count: 1, last: now },
      '/fixtures/Café': { count: 2, last: now },
    };
    expect(rankFrecent(visits, '', now)[0]).toBe('/fixtures/Design/Drafts');
    expect(rankFrecent(visits, 'design', now)).toContain('/fixtures/Design/Drafts');
    expect(rankFrecent(visits, 'documetns', now)).toEqual(['/fixtures/Documents']);
    expect(rankFrecent(visits, 'cafe', now)).toEqual(['/fixtures/Café']);
    expect(rankFrecent(visits, 'design dra', now)).toEqual(['/fixtures/Design/Drafts']);
    const deep = '/fixtures/' + 'long/'.repeat(200) + 'Documents';
    expect(rankFrecent({ [deep]: visits['/fixtures/Documents'] }, 'documents', now)).toEqual([
      deep,
    ]);
  });

  it('counts, bounds by score, and refuses virtual and physical Trash locations', () => {
    let visits: FolderVisits = { '/fixtures/daily': { count: 100, last: now - day } };
    for (let index = 0; index < 510; index++)
      visits = recordVisit(visits, `/fixtures/${index}`, now + index);
    expect(Object.keys(visits)).toHaveLength(500);
    expect(visits['/fixtures/daily']?.count).toBe(100);
    expect(visits['/fixtures/0']).toBeUndefined();
    visits = recordVisit(visits, '/fixtures/daily', now + 600);
    expect(visits['/fixtures/daily']).toEqual({ count: 101, last: now + 600 });
    for (const path of [
      'viewer://trash',
      'archive://fixture.zip/folder',
      'relative/folder',
      '/fixtures/.Trash/old',
      '/Volumes/Fixture/.Trashes/501/old',
      '/fixtures/.local/share/Trash/files',
    ])
      expect(recordVisit(visits, path, now), path).toBe(visits);
  });

  it('bounds merged backup history without counting the same visits twice', () => {
    expect(
      mergeFolderVisits(
        { '/fixtures/daily': { count: 8, last: now } },
        { '/fixtures/daily': { count: 7, last: now - day } },
        now,
      ),
    ).toEqual({ '/fixtures/daily': { count: 8, last: now } });
    expect(boundFolderVisits({ 'viewer://trash': { count: 100, last: now } }, now)).toEqual({});
  });

  it('ranks own-name quality ahead of parent matches and drops scattered letters', () => {
    const visits = {
      '/fixtures/Downloads': { count: 1, last: now },
      '/fixtures/Downloads/Archive': { count: 1000, last: now },
      '/fixtures/deep/old/wood/nest': { count: 1000, last: now },
      '/fixtures/cold/atlas': { count: 1000, last: now },
      '/fixtures/Catalog': { count: 1, last: now },
      '/Users/example/Research': { count: 1000, last: now },
    };
    expect(rankFrecent(visits, 'down', now)).toEqual([
      '/fixtures/Downloads',
      '/fixtures/Downloads/Archive',
    ]);
    expect(rankFrecent(visits, 'cat', now)).toEqual(['/fixtures/Catalog']);
    expect(rankFrecent(visits, 'usr', now)).toEqual([]);
  });

  it('keeps a newly recorded folder at capacity so its next visit can accumulate', () => {
    const visits = Object.fromEntries(
      Array.from({ length: 500 }, (_, index) => [`/fixtures/${index}`, { count: 100, last: now }]),
    );
    const first = recordVisit(visits, '/fixtures/new', now);
    expect(Object.keys(first)).toHaveLength(500);
    expect(first['/fixtures/new']?.count).toBe(1);
    expect(recordVisit(first, '/fixtures/new/', now)['/fixtures/new']?.count).toBe(2);
  });
});

describe('shared private folder history', () => {
  it('merges concurrent increments, clears counts, and does not revive stale history', () => {
    const sessions = new WorkspaceSessions();
    const save = visitSaver(sessions);
    const first = sessions.create('/fixtures', 'First');
    const second = sessions.create('/fixtures', 'Second');
    const a = sessions.open(1, '/fixtures', first);
    const b = sessions.open(2, '/fixtures', second);
    a.visits = { '/fixtures/daily': { count: 2, last: now } };
    a.recents = ['/fixtures/daily'];
    save(1, a);
    b.visits = { '/fixtures/daily': { count: 1, last: now + 1 } };
    b.recents = ['/fixtures/daily'];
    save(2, b);
    expect(sessions.snapshot()?.visits?.['/fixtures/daily']).toEqual({ count: 3, last: now + 1 });
    expect(mergeChanged(a, sessions.snapshot()!)).toBe(true);
    a.visits = {};
    a.recents = [];
    save(1, a, true);
    save(2, b);
    expect(sessions.snapshot()?.visits).toEqual({});
    expect(sessions.snapshot()?.recents).toEqual([]);
    b.visits = { '/fixtures/daily': { count: 2, last: now + 2 } };
    save(2, b);
    expect(sessions.snapshot()?.visits?.['/fixtures/daily']?.count).toBe(1);
  });

  it('bounds overlapping windows and saves and relinks visits with recents in backups', () => {
    const sessions = new WorkspaceSessions();
    const save = visitSaver(sessions);
    const first = sessions.create('/fixtures', 'First');
    const second = sessions.create('/fixtures', 'Second');
    const a = sessions.open(1, '/fixtures', first);
    const b = sessions.open(2, '/fixtures', second);
    a.visits = Object.fromEntries(
      Array.from({ length: 300 }, (_, index) => [`/fixtures/a/${index}`, { count: 2, last: now }]),
    );
    b.visits = Object.fromEntries(
      Array.from({ length: 300 }, (_, index) => [`/fixtures/b/${index}`, { count: 1, last: now }]),
    );
    a.recents = ['/fixtures/a/0'];
    save(1, a);
    save(2, b);
    const saved = stateSchema.parse(sessions.snapshot());
    expect(Object.keys(saved.visits ?? {})).toHaveLength(500);
    const restored = restoreBackupState(saved, new Map(), [
      {
        source: '/fixtures/a',
        destination: '/restored/a',
      },
    ]);
    expect(restored.recents).toEqual(['/restored/a/0']);
    expect(restored.visits?.['/restored/a/0']).toEqual({ count: 2, last: now });
    expect(restored.visits?.['/fixtures/a/0']).toBeUndefined();
  });

  it('keeps remembered destinations outside the agent command allowlist', () => {
    expect(() => agentCommandID('location:/fixtures/private', [])).toThrow();
    expect(() => agentCommandID('smart:folder:/fixtures/private', [])).toThrow();
    expect(agentCommandID('go-to', [])).toBe('go-to');
  });
});
