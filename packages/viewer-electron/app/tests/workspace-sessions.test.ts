import { describe, expect, it } from 'vitest';
import { WorkspaceSessions } from '../src/desktop/windows/workspace-sessions';

describe('native workspace ownership', () => {
  it('keeps file recall private to its owning workspace across overlapping saves', () => {
    const sessions = new WorkspaceSessions();
    const first = sessions.create('/fixtures', 'First');
    const second = sessions.create('/fixtures', 'Second');
    const a = sessions.open(1, '/fixtures', first);
    const b = sessions.open(2, '/fixtures', second);
    const entry = (page: number) => [
      { path: '/fixtures/Book.pdf', updated: page, values: { 'pdf.page': page } },
    ];
    a.previewHistory = { [first]: entry(3), [second]: entry(99) };
    sessions.save(1, a);
    b.previewHistory = { [second]: entry(8) };
    sessions.save(2, b);
    expect(sessions.snapshot()?.previewHistory?.[first]?.[0]?.values['pdf.page']).toBe(3);
    expect(sessions.snapshot()?.previewHistory?.[second]?.[0]?.values['pdf.page']).toBe(8);
  });
  it('protects a window reservation from peer claims and saves before renderer bootstrap', () => {
    const sessions = new WorkspaceSessions();
    const first = sessions.create('/fixtures', 'First');
    const second = sessions.create('/fixtures', 'Opening');
    const input = sessions.open(1, '/fixtures', first);
    sessions.reserve(2, second);
    expect(sessions.owner(second)).toBe(2);
    expect(sessions.claim(1, second)).toBe(false);
    expect(() => sessions.reserve(3, second)).toThrow('another window');
    input.workspaces = input.workspaces.filter((item) => item.id !== second);
    expect(() => sessions.save(1, input)).toThrow('other window');
    expect(sessions.open(2, '/fixtures', second).activeWorkspace).toBe(second);
    expect(sessions.owner(second)).toBe(2);
  });

  it('releases an unbootstrapped reservation when its native window closes', () => {
    const sessions = new WorkspaceSessions();
    const first = sessions.create('/fixtures');
    const second = sessions.create('/fixtures');
    sessions.open(1, '/fixtures', first);
    sessions.reserve(2, second);
    sessions.close(2);
    expect(sessions.owner(second)).toBeUndefined();
    expect(sessions.claim(1, second)).toBe(true);
  });

  it('exposes a detached presentation snapshot without file or preview data', () => {
    const sessions = new WorkspaceSessions();
    const id = sessions.create('/private-fixture', 'Private workspace');
    const state = sessions.open(1, '/private-fixture', id);
    state.workspaces[0]!.profileID = 'full';
    state.workspaces[0]!.overrides = { 'settings.editor.tabSize': 8 };
    state.profile = { id: 'focus', previous: {} };
    state.previewStates = { 'private-preview': { privateText: 'Retained private preview data' } };
    sessions.save(1, state);
    const presentation = sessions.presentation(id);
    expect(presentation).toEqual({
      workspace: { profileID: 'full', overrides: { 'settings.editor.tabSize': 8 } },
      profileID: 'focus',
    });
    expect(JSON.stringify(presentation)).not.toContain('private');
    presentation.workspace.overrides!['settings.editor.tabSize'] = 2;
    expect(sessions.presentation(id).workspace.overrides?.['settings.editor.tabSize']).toBe(8);
  });

  it('merges overlapping saves without replacing another window or reviving a removed favorite', () => {
    const sessions = new WorkspaceSessions();
    const first = sessions.create('/fixtures', 'First');
    const second = sessions.create('/fixtures', 'Second');
    const a = sessions.open(1, '/fixtures', first);
    const b = sessions.open(2, '/fixtures', second);
    a.workspaces.find((space) => space.id === first)!.name = 'Edited first';
    b.workspaces.find((space) => space.id === second)!.name = 'Edited second';
    a.favorites = [{ path: '/a', name: 'A' }];
    b.favorites = [{ path: '/b', name: 'B' }];
    sessions.save(1, a);
    sessions.save(2, b);
    expect(sessions.snapshot()?.workspaces.map((space) => space.name)).toEqual([
      'Edited first',
      'Edited second',
    ]);
    expect(
      sessions
        .snapshot()
        ?.favorites.map((favorite) => favorite.path)
        .sort(),
    ).toEqual(['/a', '/b']);
    expect(sessions.claim(1, second)).toBe(false);
    expect(sessions.owner(second)).toBe(2);
    a.workspaces = a.workspaces.filter((space) => space.id !== second);
    expect(() => sessions.save(1, a)).toThrow('other window');
  });

  it('keeps explicit profiles in their workspace window and restores each after restart', () => {
    const sessions = new WorkspaceSessions();
    const first = sessions.create('/fixtures');
    const second = sessions.create('/fixtures');
    const a = sessions.open(1, '/fixtures', first);
    a.profile = { id: 'focus', previous: {} };
    sessions.save(1, a);
    const b = sessions.open(2, '/fixtures', second);
    expect(b.profile).toBeUndefined();
    b.profile = { id: 'present', previous: {} };
    sessions.save(2, b);
    const restarted = new WorkspaceSessions();
    restarted.seed(sessions.snapshot()!);
    expect(restarted.open(3, '/fixtures', first).profile?.id).toBe('focus');
    expect(restarted.open(4, '/fixtures', second).profile?.id).toBe('present');
  });

  it('does not advance its baseline when a durable write fails', async () => {
    const sessions = new WorkspaceSessions();
    const workspace = sessions.create('/fixtures', 'Original');
    const input = sessions.open(1, '/fixtures', workspace);
    input.workspaces[0]!.name = 'Changed';
    await expect(
      sessions.persist(1, input, async () => {
        throw new Error('Disk full');
      }),
    ).rejects.toThrow('Disk full');
    expect(sessions.snapshot()?.workspaces[0]?.name).toBe('Original');
    await sessions.persist(1, input, async () => {});
    expect(sessions.snapshot()?.workspaces[0]?.name).toBe('Changed');
  });
});
