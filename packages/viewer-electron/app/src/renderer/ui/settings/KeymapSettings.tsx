import { useState } from 'react';
import {
  bindingRows,
  bindingsFrom,
  defaultKeymap,
  type BindingRow,
  type Keymap,
} from '../../../domain/keymap';
import { defaultShortcuts, shortcutOwner } from '../../../domain/shortcuts';
import { settingCatalog } from '../../../domain/setting-catalog';
import { Field } from '../SettingField';
import { KeyCapture } from './KeyCapture';
import type { SettingsEditor } from './editor';

const keysFrom = (text: string) => text.trim().split(/\s+/).filter(Boolean);
const commandsText = (commands: readonly string[]) => commands.join(', ');
const commandsFrom = (text: string) =>
  text
    .split(',')
    .map((command) => command.trim())
    .filter(Boolean);
/** Prefix keys (2026-10-23): the prefix, the leader, and their bindings, each recorded by pressing. */
export function KeymapSettings({ editor }: { editor: SettingsEditor }) {
  const { snapshot, patch } = editor;
  const keymap: Keymap = { ...defaultKeymap, ...snapshot.settings.keymap };
  const rows = bindingRows(keymap.bindings);
  const [draft, setDraft] = useState({ keys: '', commands: '' });
  // a whole keymap each time, whatever the snapshot held
  const save = (next: Partial<Keymap>) => patch('settings.keymap', { ...keymap, ...next });
  const saveRows = (next: BindingRow[]) => save({ bindings: bindingsFrom(next) });
  // command IDs to choose from as one types
  const commandIDs = [
    ...new Set([
      ...Object.keys(defaultShortcuts),
      ...Object.values(defaultKeymap.bindings).flatMap((binding) =>
        typeof binding === 'string' ? [binding] : [],
      ),
      ...settingCatalog.map((definition) => 'setting.' + definition.path),
      ...snapshot.settings.customActions.map((action) => 'custom.' + action.id),
      ...snapshot.settings.recipes.map((recipe) => 'recipe.' + recipe.id),
    ]),
  ].sort();
  return (
    <>
      <h2>Prefix keys</h2>
      <datalist id="keymap-commands">
        {commandIDs.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      <label className="settings-row">
        <span>Prefix</span>
        <KeyCapture
          label="Prefix"
          kind="shortcut"
          value={keymap.prefix}
          owner={(value) => shortcutOwner(snapshot.settings, value, 'keymap-prefix')}
          onChange={(prefix) => save({ prefix })}
        />
      </label>
      <label className="settings-row">
        <span>Leader</span>
        <KeyCapture
          label="Leader"
          kind="leader"
          value={keymap.leader}
          onChange={(leader) => save({ leader })}
        />
      </label>
      {(
        [
          ['inTerminals', 'Prefix in terminals'],
          ['inTextFields', 'Prefix in text fields'],
          ['whichKey', 'Show next keys'],
        ] as const
      ).map(([key, label]) => (
        <label className="settings-row" key={key}>
          <span>{label}</span>
          <input
            type="checkbox"
            checked={keymap[key]}
            onChange={(event) => save({ [key]: event.target.checked })}
          />
        </label>
      ))}
      <label className="settings-row">
        <span>Timeout (ms)</span>
        <input
          aria-label="Timeout"
          type="number"
          min={300}
          max={10000}
          defaultValue={keymap.timeout}
          onBlur={(event) => save({ timeout: Number(event.target.value) })}
        />
      </label>
      <div className="keymap-rows" role="table" aria-label="Key bindings">
        {rows.map((row, index) => (
          <div className="keymap-row" role="row" key={row.keys.join(' ')}>
            <KeyCapture
              label={`Keys for ${commandsText(row.commands)}`}
              kind="sequence"
              value={row.keys.join(' ')}
              onChange={(text) => {
                if (keysFrom(text).length)
                  saveRows(
                    rows.map((item, at) =>
                      at === index ? { ...item, keys: keysFrom(text) } : item,
                    ),
                  );
              }}
            />
            <Field
              label={`Commands for ${row.keys.join(' ')}`}
              value={commandsText(row.commands)}
              list="keymap-commands"
              save={(text) =>
                saveRows(
                  rows.map((item, at) =>
                    at === index ? { ...item, commands: commandsFrom(text) } : item,
                  ),
                )
              }
            />
            <button
              type="button"
              aria-label={`Remove ${row.keys.join(' ')}`}
              onClick={() => saveRows(rows.filter((_, at) => at !== index))}
            >
              Remove
            </button>
          </div>
        ))}
        <div className="keymap-row keymap-new" role="row">
          <KeyCapture
            label="New binding's keys"
            kind="sequence"
            value={draft.keys}
            onChange={(keys) => setDraft({ ...draft, keys })}
          />
          <input
            aria-label="New binding's commands"
            placeholder="Command"
            list="keymap-commands"
            value={draft.commands}
            onChange={(event) => setDraft({ ...draft, commands: event.target.value })}
          />
          <button
            type="button"
            disabled={!keysFrom(draft.keys).length || !commandsFrom(draft.commands).length}
            onClick={() => {
              saveRows([
                ...rows,
                { keys: keysFrom(draft.keys), commands: commandsFrom(draft.commands) },
              ]);
              setDraft({ keys: '', commands: '' });
            }}
          >
            Add
          </button>
        </div>
      </div>
      <div className="settings-actions">
        <button onClick={() => patch('settings.keymap', defaultKeymap)}>Reset prefix keys</button>
      </div>
    </>
  );
}
