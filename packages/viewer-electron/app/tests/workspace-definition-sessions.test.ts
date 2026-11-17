import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSessions } from '../src/desktop/windows/workspace-sessions';
import { sampleDefinition, sampleWorkspace } from './workspace-definition-fixtures';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const sessions = new WorkspaceSessions();
  const first = sessions.create('/home/sample', 'First');
  const second = sessions.create('/home/sample', 'Second');
  return {
    sessions,
    first,
    second,
    a: sessions.open(1, '/home/sample', first),
    b: sessions.open(2, '/home/sample', second),
  };
}
describe('definition workspace ownership', () => {
  it('keeps the first definition link when seeding duplicate saved workspaces', () => {
    const f = fixture();
    const state = structuredClone(f.a);
    for (const space of state.workspaces)
      space.definition = { key: 'sample/site', basis: 'a'.repeat(64) };
    const sessions = new WorkspaceSessions();
    sessions.seed(state);
    const restored = sessions.snapshot()!.workspaces;
    expect(restored[0]!.definition).toBeDefined();
    expect(restored[1]!.definition).toBeUndefined();
    expect(restored[1]!.panes).toEqual(state.workspaces[1]!.panes);
    expect(state.workspaces[1]!.definition).toBeDefined();
  });
  it('allows unrelated saves over existing duplicates but refuses a newly duplicated link', () => {
    const f = fixture();
    const association = { key: 'sample/site', basis: 'a'.repeat(64) };
    const current = f.sessions.snapshot()!;
    for (const space of current.workspaces) space.definition = association;
    Reflect.set(f.sessions, 'current', current);
    for (const space of f.a.workspaces) space.definition = association;
    f.a.workspaces[0]!.name = 'Renamed';
    expect(() => f.sessions.save(1, f.a)).not.toThrow();
    expect(f.sessions.snapshot()!.workspaces[0]!.name).toBe('Renamed');
    f.a.workspaces.push(sampleWorkspace('third', { definition: association }));
    expect(() => f.sessions.save(1, f.a)).toThrow('already open');
  });
  it('keeps a reservation across an unrelated flush and releases it on the build commit', () => {
    const f = fixture();
    expect(f.sessions.reserveDefinition(1, 'sample/site')).toBe(1);
    f.sessions.save(1, f.a);
    expect(f.sessions.reserveDefinition(2, 'sample/site')).toBe(1);
    const definition = sampleDefinition();
    const built = sampleWorkspace('built', {
      definition: { key: definition.key, basis: definition.basis },
    });
    f.a.workspaces.push(built);
    f.a.activeWorkspace = built.id;
    f.sessions.save(1, f.a);
    expect(f.sessions.definitionOwner(definition.key)).toBeUndefined();
    expect(f.sessions.findByDefinition(definition.key)).toEqual(built);
    const detached = f.sessions.findByDefinition(definition.key)!;
    detached.name = 'Changed copy';
    expect(f.sessions.findByDefinition(definition.key)!.name).not.toBe('Changed copy');
  });
  it('releases reservations on window close and after 30 seconds', () => {
    const f = fixture();
    f.sessions.reserveDefinition(1, 'sample/site');
    f.sessions.close(1);
    expect(f.sessions.definitionOwner('sample/site')).toBeUndefined();
    f.sessions.reserveDefinition(2, 'sample/site');
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30001);
    expect(f.sessions.definitionOwner('sample/site')).toBeUndefined();
  });
  it('refuses a stale second build even after the first reservation has committed', () => {
    const f = fixture();
    const definition = sampleDefinition();
    const association = { key: definition.key, basis: definition.basis };
    f.a.workspaces.push(sampleWorkspace('built-first', { definition: association }));
    f.a.activeWorkspace = 'built-first';
    f.sessions.save(1, f.a);
    f.b.workspaces.push(sampleWorkspace('built-second', { definition: association }));
    f.b.activeWorkspace = 'built-second';
    expect(() => f.sessions.save(2, f.b)).toThrow('already open');
    expect(
      f.sessions.snapshot()!.workspaces.filter((workspace) => workspace.definition),
    ).toHaveLength(1);
  });
  it('rejects a second workspace with the same key within one save and a competing reservation', () => {
    const f = fixture();
    const definition = sampleDefinition();
    const association = { key: definition.key, basis: definition.basis };
    f.a.workspaces.push(
      sampleWorkspace('one', { definition: association }),
      sampleWorkspace('two', { definition: association }),
    );
    expect(() => f.sessions.save(1, f.a)).toThrow('already open');
    f.a.workspaces.pop();
    f.sessions.reserveDefinition(2, definition.key);
    expect(() => f.sessions.save(1, f.a)).toThrow('already open');
  });
  it('retains a reservation when its durable save fails', async () => {
    const f = fixture();
    f.sessions.reserveDefinition(1, 'sample/site');
    f.a.workspaces[0]!.definition = { key: 'sample/site', basis: 'a'.repeat(64) };
    await expect(
      f.sessions.persist(1, f.a, async () => {
        throw new Error('disk full');
      }),
    ).rejects.toThrow('disk full');
    expect(f.sessions.definitionOwner('sample/site')).toBe(1);
    expect(f.sessions.findByDefinition('sample/site')).toBeUndefined();
  });
});
