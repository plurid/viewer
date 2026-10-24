import { WorkspaceSessions } from '../src/desktop/windows/workspace-sessions';
import type { Workspace } from '../src/domain/contracts';
import { scopedPresentation } from '../src/renderer/state/folder-presentation';
import type { JSONValue } from '../src/domain/workspaces/project';
import { describe, expect, it } from 'vitest';
import { normalizePreferences } from '../src/domain/preferences/ui';
import { defaultSettings } from '../src/domain/services';
import { settingValue } from '../src/domain/preferences/catalog';
import { tileLayouts } from '../src/domain/workspaces/tiling';
import {
  compilePresentationValues,
  presentationFields,
  type PresentationValues,
} from '../src/domain/preferences/presentation/profile-fields';
import {
  createWindowPreferencesResolver,
  profileDiagnostics,
  resolveWindowPreferences,
  type WindowPreferencesInput,
} from '../src/domain/preferences/presentation/resolver';
import { profileSchema } from '../src/desktop/preferences/settings';

function input(values: Record<string, JSONValue> = {}): WindowPreferencesInput {
  return {
    settings: {
      ...defaultSettings('/fixtures'),
      profiles: [{ id: 'mine', name: 'Mine', values }],
    },
    ui: normalizePreferences(),
    workspace: { profileID: 'mine' },
    systemLook: 'light',
  };
}

describe('window presentation resolution', () => {
  it('applies every supported field through its shared validation schema', () => {
    const base = input();
    const candidates = [
      true,
      false,
      0,
      1,
      8,
      12,
      40,
      80,
      160,
      210,
      280,
      600,
      'TestMono',
      '#123456',
      '/fixtures/context',
      'dark',
      'light',
      'system',
      'list',
      'grid',
      'columns',
      'gallery',
      'name',
      'modified',
      'kind',
      'none',
      'comfortable',
      'compact',
      'face-on',
      'pair',
      'dock',
      'opaque',
      'blur',
      'clear',
      'current',
      'home',
      'desktop',
      'normal',
      'bold',
      'same',
      'folder',
      'terminal',
      'scratch',
      ...tileLayouts,
      [],
      ['name'],
      ['name', 'size'],
      ['locations'],
      ['/fixtures/context'],
      ['favorites', 'locations', 'recents'],
      { '/fixtures/context': 'Context' },
    ];
    for (const [path, schema] of Object.entries(presentationFields)) {
      const before = settingValue(base, path);
      const next = candidates.find(
        (value) =>
          schema.safeParse(value).success && JSON.stringify(value) !== JSON.stringify(before),
      );
      expect(next, `A distinct fixture for ${path}`).toBeDefined();
      if (next === undefined) throw new Error(`Missing fixture for ${path}`);
      const source = input({ [path]: next });
      const result = resolveWindowPreferences(source);
      expect(settingValue(result, path), path).toEqual(next);
      expect(settingValue(source, path), `${path} remains canonical`).toEqual(before);
    }
  });

  it('layers defaults, an explicit profile, and local overrides without mutating their sources', () => {
    const source = input({ 'settings.editor.tabSize': 8, 'ui.space.minimap': false });
    source.settings.profiles.push({
      id: 'explicit',
      name: 'Explicit',
      values: {
        'settings.editor.tabSize': 2,
        'ui.space.minimap': true,
      },
    });
    source.profileID = 'explicit';
    source.workspace.overrides = { 'settings.editor.tabSize': 6 };
    const original = JSON.stringify(source);
    expect(resolveWindowPreferences(source).settings.editor.tabSize).toBe(6);
    expect(
      resolveWindowPreferences({ ...source, includeOverrides: false }).settings.editor.tabSize,
    ).toBe(2);
    expect(resolveWindowPreferences(source).ui.space.minimap).toBe(true);
    expect(JSON.stringify(source)).toBe(original);
  });

  it('normalizes parent shorthand without replacing other preference fields', () => {
    const source = input({ 'ui.space': { toolbar: false }, 'settings.editor': { tabSize: 8 } });
    const result = resolveWindowPreferences(source);
    expect(result.ui.space.toolbar).toBe(false);
    expect(Object.keys(result.ui.space)).toEqual(Object.keys(source.ui.space));
    expect(result.settings.editor).toEqual({ ...source.settings.editor, tabSize: 8 });
    const first = compilePresentationValues({ 'ui.space.grid': false, 'ui.space': { grid: true } });
    const second = compilePresentationValues({
      'ui.space': { grid: true },
      'ui.space.grid': false,
    });
    expect(first.values).toEqual(second.values);
    expect(first.values['ui.space.grid']).toBe(false);
  });

  it('diagnoses invalid and protected entries and never aliases an unknown path', () => {
    const source = input({
      'ui.space.missing.toolbar': false,
      'ui.titlebar': null,
      'ui.space.grid': 'false',
      'settings.browsing': { density: 'compact', confirmTrash: false },
      'settings.providers': [],
    });
    const result = resolveWindowPreferences(source);
    expect(result.ui).toBe(source.ui);
    expect(result.settings).toBe(source.settings);
    expect(result.diagnostics.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        'ui.space.missing.toolbar',
        'ui.titlebar',
        'ui.space.grid',
        'settings.browsing.confirmTrash',
        'settings.providers',
      ]),
    );
    expect(profileSchema.safeParse(source.settings.profiles[0]).success).toBe(false);
  });

  it('keeps unsupported startup profiles readable with repair diagnostics', () => {
    const source = input({
      'settings.browsing.restoreSession': false,
      'settings.editor.tabSize': 8,
    });
    expect(resolveWindowPreferences(source).settings.editor.tabSize).toBe(8);
    expect(resolveWindowPreferences(source).settings.browsing.restoreSession).toBe(
      source.settings.browsing.restoreSession,
    );
    expect(profileDiagnostics(source.settings.profiles)[0]?.message).toContain('restoreSession');
    source.settings.profiles.push({
      id: 'focus',
      name: 'Collision',
      values: { 'ui.space.grid': true },
    });
    source.profileID = 'focus';
    expect(resolveWindowPreferences(source).ui.space.grid).toBe(false);
    expect(
      profileDiagnostics(source.settings.profiles).some((issue) => issue.code === 'reserved-id'),
    ).toBe(true);
  });

  it('falls back through missing references and follows edited definitions', () => {
    const source = input({ 'settings.editor.tabSize': 8 });
    source.profileID = 'deleted';
    expect(resolveWindowPreferences(source).settings.editor.tabSize).toBe(8);
    expect(resolveWindowPreferences(source).diagnostics[0]?.code).toBe('missing-profile');
    expect(source.profileID).toBe('deleted');
    const resolver = createWindowPreferencesResolver();
    const original = resolver(source);
    const edited = {
      ...source,
      settings: {
        ...source.settings,
        profiles: [{ id: 'mine', name: 'Mine', values: { 'settings.editor.tabSize': 6 } }],
      },
    };
    expect(resolver(edited).settings.editor.tabSize).toBe(6);
    expect(original.settings.editor.tabSize).toBe(8);
  });

  it('keeps independent window caches stable across unrelated workspace edits', () => {
    const a = createWindowPreferencesResolver();
    const b = createWindowPreferencesResolver();
    const first = input();
    first.profileID = 'focus';
    const second = { ...first, profileID: 'full', workspace: { ...first.workspace } };
    const focused = a(first);
    const full = b(second);
    expect(focused.ui.sidebar.visible).toBe(false);
    expect(full.ui.sidebar.visible).toBe(true);
    expect(a({ ...first, workspace: { ...first.workspace } })).toBe(focused);
    expect(b(second)).toBe(full);
    expect(first.ui.titlebar.visible).toBe(true);
  });

  it('retains shared per-folder choices and project views above profile defaults', () => {
    const source = input({
      'settings.browsing.mode': 'grid',
      'ui.list.visible.kind': false,
    });
    source.settings.folders['/fixtures'] = {
      mode: 'columns',
      list: { visible: { kind: true } },
    };
    const workspace: Workspace = {
      id: 'work',
      name: 'Work',
      panes: [],
      roots: [],
      arrangement: {},
      profileID: 'mine',
    };
    let presentation = scopedPresentation('/fixtures', source.settings, source.ui, workspace);
    expect(presentation.mode).toBe('columns');
    expect(presentation.list.visible.kind).toBe(true);
    workspace.project = {
      file: '/fixtures/project.jsonc',
      root: '/fixtures',
      revision: 'first',
      bindings: {},
      dirty: false,
      definition: {
        version: 1,
        id: 'project',
        name: 'Project',
        bindings: [],
        planes: [],
        folders: [],
        layout: { placements: [] },
        arrangements: {},
      },
      folders: { '/fixtures': { mode: 'gallery', list: { visible: { modified: false } } } },
    };
    presentation = scopedPresentation('/fixtures', source.settings, source.ui, workspace);
    expect(presentation.mode).toBe('gallery');
    expect(presentation.list.visible.kind).toBe(true);
    expect(presentation.list.visible.modified).toBe(false);
    expect(source.settings.folders['/fixtures']?.mode).toBe('columns');
    expect(source.ui.list.visible.modified).toBe(true);
  });

  it('retains independent profile values when two owned windows save and reopen', () => {
    const sessions = new WorkspaceSessions();
    const first = sessions.create('/fixtures', 'First');
    const second = sessions.create('/fixtures', 'Second');
    const a = sessions.open(1, '/fixtures', first);
    const b = sessions.open(2, '/fixtures', second);
    const source = input({ 'settings.editor.tabSize': 8 });
    source.settings.profiles.push({
      id: 'other',
      name: 'Other',
      values: { 'settings.editor.tabSize': 2 },
    });
    a.profile = { id: 'mine', previous: {} };
    b.profile = { id: 'other', previous: {} };
    sessions.save(1, a);
    sessions.save(2, b);
    sessions.close(1);
    sessions.close(2);
    const restarted = new WorkspaceSessions();
    restarted.seed(sessions.snapshot()!);
    const reopenedA = restarted.open(3, '/fixtures', first);
    const reopenedB = restarted.open(4, '/fixtures', second);
    const resolve = (state: typeof reopenedA) =>
      resolveWindowPreferences({
        ...source,
        workspace: state.workspaces.find((space) => space.id === state.activeWorkspace)!,
        profileID: state.profile?.id,
      });
    expect(resolve(reopenedA).settings.editor.tabSize).toBe(8);
    expect(resolve(reopenedB).settings.editor.tabSize).toBe(2);
    expect(source.settings.editor.tabSize).toBe(4);
    expect(a.profile?.id).toBe('mine');
    expect(b.profile?.id).toBe('other');
  });
  it('tracks the OS look independently from the shared appearance preference', () => {
    const source = input({ 'settings.appearance': 'system' });
    source.settings.appearance = 'dark';
    const resolver = createWindowPreferencesResolver();
    expect(resolver(source).look).toBe('light');
    expect(resolver({ ...source, systemLook: 'dark' }).look).toBe('dark');
    expect(source.settings.appearance).toBe('dark');
  });

  it('keeps a valid inherited starting folder when a profile lacks its custom path', () => {
    const source = input({ 'settings.browsing.newPlaneLocation': 'custom' });
    const result = resolveWindowPreferences(source);
    expect(result.settings.browsing.newPlaneLocation).toBe(
      source.settings.browsing.newPlaneLocation,
    );
    expect(result.diagnostics[0]?.path).toBe('settings.browsing.newPlanePath');
  });

  it('does not recreate untouched editor and terminal preferences for chrome-only profiles', () => {
    const source = input({ 'ui.space.grid': false });
    const result = resolveWindowPreferences(source);
    expect(result.settings).toBe(source.settings);
    expect(result.settings.editor).toBe(source.settings.editor);
    expect(result.settings.terminalFont).toBe(source.settings.terminalFont);
    expect(result.ui.list).toBe(source.ui.list);
    expect(compilePresentationValues({ 'ui.list.visible': { kind: false } }).values).toEqual({
      'ui.list.visible.kind': false,
    } satisfies PresentationValues);
  });
});
