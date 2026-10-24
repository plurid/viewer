// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { createElement, useState } from 'react';
import { ThemeSettings } from '../src/renderer/ui/settings/ThemeSettings';
import type { SettingsEditor } from '../src/renderer/ui/settings/editor';
import {
  saveSettingsChange,
  type SettingsChange,
} from '../src/renderer/ui/settings/settings-edits';
import { SettingsService } from '../src/desktop/preferences/settings';
import type { SettingsSnapshot } from '../src/domain/services';
import { builtInTheme } from '../src/domain/preferences/themes';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let directory: string;
let service: SettingsService;
beforeEach(async () => {
  directory = await temporaryRoot('viewer-theme-editing-');
  service = new SettingsService(
    directory,
    directory,
    () => false,
    () => {},
  );
  await service.load();
  await service.patch(
    [
      {
        path: 'settings.themes',
        value: [
          { ...structuredClone(builtInTheme('dark')), id: 'mine', name: 'Mine' },
          { ...structuredClone(builtInTheme('light')), id: 'bright', name: 'Bright' },
        ],
      },
      { path: 'settings.theme', value: { dark: 'mine', light: '' } },
    ],
    0,
  );
});
afterEach(async () => {
  cleanup();
  service.close();
  await trashTemporary(directory);
});

function delayedEditor() {
  let current = service.snapshot();
  let acceptView: (snapshot: SettingsSnapshot) => void = () => {};
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const revisions: number[] = [];
  const errors: string[] = [];
  let pending = Promise.resolve();
  const writer = {
    current: () => current,
    write: async (patches: Parameters<SettingsService['patch']>[0], revision: number) => {
      revisions.push(revision);
      if (revisions.length === 1) await gate;
      return service.patch(patches, revision);
    },
    refresh: async () => service.snapshot(),
    accept: (snapshot: SettingsSnapshot) => {
      current = snapshot;
      acceptView(snapshot);
    },
    error: (message: string) => errors.push(message),
  };
  const save = (change: SettingsChange) => {
    pending = saveSettingsChange(pending, writer, change);
  };
  function Harness() {
    const [snapshot, setSnapshot] = useState(current);
    acceptView = setSnapshot;
    const editor: SettingsEditor = {
      snapshot,
      save,
      patch: (path, value) => save(() => [{ path, value }]),
      patches: (patches) => save(() => patches),
      error: writer.error,
    };
    return createElement(ThemeSettings, { editor });
  }
  const view = render(createElement(Harness));
  const details = view.container.querySelector<HTMLDetailsElement>('details.theme-editor')!;
  fireEvent.click(details.querySelector('summary')!);
  return {
    view,
    details,
    release,
    revisions,
    errors,
    settled: () => pending,
    snapshot: () => current,
  };
}

describe('theme editing through the serialized Settings queue', () => {
  it('preserves rapid font, density, radius and color edits before the first save replies', async () => {
    const editor = delayedEditor();
    const font = within(editor.details).getByLabelText('Theme interface font');
    fireEvent.change(font, { target: { value: 'Georgia' } });
    fireEvent.blur(font);
    await waitFor(() => expect(editor.revisions).toHaveLength(1));
    fireEvent.click(
      within(editor.details).getByRole('button', { name: 'Theme interface density' }),
    );
    fireEvent.click(document.querySelector('[data-menu-id="choice:compact"]')!);
    fireEvent.change(within(editor.details).getByLabelText('Theme corner radius'), {
      target: { value: '9' },
    });
    fireEvent.change(within(editor.details).getByLabelText('Accent'), {
      target: { value: '#ff8800' },
    });
    expect(editor.revisions).toHaveLength(1);
    await act(async () => {
      editor.release();
      await editor.settled();
    });
    expect(editor.errors).toEqual([]);
    expect(editor.snapshot().settings.themes.find((theme) => theme.id === 'mine')).toMatchObject({
      metrics: { fontFamily: 'Georgia', density: 'compact', radius: 9 },
      shell: { accent: '#ff8800' },
    });
    const reopened = new SettingsService(
      directory,
      directory,
      () => false,
      () => {},
    );
    try {
      await reopened.load();
      expect(reopened.snapshot().settings.themes).toEqual(editor.snapshot().settings.themes);
    } finally {
      reopened.close();
    }
  });

  it('merges dark and light selection edits and duplicates the latest theme contents', async () => {
    const editor = delayedEditor();
    const font = within(editor.details).getByLabelText('Theme interface font');
    fireEvent.change(font, { target: { value: 'Georgia' } });
    fireEvent.blur(font);
    await waitFor(() => expect(editor.revisions).toHaveLength(1));
    fireEvent.click(editor.view.getByRole('button', { name: 'Dark theme' }));
    fireEvent.click(document.querySelector(`[data-menu-id="choice:${builtInTheme('dark').id}"]`)!);
    fireEvent.click(editor.view.getByRole('button', { name: 'Light theme' }));
    fireEvent.click(document.querySelector('[data-menu-id="choice:bright"]')!);
    fireEvent.click(within(editor.details).getByRole('button', { name: 'Duplicate' }));
    await act(async () => {
      editor.release();
      await editor.settled();
    });
    expect(editor.errors).toEqual([]);
    expect(editor.snapshot().settings.theme).toEqual({ dark: '', light: 'bright' });
    expect(
      editor.snapshot().settings.themes.find((theme) => theme.name === 'Mine copy'),
    ).toMatchObject({
      metrics: { fontFamily: 'Georgia' },
    });
  });
});
