import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SavedState } from '../src/domain/contracts';
import type { FolderVisitSave } from '../src/domain/files/folder-visit-changes';
import type { FileChange } from '../src/domain/files/changes';
import {
  mergeFolderVisits,
  recordVisit,
  remapFolderVisits,
} from '../src/domain/files/folder-visits';
import { WorkspaceSessions } from '../src/desktop/windows/workspace-sessions';
import { FolderVisitSync } from '../src/renderer/state/folder-visits';

const now = Date.UTC(2026, 10, 1, 12);
const path = '/fixtures/daily';
beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(now));
afterEach(() => vi.restoreAllMocks());

function setup() {
  const sessions = new WorkspaceSessions();
  const ids = [sessions.create('/fixtures', 'First'), sessions.create('/fixtures', 'Second')];
  const windows = ids.map((workspace, index) => {
    const saved = sessions.open(index + 1, '/fixtures', workspace);
    const sync = new FolderVisitSync();
    sync.reset(saved.visits ?? {});
    return { owner: index + 1, saved, sync };
  });
  const [a, b] = windows;
  type WindowState = (typeof windows)[number];
  const visit = (window: WindowState, destination = path) => {
    window.saved.visits = recordVisit(window.saved.visits ?? {}, destination, now);
  };
  const clear = (window: WindowState) => {
    window.sync.clear();
    window.saved.visits = {};
    window.saved.recents = [];
  };
  const begin = (window: WindowState) => ({
    state: structuredClone(window.saved),
    metadata: window.sync.begin(window.saved.visits ?? {}, window.saved.recents),
  });
  const finish = (window: WindowState, sent: { state: SavedState; metadata: FolderVisitSave }) => {
    const merged = sessions.save(window.owner, sent.state, sent.metadata);
    for (const peer of windows) {
      peer.saved.recents = peer.sync.recentFolders(
        merged.recents,
        peer.saved.recents,
        sent.metadata.id,
        sessions.folderHistory().clearRevision,
      );
      peer.saved.visits = peer.sync.receive(
        merged.visits ?? {},
        peer.saved.visits ?? {},
        sent.metadata.id,
        sessions.folderHistory().revision,
        sessions.folderHistory().clearRevision,
      );
    }
    window.saved.visits = window.sync.complete(
      sent.metadata.id,
      merged.visits ?? {},
      window.saved.visits ?? {},
      sessions.folderHistory().revision,
      sessions.folderHistory().clearRevision,
    );
  };
  const remap = (changes: FileChange[]) => {
    sessions.remapFolderHistory(changes);
    for (const peer of windows) {
      peer.sync.remap(changes, sessions.folderHistory().revision);
      peer.saved.visits = remapFolderVisits(peer.saved.visits ?? {}, changes);
    }
  };
  return { sessions, a: a!, b: b!, visit, clear, begin, finish, remap };
}

it('retains concurrent and post-send increments without contributing received totals again', () => {
  const { sessions, a, b, visit, begin, finish } = setup();
  visit(a);
  visit(a);
  visit(b);
  const first = begin(a);
  const second = begin(b);
  finish(a, first);
  expect(b.saved.visits?.[path]?.count).toBe(3);
  visit(b);
  finish(b, second);
  expect(a.saved.visits?.[path]?.count).toBe(3);
  expect(b.saved.visits?.[path]?.count).toBe(4);
  finish(a, begin(a));
  expect(sessions.snapshot()?.visits?.[path]?.count).toBe(3);
  finish(b, begin(b));
  expect(sessions.snapshot()?.visits?.[path]?.count).toBe(4);
  finish(a, begin(a));
  finish(b, begin(b));
  expect(sessions.snapshot()?.visits?.[path]?.count).toBe(4);
});

it('retains unsaved visits on a foreign broadcast before beginning a save', () => {
  const { sessions, a, b, visit, begin, finish } = setup();
  visit(a);
  visit(b);
  finish(a, begin(a));
  expect(b.saved.visits?.[path]?.count).toBe(2);
  finish(b, begin(b));
  expect(sessions.snapshot()?.visits?.[path]?.count).toBe(2);
});

it('clears unseen peer folders and counts a revisit from zero, including after a failed save', () => {
  const { sessions, a, b, visit, clear, begin, finish } = setup();
  for (let index = 0; index < 10; index++) visit(a);
  finish(a, begin(a));
  clear(a);
  visit(a);
  visit(b, '/fixtures/peer');
  b.saved.recents = ['/fixtures/peer'];
  finish(b, begin(b));
  expect(a.saved.visits).toEqual({ [path]: { count: 1, last: now } });
  const failed = begin(a);
  a.sync.failed(failed.metadata.id);
  finish(a, begin(a));
  expect(sessions.snapshot()?.visits).toEqual({ [path]: { count: 1, last: now } });
  expect(sessions.snapshot()?.recents).toEqual([]);
  finish(b, begin(b));
  expect(sessions.snapshot()?.visits).toEqual({ [path]: { count: 1, last: now } });
});

it('keeps a clear and revisit made while an earlier increment is being saved', () => {
  const { sessions, a, visit, clear, begin, finish } = setup();
  visit(a);
  const sent = begin(a);
  clear(a);
  visit(a);
  finish(a, sent);
  expect(a.saved.visits?.[path]?.count).toBe(1);
  finish(a, begin(a));
  expect(sessions.snapshot()?.visits?.[path]?.count).toBe(1);
});

it('does not acknowledge a second clear when the first clear finishes', () => {
  const { sessions, a, b, visit, clear, begin, finish } = setup();
  visit(a);
  finish(a, begin(a));
  clear(a);
  visit(a);
  const sent = begin(a);
  clear(a);
  visit(b, '/fixtures/peer');
  finish(b, begin(b));
  expect(a.saved.visits).toEqual({});
  finish(a, sent);
  expect(a.saved.visits).toEqual({});
  expect(a.sync.clearing).toBe(true);
  finish(a, begin(a));
  expect(sessions.snapshot()?.visits).toEqual({});
  expect(a.sync.clearing).toBe(false);
});

it('does not restore old visits from an unchanged snapshot sent before a peer cleared them', () => {
  const { sessions, a, b, visit, clear, begin, finish } = setup();
  visit(a);
  finish(a, begin(a));
  const stale = begin(b);
  clear(a);
  finish(a, begin(a));
  finish(b, stale);
  expect(sessions.snapshot()?.visits).toEqual({});
});

it('keeps a clear ahead of a peer snapshot already in flight, including recents', () => {
  const { sessions, a, b, visit, clear, begin, finish } = setup();
  visit(a);
  a.saved.recents = [path];
  finish(a, begin(a));
  visit(b, '/fixtures/old-peer');
  b.saved.recents = ['/fixtures/old-peer', path];
  const sent = begin(b);
  clear(a);
  finish(a, begin(a));
  finish(b, sent);
  expect(sessions.snapshot()?.recents).toEqual([]);
  expect(sessions.snapshot()?.visits).toEqual({});
  expect(a.saved.recents).toEqual([]);
  expect(b.saved.recents).toEqual([]);
  finish(b, begin(b));
  expect(sessions.snapshot()?.recents).toEqual([]);
  visit(b, '/fixtures/new-peer');
  b.saved.recents = ['/fixtures/new-peer'];
  finish(b, begin(b));
  expect(sessions.snapshot()?.recents).toEqual(['/fixtures/new-peer']);
  expect(sessions.snapshot()?.visits?.['/fixtures/new-peer']?.count).toBe(1);
});

it('refreshes a very old snapshot with bounded replay, then saves its remapped visits exactly', () => {
  const { sessions, a, visit, begin, remap } = setup();
  visit(a);
  const sent = begin(a);
  for (let index = 0; index < 1000; index++)
    remap([
      {
        source: index % 2 ? '/fixtures/renamed' : path,
        destination: index % 2 ? path : '/fixtures/renamed',
      },
    ]);
  expect(() => sessions.save(a.owner, sent.state, sent.metadata)).toThrow(
    'Retry with the current folders.',
  );
  a.sync.failed(sent.metadata.id);
  const fresh = begin(a);
  const merged = sessions.save(a.owner, fresh.state, fresh.metadata);
  expect(merged.visits).toEqual({ [path]: { count: 1, last: now } });
});

it('keeps navigation after a response-only acknowledgement and retries unacknowledged failures', () => {
  const { sessions, a, visit, begin, finish } = setup();
  visit(a);
  const sent = begin(a);
  visit(a);
  const merged = sessions.save(a.owner, sent.state, sent.metadata);
  a.saved.visits = a.sync.complete(sent.metadata.id, merged.visits ?? {}, a.saved.visits ?? {});
  expect(a.saved.visits?.[path]?.count).toBe(2);
  a.sync.failed(sent.metadata.id);
  const failed = begin(a);
  a.sync.failed(failed.metadata.id);
  finish(a, begin(a));
  expect(sessions.snapshot()?.visits?.[path]?.count).toBe(2);
});

it('remaps shared history once, retaining visits submitted before and after a rename', () => {
  const { sessions, a, b, visit, begin, finish, remap } = setup();
  for (let index = 0; index < 4; index++) visit(a);
  finish(a, begin(a));
  visit(a);
  visit(b);
  const first = begin(a);
  const second = begin(b);
  const destination = '/fixtures/renamed';
  remap([{ source: path, destination }]);
  visit(a, destination);
  finish(a, first);
  finish(b, second);
  expect(b.saved.visits).toEqual({ [destination]: { count: 6, last: now } });
  expect(a.saved.visits?.[destination]?.count).toBe(7);
  finish(a, begin(a));
  finish(b, begin(b));
  expect(sessions.snapshot()?.visits).toEqual({ [destination]: { count: 7, last: now } });
});

it('handles simultaneous rename cycles without swapping history again in a peer save', () => {
  const { sessions, a, b, visit, begin, finish, remap } = setup();
  visit(a);
  visit(a);
  visit(a, '/fixtures/other');
  finish(a, begin(a));
  remap([
    { source: path, destination: '/fixtures/other' },
    { source: '/fixtures/other', destination: path },
  ]);
  finish(a, begin(a));
  finish(b, begin(b));
  expect(sessions.snapshot()?.visits).toEqual({
    [path]: { count: 1, last: now },
    '/fixtures/other': { count: 2, last: now },
  });
});

it('remaps an older acknowledgement without losing navigation after that save', () => {
  const { sessions, a, visit, begin, remap } = setup();
  visit(a);
  const sent = begin(a);
  const merged = sessions.save(a.owner, sent.state, sent.metadata);
  const destination = '/fixtures/renamed';
  remap([{ source: path, destination }]);
  visit(a, destination);
  a.saved.visits = a.sync.complete(sent.metadata.id, merged.visits ?? {}, a.saved.visits ?? {}, 0);
  expect(a.saved.visits).toEqual({ [destination]: { count: 2, last: now } });
});

it('persists a rename that arrives during the durable write before acknowledging it', async () => {
  const { sessions, a, visit, begin, remap } = setup();
  visit(a);
  const sent = begin(a);
  const destination = '/fixtures/renamed';
  const writes: SavedState[] = [];
  await sessions.persist(
    a.owner,
    sent.state,
    async (state) => {
      writes.push(state);
      if (writes.length === 1) remap([{ source: path, destination }]);
    },
    sent.metadata,
  );
  expect(writes).toHaveLength(2);
  expect(writes[1]?.visits).toEqual({ [destination]: { count: 1, last: now } });
  expect(sessions.snapshot()?.visits).toEqual(writes[1]?.visits);
});

it('merges restored history by maximum while retaining new visits after the restore', () => {
  const { sessions, a, b, visit, begin, finish } = setup();
  const restored = { [path]: { count: 10, last: now } };
  for (const peer of [a, b]) {
    peer.sync.restore(restored);
    peer.saved.visits = mergeFolderVisits(peer.saved.visits ?? {}, restored, now);
  }
  finish(a, begin(a));
  expect(b.saved.visits?.[path]?.count).toBe(10);
  visit(b);
  finish(b, begin(b));
  expect(sessions.snapshot()?.visits?.[path]?.count).toBe(11);
});
