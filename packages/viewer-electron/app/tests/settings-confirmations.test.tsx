// @vitest-environment jsdom
/**
 * A Settings removal or reset asks first: a sheet that names what changes, Cancel as its default,
 * and the action in the danger ink.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { KeymapSettings } from '../src/renderer/ui/settings/KeymapSettings';
import { ShortcutSettings } from '../src/renderer/ui/settings/ShortcutSettings';
import { NavigationSettings } from '../src/renderer/ui/settings/NavigationSettings';
import { defaultSettings } from '../src/domain/services';
import { normalizePreferences } from '../src/domain/preferences/ui';
import type { SettingsEditor } from '../src/renderer/ui/settings/editor';
import { useConfirmation } from '../src/renderer/ui/settings/ConfirmAction';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
afterEach(cleanup);

function Theme({ remove }: { remove(): void }) {
  const confirmation = useConfirmation();
  return (
    <>
      <button
        className="danger"
        onClick={() =>
          confirmation.ask({
            title: 'Remove the theme “Dusk”?',
            detail: 'A look that uses it goes back to the built-in theme.',
            action: 'Remove',
            run: remove,
          })
        }
      >
        Remove
      </button>
      {confirmation.dialog}
    </>
  );
}

it('asks, opens on Cancel, and removes only on the danger button', () => {
  const remove = vi.fn();
  render(<Theme remove={remove} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  const dialog = screen.getByRole('dialog', { name: 'Remove the theme “Dusk”?' });
  expect(dialog.textContent).toContain('goes back to the built-in theme');
  expect(document.activeElement?.textContent).toBe('Cancel');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(remove).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  const confirm = screen
    .getAllByRole('button', { name: 'Remove' })
    .find((button) => button.closest('dialog'))!;
  expect(confirm.classList.contains('danger')).toBe(true);
  fireEvent.click(confirm);
  expect(remove).toHaveBeenCalledOnce();
});

it.each([
  'Reset All Shortcuts',
  'Reset Prefix Keys',
  'Remove Mode “sample”',
  'Reset Navigation Defaults',
])('asks before %s', (label) => {
  const settings = defaultSettings('/fixtures');
  settings.keymap = { ...settings.keymap, modes: { sample: { bindings: {} } } };
  const editor: SettingsEditor = {
    snapshot: { revision: 1, settings, ui: normalizePreferences(), look: 'dark', credentials: [] },
    patch: vi.fn(),
    patches: vi.fn(),
    save: vi.fn(),
    error: vi.fn(),
  };
  Object.assign(window, { viewer: {} });
  render(
    label === 'Reset Navigation Defaults' ? (
      <NavigationSettings editor={editor} />
    ) : (
      <ShortcutSettings editor={editor} />
    ),
  );
  if (label.startsWith('Remove')) {
    fireEvent.click(screen.getByRole('button', { name: /Key table/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Mode sample' }));
  }
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(editor.patch).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog');
  expect(document.activeElement?.textContent).toBe('Cancel');
  fireEvent.click(dialog.querySelector('button.danger')!);
  expect(label.startsWith('Remove') ? editor.save : editor.patch).toHaveBeenCalledOnce();
});

it('preserves a keymap update received while confirming removal of one mode', () => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
  const settings = defaultSettings('/fixtures');
  settings.keymap.modes = { sample: { bindings: {} } };
  let stored = settings.keymap;
  const editor: SettingsEditor = {
    snapshot: { revision: 1, settings, ui: normalizePreferences(), look: 'dark', credentials: [] },
    patch: (_, value) => {
      stored = value as typeof stored;
    },
    save: (build) => {
      for (const patch of build(editor.snapshot)) stored = patch.value as typeof stored;
    },
    patches: vi.fn(),
    error: vi.fn(),
  };
  const view = render(<KeymapSettings editor={editor} />);
  fireEvent.click(view.getByRole('button', { name: /Key table/ }));
  fireEvent.click(view.getByRole('menuitemradio', { name: 'Mode sample' }));
  fireEvent.click(view.getByRole('button', { name: 'Remove Mode “sample”' }));
  const modes = { ...stored.modes, added: { bindings: { g: 'frame-all' } } };
  stored = { ...stored, modes };
  editor.snapshot = { ...editor.snapshot, revision: 2, settings: { ...settings, keymap: stored } };
  view.rerender(<KeymapSettings editor={editor} />);
  fireEvent.click(view.getByRole('button', { name: 'Remove Mode' }));
  expect(stored.modes).toEqual({ added: modes.added });
});
