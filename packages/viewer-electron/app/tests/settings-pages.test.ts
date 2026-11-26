// @vitest-environment jsdom
/**
 * One switch for each on/off setting on its Settings page. A page's own controls had drawn a second
 * toggle for Global shortcut beside the catalog's row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { randomUUID } from 'node:crypto';
import type { DesktopEvent } from '../src/domain/contracts';
import type { SettingsSnapshot } from '../src/domain/services';
import { CatalogSettings } from '../src/renderer/ui/settings/CatalogSettings';
import { ConfigurationSettings } from '../src/renderer/ui/settings/AutomationSettings';
import { RecipeSettings } from '../src/renderer/ui/settings/RecipeSettings';
import type { SettingsEditor } from '../src/renderer/ui/settings/editor';
import { defaultSettings } from '../src/domain/services';
import { SettingsWindow } from '../src/renderer/ui/settings/Settings';
import { categories, settingCatalog, settingValue } from '../src/domain/preferences/catalog';
import { getState, initialize } from '../src/renderer/state/store';
import type { LicenseRequest, LicenseStatus } from '../src/domain/license/license';
import { restoreApiErrors } from '../src/renderer/api-boundary';

type Listener = (event: DesktopEvent) => void;
const listeners = new Set<Listener>();
let snapshot: SettingsSnapshot;
beforeEach(() => {
  listeners.clear();
  history.replaceState(null, '', '/');
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
  snapshot = structuredClone(getState().settings);
  const stubs: Record<string, unknown> = {
    settingsGet: async () => snapshot,
    onEvent: (listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  Object.assign(window, {
    viewer: new Proxy(stubs, {
      get: (target, key: string) => target[key] ?? vi.fn(async () => undefined),
    }),
  });
});
afterEach(() => cleanup());

/** `snapshot` with the on/off setting at `path` turned the other way, as a newer revision. */
function toggled(path: string): SettingsSnapshot {
  const next = structuredClone(snapshot);
  next.revision++;
  const keys = path.split('.');
  let target = next as unknown as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[keys.at(-1)!] = settingValue(snapshot, path) !== true;
  return next;
}

describe('Settings pages', () => {
  it('omits the License page when the desktop returns no license status', async () => {
    history.replaceState(null, '', '/?window=settings&category=License&focus=license');
    const view = render(createElement(SettingsWindow));
    await view.findByRole('heading', { level: 1 });
    expect(view.queryByRole('button', { name: 'License' })).toBeNull();
    expect(view.getByRole('heading', { level: 1 }).textContent).toBe('Browsing');
    fireEvent.click(view.getByRole('button', { name: 'Privacy' }));
    expect(view.queryByText(/license key holds/)).toBeNull();
  });

  it('keeps an event newer than the initial license status request', async () => {
    let complete: ((status: LicenseStatus) => void) | undefined;
    window.viewer.license = vi.fn(
      () =>
        new Promise<LicenseStatus>((resolve) => {
          complete = resolve;
        }),
    );
    const view = render(createElement(SettingsWindow));
    await view.findByRole('heading', { level: 1 });
    const email = `${randomUUID()}@buyer.example.invalid`;
    act(() =>
      listeners.forEach((listener) =>
        listener({ type: 'license', status: { kind: 'licensed', email } }),
      ),
    );
    await act(async () => complete!({ kind: 'trial-ended' }));
    fireEvent.click(view.getByRole('button', { name: 'License' }));
    expect(view.getByRole('status').textContent).toBe(`Licensed to ${email}`);
  });

  it('opens License from its command, reports a bad key inline, and saves or removes a valid key', async () => {
    const email = `${randomUUID()}@buyer.example.invalid`;
    let status: LicenseStatus = { kind: 'trial', daysLeft: 12 };
    let complete: ((value: LicenseStatus) => void) | undefined;
    const license = vi.fn(async (request: LicenseRequest) => {
      if (request.kind === 'enter') {
        if (request.key === 'wrong')
          throw { message: 'This is not a valid license key for Viewer.', code: 'invalid' };
        status = await new Promise<LicenseStatus>((resolve) => {
          complete = resolve;
        });
      }
      if (request.kind === 'remove') status = { kind: 'trial', daysLeft: 12 };
      return status;
    });
    window.viewer.license = restoreApiErrors({ license }).license;
    history.replaceState(null, '', '/?window=settings&focus=license');
    const view = render(createElement(SettingsWindow));
    await view.findByRole('button', { name: 'License' });
    await waitFor(() =>
      expect(view.getByRole('heading', { level: 1 }).textContent).toBe('License'),
    );
    expect(view.getByRole('status').textContent).toBe('Trial: 12 days left');
    fireEvent.click(view.getByRole('button', { name: 'Buy Viewer' }));
    await waitFor(() => expect(license).toHaveBeenCalledWith({ kind: 'buy' }));
    const field = view.getByRole('textbox', { name: 'License key' });
    fireEvent.change(field, { target: { value: 'wrong' } });
    fireEvent.click(view.getByRole('button', { name: 'Save License Key' }));
    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toBe(
        'This is not a valid license key for Viewer.',
      ),
    );
    expect(view.getByRole('alert').textContent).not.toContain('code');
    fireEvent.change(field, { target: { value: 'generated valid key' } });
    fireEvent.click(view.getByRole('button', { name: 'Save License Key' }));
    await waitFor(() => expect(complete).toBeTypeOf('function'));
    expect(view.getByRole('button', { name: 'Working…' }).hasAttribute('disabled')).toBe(true);
    expect(field.hasAttribute('disabled')).toBe(true);
    await act(async () => complete!({ kind: 'licensed', email }));
    await waitFor(() => expect(view.getByRole('status').textContent).toBe(`Licensed to ${email}`));
    expect((field as HTMLTextAreaElement).value).toBe('');
    expect(view.queryByRole('button', { name: 'Buy Viewer' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Remove License Key' }));
    await waitFor(() => expect(view.getByRole('status').textContent).toBe('Trial: 12 days left'));
    expect(license).toHaveBeenCalledWith({ kind: 'remove' });
    act(() =>
      listeners.forEach((listener) =>
        listener({ type: 'license', status: { kind: 'trial-ended' } }),
      ),
    );
    expect(view.getByRole('status').textContent).toBe('Trial ended');
  });
  it('focuses search on open and selects the previous query on explicit reopen', async () => {
    const view = render(createElement(SettingsWindow));
    const search = (await view.findByRole('textbox', {
      name: 'Search settings',
    })) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.change(search, { target: { value: 'header' } });
    search.blur();
    act(() => listeners.forEach((listener) => listener({ type: 'settings-focus' })));
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(search.selectionStart).toBe(0);
    expect(search.selectionEnd).toBe(6);
    search.blur();
    snapshot = { ...snapshot, revision: snapshot.revision + 1 };
    act(() => listeners.forEach((listener) => listener({ type: 'settings', snapshot })));
    expect(document.activeElement).not.toBe(search);
  });

  it('draw one switch for each on/off setting', async () => {
    const view = render(createElement(SettingsWindow));
    await waitFor(() => expect(view.getByRole('heading', { level: 1 })).toBeTruthy());
    const switches = () =>
      [
        ...view.container.querySelectorAll<HTMLInputElement>(
          '.settings-page input[type="checkbox"]',
        ),
      ].map((input) => input.checked);
    for (const category of categories) {
      const definitions = settingCatalog.filter(
        (definition) => definition.category === category && definition.kind === 'boolean',
      );
      if (!definitions.length) continue;
      fireEvent.click(view.getByRole('button', { name: category }));
      await waitFor(() =>
        expect(view.getByRole('heading', { level: 1 }).textContent).toBe(category),
      );
      for (const { path } of definitions) {
        const before = switches();
        snapshot = toggled(path);
        act(() => listeners.forEach((listener) => listener({ type: 'settings', snapshot })));
        const row = () =>
          view.container.querySelector<HTMLInputElement>(
            `[data-setting-path="${CSS.escape(path)}"] input[type="checkbox"]`,
          );
        await waitFor(() => expect(row()?.checked, path).toBe(settingValue(snapshot, path)));
        const changed = switches().filter((checked, index) => checked !== before[index]);
        expect(changed, `${category}: ${path}`).toHaveLength(1);
      }
    }
  });
});

it.each([[], ['/fixtures/work']].map((roots) => ({ roots })))(
  'resets search roots $roots to the home folder',
  ({ roots }) => {
    HTMLDialogElement.prototype.showModal ??= function () {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function () {
      this.removeAttribute('open');
    };
    snapshot.home = '/fixtures';
    snapshot.settings.search.roots = roots;
    window.viewer.workspaceDefinitionFile = vi.fn().mockResolvedValue({
      found: { total: 0, hidden: 0 },
      projectManager: { state: 'undecided' },
      diagnostics: [],
    });
    const save = vi.fn();
    const view = render(createElement(ConfigurationSettings, { snapshot, save }));
    fireEvent.click(view.getByRole('button', { name: /Configuration section/i }));
    fireEvent.click(view.getByRole('menuitemradio', { name: 'Search' }));
    fireEvent.click(view.getByRole('button', { name: 'Reset Section' }));
    fireEvent.click(view.getByRole('button', { name: 'Reset' }));
    expect(save).toHaveBeenCalledWith([
      { path: 'settings.search', value: defaultSettings('/fixtures').search },
    ]);
  },
);

it('imports exported recipes without replacing local edits or duplicating built-ins', async () => {
  const current = structuredClone(snapshot);
  const local = {
    ...current.settings.recipes[0]!,
    id: crypto.randomUUID(),
    name: 'Local',
    shortcut: 'Ctrl+Cmd+9',
  };
  current.settings.recipes.push(local);
  const apply: SettingsEditor['save'] = (change) => {
    const patches = change(current);
    for (const patch of patches)
      current.settings.recipes = patch.value as typeof current.settings.recipes;
  };
  const editor: SettingsEditor = {
    snapshot,
    save: apply,
    patch: (path, value) => apply(() => [{ path, value }]),
    patches: vi.fn(),
    error: vi.fn(),
  };
  const view = render(createElement(RecipeSettings, { editor }));
  const imported = { ...local, name: 'Imported' };
  const text = JSON.stringify([...snapshot.settings.recipes, imported]);
  const input = view.container.querySelector('input[type=file]')!;
  await act(async () =>
    fireEvent.change(input, { target: { files: [{ text: async () => text }] } }),
  );
  expect(current.settings.recipes.slice(0, -1)).toEqual([...snapshot.settings.recipes, local]);
  const copy = current.settings.recipes.at(-1)!;
  expect(copy.name).toBe('Imported');
  expect(copy.id).not.toBe(local.id);
  expect(copy.shortcut).toBeFalsy();
  await act(async () =>
    fireEvent.change(input, { target: { files: [{ text: async () => text }] } }),
  );
  expect(current.settings.recipes).toEqual([...snapshot.settings.recipes, local, copy]);
});
it('saves the last space color when its page unmounts', () => {
  const editor: SettingsEditor = {
    snapshot,
    save: vi.fn(),
    patches: vi.fn(),
    error: vi.fn(),
    patch: vi.fn(),
  };
  const view = render(
    createElement(CatalogSettings, {
      editor,
      definitions: settingCatalog.filter((d) => d.path === 'ui.space.color'),
      query: '',
    }),
  );
  const picker = view.getByLabelText('Custom color');
  fireEvent.change(picker, { target: { value: '#112233' } });
  expect(editor.patch).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: 'Ocean' }));
  expect(editor.patch).toHaveBeenCalledWith('ui.space.color', '#0f2633');
  fireEvent.click(view.getByRole('button', { name: 'Automatic' }));
  expect(editor.patch).toHaveBeenLastCalledWith('ui.space.color', '');
  fireEvent.change(picker, { target: { value: '#334455' } });
  view.unmount();
  expect(editor.patch).toHaveBeenLastCalledWith('ui.space.color', '#334455');
  expect(editor.patch).toHaveBeenCalledTimes(3);
});

it('rejects a malformed recipe before it enters the settings write queue', async () => {
  const editor: SettingsEditor = {
    snapshot,
    patch: vi.fn(),
    save: vi.fn(),
    patches: vi.fn(),
    error: vi.fn(),
  };
  const view = render(createElement(RecipeSettings, { editor }));
  const input = view.container.querySelector('input[type=file]')!;
  await act(async () =>
    fireEvent.change(input, { target: { files: [{ text: async () => '[null]' }] } }),
  );
  expect(editor.error).toHaveBeenCalled();
  expect(editor.save).not.toHaveBeenCalled();
});
it('acknowledges a Settings window flush after committing the picker value', async () => {
  const calls: string[] = [];
  history.replaceState(null, '', '/?window=settings&category=Space');
  window.viewer.settingsPatch = vi.fn(async (patches) => {
    for (const patch of patches) calls.push(patch.path + '=' + String(patch.value));
    return { ...snapshot, revision: snapshot.revision + 1 };
  });
  window.viewer.flushed = vi.fn(async () => {
    calls.push('flushed');
  });
  const view = render(createElement(SettingsWindow));
  const picker = await view.findByLabelText('Custom color');
  fireEvent.change(picker, { target: { value: '#334455' } });
  await act(async () =>
    listeners.forEach((listener) => listener({ type: 'flush-settings', token: 'close' })),
  );
  expect(calls).toEqual(['ui.space.color=#334455', 'flushed']);
});
