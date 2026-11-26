// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editLens, useLenses } from '../src/renderer/state/lenses';
import { initialize } from '../src/renderer/state/workspaces';
import { getState } from '../src/renderer/state/core';
import {
  flushState,
  flushWindowDocuments,
  resetPersistence,
} from '../src/renderer/state/persistence';
import { queuePreference, resetPreferences } from '../src/renderer/state/preferences';
import type { LensDocument, LensFolder } from '../src/domain/files/lenses';

function makeDoc(file: string, id: string): LensDocument {
  return {
    file,
    revision: '1',
    writable: true,
    local: true,
    repairs: [],
    lens: {
      version: 1,
      kind: 'viewer-lens',
      id,
      name: id,
      order: 0,
      groups: [{ id: 'g1111', name: 'Group 1', order: 0 }],
      members: [],
    },
  };
}

function Harness({ folder }: { folder: string }) {
  useLenses(folder);
  return null;
}

describe('lens persistence durability', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      root.unmount();
      vi.clearAllTimers();
    });
    container.remove();
    resetPreferences();
    resetPersistence();
    vi.useRealTimers();
  });

  it.each(['workspace', 'protected layout'])(
    'drains lens and preference edits before closing a %s',
    async (kind) => {
      const folder = '/work/lens-flush';
      const docA = makeDoc('a.json', '11111111-1111-4111-8111-111111111111');
      const applied: string[] = [];
      const settingsPatch = vi.fn(async () => ({
        ...getState().settings,
        revision: getState().settings.revision + 1,
      }));
      Object.assign(window, {
        viewer: {
          save: vi.fn(async () => {}),
          settingsPatch,
          onEvent: vi.fn(() => () => {}),
          watch: vi.fn(async () => {}),
          unwatch: vi.fn(async () => {}),
          lens: vi.fn(async (req: { kind: string; file?: string }) => {
            if (req.kind === 'list')
              return {
                folder,
                lenses: [docA],
                collapsed: {},
                broken: [],
                shared: false,
              } satisfies LensFolder;
            if (req.kind === 'apply' && req.file) {
              applied.push(req.file);
              return { document: docA, dropped: [] };
            }
            return {};
          }),
        },
      });
      initialize({
        home: '/fixtures',
        platform: 'darwin',
        state: null,
        locations: [],
        openPaths: [],
      });
      await act(async () => {
        root.render(<Harness folder={folder} />);
        await Promise.resolve();
      });

      await act(async () => {
        queuePreference('ui.space.grid', false);
        editLens(
          folder,
          'a.json',
          [{ kind: 'set-group', group: { id: 'g1111', name: 'Renamed A', order: 0 } }],
          'Rename',
        );
        if (kind === 'protected layout') await flushWindowDocuments();
        else await flushState(false);
      });

      expect(window.viewer.save).toHaveBeenCalledTimes(kind === 'protected layout' ? 0 : 1);
      expect(settingsPatch).toHaveBeenCalledTimes(1);
      expect(applied).toContain('a.json');
    },
  );

  it('preserves queued sibling lens edits when a folder unmounts while another lens finishes saving', async () => {
    const folder = '/work/lens-unmount';
    const docA = makeDoc('a.json', '11111111-1111-4111-8111-111111111111');
    const docB = makeDoc('b.json', '22222222-2222-4222-8222-222222222222');
    const applied: string[] = [];
    let releaseA!: () => void;

    Object.assign(window, {
      viewer: {
        save: vi.fn(async () => {}),
        onEvent: vi.fn(() => () => {}),
        watch: vi.fn(async () => {}),
        unwatch: vi.fn(async () => {}),
        lens: vi.fn(async (req: { kind: string; folder?: string; file?: string }) => {
          if (req.kind === 'list')
            return {
              folder,
              lenses: [docA, docB],
              collapsed: {},
              broken: [],
              shared: false,
            } satisfies LensFolder;
          if (req.kind === 'apply' && req.folder === folder && req.file === 'a.json') {
            applied.push('a.json');
            await new Promise<void>((resolve) => {
              releaseA = resolve;
            });
            return { document: docA, dropped: [] };
          }
          if (req.kind === 'apply' && req.folder === folder && req.file === 'b.json') {
            applied.push('b.json');
            return { document: docB, dropped: [] };
          }
          return {};
        }),
      },
    });
    initialize({
      home: '/fixtures',
      platform: 'darwin',
      state: null,
      locations: [],
      openPaths: [],
    });
    await act(async () => {
      root.render(<Harness folder={folder} />);
      await Promise.resolve();
    });

    await act(async () => {
      editLens(
        folder,
        'a.json',
        [{ kind: 'set-group', group: { id: 'g1111', name: 'Renamed A', order: 0 } }],
        'Rename',
      );
      vi.advanceTimersByTime(130);
    });
    expect(applied).toEqual(['a.json']);

    await act(async () => {
      editLens(
        folder,
        'b.json',
        [{ kind: 'set-group', group: { id: 'g1111', name: 'Renamed B', order: 0 } }],
        'Rename',
      );
      root.render(null);
    });

    await act(async () => {
      releaseA();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(130);
    });

    expect(applied).toEqual(['a.json', 'b.json']);
  });

  it('rejects flushState when a lens save fails, skips list on unmounted folders, and awaits in-flight applies', async () => {
    const folder = '/work/lens-errors';
    const docA = makeDoc('a.json', '11111111-1111-4111-8111-111111111111');
    let listCalls = 0;
    let failNext = true;
    let releaseInFlight!: () => void;
    let holdInFlight = false;
    const applied: string[] = [];

    Object.assign(window, {
      viewer: {
        save: vi.fn(async () => {}),
        onEvent: vi.fn(() => () => {}),
        watch: vi.fn(async () => {}),
        unwatch: vi.fn(async () => {}),
        lens: vi.fn(async (req: { kind: string; file?: string }) => {
          if (req.kind === 'list') {
            listCalls += 1;
            return {
              folder,
              lenses: [docA],
              collapsed: {},
              broken: [],
              shared: false,
            } satisfies LensFolder;
          }
          if (req.kind === 'apply' && req.file) {
            if (failNext) {
              failNext = false;
              throw new Error('Disk full on lens');
            }
            if (holdInFlight) {
              holdInFlight = false;
              await new Promise<void>((resolve) => {
                releaseInFlight = resolve;
              });
            }
            applied.push(req.file);
            return { document: docA, dropped: [] };
          }
          return {};
        }),
      },
    });
    initialize({
      home: '/fixtures',
      platform: 'darwin',
      state: null,
      locations: [],
      openPaths: [],
    });
    await act(async () => {
      root.render(<Harness folder={folder} />);
      await Promise.resolve();
    });
    expect(listCalls).toBe(1);

    // Unmount before the failing apply runs: flushState must reject and NOT call list().
    await act(async () => {
      editLens(
        folder,
        'a.json',
        [{ kind: 'set-group', group: { id: 'g1111', name: 'Failing', order: 0 } }],
        'Rename',
      );
      root.render(null);
    });
    await expect(flushState(false)).rejects.toThrow('Disk full on lens');
    expect(listCalls).toBe(1);

    // Re-mount so the folder has a live lens snapshot, then verify an in-flight apply is awaited.
    await act(async () => {
      root.render(<Harness folder={folder} />);
      await Promise.resolve();
    });
    holdInFlight = true;
    editLens(
      folder,
      'a.json',
      [{ kind: 'set-group', group: { id: 'g1111', name: 'InFlight', order: 0 } }],
      'Rename',
    );
    vi.advanceTimersByTime(130);
    let flushed = false;
    const waiting = flushState(false).then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);
    releaseInFlight();
    await waiting;
    expect(flushed).toBe(true);
    expect(applied).toEqual(['a.json']);
  });
});
