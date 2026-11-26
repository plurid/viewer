import { useEffect, useRef, useState } from 'react';
import {
  bindingRows,
  bindingsFrom,
  defaultKeymap,
  keyGlyphs,
  rootKey,
  upgradeKeymap,
  type BindingRow,
  type Keymap,
  type KeymapBinding,
} from '../../../domain/preferences/keymap';
import { defaultShortcuts, shortcutOwner } from '../../../domain/preferences/shortcuts';
import { settingCatalog } from '../../../domain/preferences/catalog';
import { errorMessage } from '../../../domain/errors';
import { useConfirmation } from './ConfirmAction';
import { useSessionKeys } from '../../keys/session';
import { ChoiceButton } from '../ChoiceMenu';
import { Field } from './SettingField';
import { KeyCapture } from './KeyCapture';
import { NumberField } from '../NumberField';
import type { SettingsEditor } from './editor';

const keysFrom = (text: string) => text.trim().split(/\s+/).filter(Boolean);
/** A row's lines as one line: run in turn, as `|` runs them. */
const lineText = (commands: readonly string[]) => commands.join(' | ');
const linesFrom = (text: string) => (text.trim() ? [text.trim()] : []);
const tableName = (table: string) =>
  table === 'prefix' ? 'Prefix' : table === 'root' ? 'No prefix' : `Mode ${table}`;
/** The keys of this session, from `:bind` and `:unbind`: kept in config.jsonc, or let go. */
function SessionBindings({ error }: Pick<SettingsEditor, 'error'>) {
  const session = useSessionKeys();
  if (!session.bindings.length && !session.aliases.length) return null;
  return (
    <section className="keymap-session" aria-label="This session’s keys">
      <h3>This session</h3>
      <ul>
        {session.bindings.map((binding, index) => (
          <li key={index}>
            <span>{tableName(binding.table)}</span>
            <kbd>{binding.keys.map(keyGlyphs).join(' ')}</kbd>
            <code>{binding.line ?? 'unbound'}</code>
            {binding.repeat && <span>repeats</span>}
          </li>
        ))}
        {session.aliases.map((alias, index) => (
          <li key={`alias-${index}`}>
            <span>Command</span>
            <kbd>:{alias.name}</kbd>
            <code>{alias.line ?? 'forgotten'}</code>
          </li>
        ))}
      </ul>
      <div className="settings-actions">
        <button
          className="primary"
          onClick={() =>
            void window.viewer.sessionKeysKeep().catch((failure) => error(errorMessage(failure)))
          }
        >
          Keep
        </button>
        <button
          onClick={() =>
            void window.viewer.sessionKeysDiscard().catch((failure) => error(errorMessage(failure)))
          }
        >
          Discard
        </button>
      </div>
    </section>
  );
}
/**
 * Prefix keys: the prefix, the leader, and the tables of keys: the prefix's, keys with
 * no prefix, and modes. Each key is recorded by pressing it; what it runs is a line.
 */
export function KeymapSettings({ editor }: { editor: SettingsEditor }) {
  const confirmation = useConfirmation();
  const { snapshot, patch, error } = editor;
  const keymap: Keymap = upgradeKeymap({ ...defaultKeymap, ...snapshot.settings.keymap });
  const [table, setTable] = useState('prefix');
  const [draft, setDraft] = useState({ keys: '', line: '' });
  const pendingDraft = useRef<{ draft: typeof draft; table: string; revision: number } | undefined>(
    undefined,
  );
  const [modeName, setModeName] = useState('');
  const modes = keymap.modes ?? {};
  const shown = table === 'prefix' || table === 'root' || modes[table] ? table : 'prefix';
  const bindings: Record<string, KeymapBinding> =
    shown === 'prefix'
      ? keymap.bindings
      : shown === 'root'
        ? (keymap.root ?? {})
        : modes[shown]!.bindings;
  const rows = bindingRows(bindings);
  useEffect(() => {
    if (
      pendingDraft.current?.draft === draft &&
      pendingDraft.current.table === shown &&
      pendingDraft.current.revision < snapshot.revision &&
      rows.some(
        (row) => row.keys.join(' ') === draft.keys && lineText(row.commands) === draft.line.trim(),
      )
    ) {
      pendingDraft.current = undefined;
      setDraft({ keys: '', line: '' });
    }
  }, [rows, draft, shown, snapshot.revision]);
  // a whole keymap each time, whatever the snapshot held
  const save = (next: Partial<Keymap>) => patch('settings.keymap', { ...keymap, ...next });
  const saveRows = (next: BindingRow[]) => {
    if (shown === 'root' && next.some((row) => !rootKey(row.keys[0] ?? ''))) {
      error('A key without the prefix needs ⌃, ⌥ or ⌘, or is an F-key.');
      return;
    }
    const tableBindings = bindingsFrom(next);
    if (shown === 'prefix') save({ bindings: tableBindings });
    else if (shown === 'root') save({ root: tableBindings });
    else save({ modes: { ...modes, [shown]: { bindings: tableBindings } } });
  };
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
      {/* a div: a click on the text would start key capture */}
      <div className="settings-row">
        <span>Prefix</span>
        <KeyCapture
          label="Prefix"
          kind="shortcut"
          value={keymap.prefix}
          owner={(value) => shortcutOwner(snapshot.settings, value, 'keymap-prefix')}
          onChange={(prefix) => save({ prefix })}
        />
      </div>
      {/* a div: a click on the text would start key capture */}
      <div className="settings-row">
        <span>Leader</span>
        <KeyCapture
          label="Leader"
          kind="leader"
          value={keymap.leader}
          onChange={(leader) => save({ leader })}
        />
      </div>
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
        <NumberField
          aria-label="Timeout"
          min={300}
          max={10000}
          value={keymap.timeout}
          onCommit={(timeout) => save({ timeout })}
        />
      </label>
      <label className="settings-row">
        <span>Repeat time (ms)</span>
        <NumberField
          aria-label="Repeat time"
          min={100}
          max={3000}
          value={keymap.repeatTime}
          onCommit={(repeatTime) => save({ repeatTime })}
        />
      </label>
      <SessionBindings error={error} />
      <div className="settings-row">
        <span>Keys</span>
        <ChoiceButton
          label="Key table"
          value={shown}
          choices={[
            { value: 'prefix', label: 'Prefix' },
            { value: 'root', label: 'No prefix' },
            ...Object.keys(modes).map((name) => ({ value: name, label: `Mode ${name}` })),
          ]}
          onChoose={setTable}
        />
      </div>
      <div className="keymap-rows" role="table" aria-label="Key bindings">
        {rows.map((row, index) => {
          const single = shown === 'prefix' && row.keys.length === 1;
          const repeating = single && keymap.repeat.includes(row.keys[0]!);
          return (
            <div className="keymap-row" role="row" key={row.keys.join(' ')}>
              <KeyCapture
                label={`Keys for ${lineText(row.commands)}`}
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
                label={`Line for ${row.keys.join(' ')}`}
                value={lineText(row.commands)}
                list="keymap-commands"
                save={(text) =>
                  linesFrom(text).length &&
                  saveRows(
                    rows.map((item, at) =>
                      at === index ? { ...item, commands: linesFrom(text) } : item,
                    ),
                  )
                }
              />
              {single ? (
                <label className="keymap-repeat" title="Press again without the prefix">
                  <input
                    type="checkbox"
                    aria-label={`Repeat ${row.keys[0]}`}
                    checked={repeating}
                    onChange={(event) =>
                      save({
                        repeat: event.target.checked
                          ? [...keymap.repeat, row.keys[0]!]
                          : keymap.repeat.filter((key) => key !== row.keys[0]),
                      })
                    }
                  />
                  Repeat
                </label>
              ) : (
                <span />
              )}
              <button
                type="button"
                aria-label={`Remove ${row.keys.join(' ')}`}
                onClick={() => saveRows(rows.filter((_, at) => at !== index))}
              >
                Remove
              </button>
            </div>
          );
        })}
        <div className="keymap-row keymap-new" role="row">
          <KeyCapture
            label="New binding's keys"
            kind="sequence"
            value={draft.keys}
            onChange={(keys) => setDraft({ ...draft, keys })}
          />
          <input
            aria-label="New binding's line"
            placeholder="Line: vs, set grid!, mode resize"
            list="keymap-commands"
            value={draft.line}
            onChange={(event) => setDraft({ ...draft, line: event.target.value })}
          />
          <span />
          <button
            type="button"
            disabled={!keysFrom(draft.keys).length || !linesFrom(draft.line).length}
            onClick={() => {
              pendingDraft.current = { draft, table: shown, revision: snapshot.revision };
              saveRows([...rows, { keys: keysFrom(draft.keys), commands: linesFrom(draft.line) }]);
            }}
          >
            Add
          </button>
        </div>
      </div>
      <div className="settings-actions">
        <input
          aria-label="New mode's name"
          placeholder="New mode: resize, panes"
          value={modeName}
          onChange={(event) => setModeName(event.target.value.toLowerCase())}
        />
        <button
          disabled={!/^[a-z][a-z0-9-]{0,30}$/.test(modeName) || !!modes[modeName]}
          onClick={() => {
            save({ modes: { ...modes, [modeName]: { bindings: {} } } });
            setTable(modeName);
            setModeName('');
          }}
        >
          Add Mode
        </button>
        {shown !== 'prefix' && shown !== 'root' && (
          <button
            className="danger"
            onClick={() =>
              confirmation.ask({
                title: 'Remove Mode “' + shown + '”?',
                detail: 'The mode and its key bindings will be removed.',
                action: 'Remove Mode',
                run: () => {
                  editor.save(({ settings }) => {
                    const current = settings.keymap;
                    if (!current.modes?.[shown]) return [];
                    const { [shown]: _removed, ...remaining } = current.modes;
                    return [{ path: 'settings.keymap', value: { ...current, modes: remaining } }];
                  });
                  setTable('prefix');
                },
              })
            }
          >
            Remove Mode “{shown}”
          </button>
        )}
        <button
          className="danger"
          onClick={() =>
            confirmation.ask({
              title: 'Reset Prefix Keys?',
              detail: 'The prefix, leader, key tables and modes will return to their defaults.',
              action: 'Reset',
              run: () => patch('settings.keymap', defaultKeymap),
            })
          }
        >
          Reset Prefix Keys
        </button>
        {confirmation.dialog}
      </div>
    </>
  );
}
