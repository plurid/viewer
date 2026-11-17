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
