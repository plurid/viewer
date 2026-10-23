import { useState } from 'react';
import {
  bindingRows,
  bindingsFrom,
  defaultKeymap,
  keyGlyphs,
  type BindingRow,
  type Keymap,
} from '../../../domain/keymap';
import { Field } from '../SettingField';
import { KeyCapture } from './KeyCapture';
import type { SettingsEditor } from './editor';

const keysText = (keys: readonly string[]) => keys.join(' ');
const keysFrom = (text: string) => text.trim().split(/\s+/).filter(Boolean);
const commandsText = (commands: readonly string[]) => commands.join(', ');
const commandsFrom = (text: string) =>
  text
    .split(',')
    .map((command) => command.trim())
    .filter(Boolean);
/**
 * PREFIX KEYS (2026-10-23): the prefix (tmux's ⌃B), an optional leader, and their bindings as rows:
 * the keys pressed in turn ("b s") and the command, or commands in order, they run.
 */
export function KeymapSettings({ editor }: { editor: SettingsEditor }) {
  const { snapshot, patch } = editor;
  const keymap = snapshot.settings.keymap;
  const rows = bindingRows(keymap.bindings);
  const [draft, setDraft] = useState({ keys: '', commands: '' });
  const save = (next: Partial<Keymap>) => patch('settings.keymap', { ...keymap, ...next });
  const saveRows = (next: BindingRow[]) => save({ bindings: bindingsFrom(next) });
  return (
    <>
      <h2>Prefix keys</h2>
      <p className="settings-note">
        Press the prefix, then a key, as in tmux. A key runs a command, several in order, or waits
        for the next key: a chord. The same keymap is <code>settings.keymap</code> in config.jsonc.
      </p>
      <label className="settings-row">
        <span>
          Prefix
          <small>As tmux's prefix: click, then press ⌃ or ⌘ with a key (⌃A, ⌃Space…).</small>
        </span>
        <KeyCapture
          label="Prefix"
          kind="prefix"
          value={keymap.prefix}
          onChange={(prefix) => save({ prefix })}
        />
      </label>
      <label className="settings-row">
        <span>
          Leader
          <small>
            A key that starts a sequence outside text fields and terminals, such as Space.
          </small>
        </span>
        <KeyCapture
          label="Leader"
          kind="leader"
          value={keymap.leader}
          onChange={(leader) => save({ leader })}
        />
      </label>
      {(
        [
          [
            'inTerminals',
            'Prefix in terminal planes',
            'Off, the shell receives it; pressed twice, it does anyway.',
          ],
          ['inTextFields', 'Prefix in text fields and editors', 'Off, ⌃B moves the caret there.'],
          ['whichKey', 'Show the next keys while a sequence waits', ''],
        ] as const
      ).map(([key, label, detail]) => (
        <label className="settings-row" key={key}>
          <span>
            {label}
            {detail && <small>{detail}</small>}
          </span>
          <input
            type="checkbox"
            checked={keymap[key]}
            onChange={(event) => save({ [key]: event.target.checked })}
          />
        </label>
      ))}
      <label className="settings-row">
        <span>Wait for the next key (ms)</span>
        <input
          aria-label="Wait for the next key"
          type="number"
          min={300}
          max={10000}
          defaultValue={keymap.timeout}
          onBlur={(event) => save({ timeout: Number(event.target.value) })}
        />
      </label>
      <div className="keymap-rows" role="table" aria-label="Key bindings">
        {rows.map((row, index) => (
          <div className="keymap-row" role="row" key={keysText(row.keys)}>
            <kbd className="keymap-keys" title={keysText(row.keys)}>
              {keymap.prefix ? keyGlyphs(keymap.prefix) + ' ' : ''}
              {row.keys.map(keyGlyphs).join(' ')}
            </kbd>
            <Field
              label={`Keys for ${commandsText(row.commands)}`}
              value={keysText(row.keys)}
              save={(text) =>
                saveRows(
                  rows.map((item, at) => (at === index ? { ...item, keys: keysFrom(text) } : item)),
                )
              }
            />
            <Field
              label={`Commands for ${keysText(row.keys)}`}
              value={commandsText(row.commands)}
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
              aria-label={`Remove ${keysText(row.keys)}`}
              onClick={() => saveRows(rows.filter((_, at) => at !== index))}
            >
              Remove
            </button>
          </div>
        ))}
        <div className="keymap-row keymap-new" role="row">
          <span className="keymap-keys" />
          <input
            aria-label="New binding's keys"
            placeholder="Keys, e.g. g d"
            value={draft.keys}
            onChange={(event) => setDraft({ ...draft, keys: event.target.value })}
          />
          <input
            aria-label="New binding's commands"
            placeholder="Command, e.g. go-to"
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
