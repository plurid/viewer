import { KeyCapture } from './settings/KeyCapture';
import { shortcutOwner } from '../../domain/shortcuts';
import { useState } from 'react';
import type { SettingsPatch, SettingsSnapshot } from '../../domain/services';
import type { CustomAction, TerminalProfile } from '../../domain/automation';
import { Field } from './SettingField';
import { referencesTo } from '../../domain/references';
import { Icon } from './Icon';
import { ChoiceButton } from './ChoiceMenu';
import {
  customActionEdit,
  terminalProfileEdit,
  terminalProfilesEdit,
  type SettingsChange,
} from './settings-edits';
interface Props {
  snapshot: SettingsSnapshot;
  save(patches: SettingsPatch[]): void;
}
interface EditingProps {
  snapshot: SettingsSnapshot;
  save(change: SettingsChange): void;
}
function JsonField({
  label,
  value,
  save,
}: {
  label: string;
  value: unknown;
  save(value: unknown): void;
}) {
  const [error, setError] = useState('');
  return (
    <div className="settings-row">
      <span>{label}</span>
      <div>
        <Field
          label={label}
          multiline
          value={JSON.stringify(value, null, 2)}
          save={(text) => {
            try {
              save(JSON.parse(text));
              setError('');
            } catch {
              setError('Enter valid JSON.');
            }
          }}
        />
        {error && <small role="alert">{error}</small>}
      </div>
    </div>
  );
}
/** A Remove button for an item others use: kept, naming them, until they change (2026-10-20). */
export function ReferencedRemove({
  users,
  onRemove,
  children,
}: {
  users: string[];
  onRemove(): void;
  children: React.ReactNode;
}) {
  return (
    <>
      <button disabled={!!users.length} onClick={onRemove}>
        {children}
      </button>
      {!!users.length && (
        <p className="settings-note">
          Used by {users.join(', ')}. Change or remove {users.length === 1 ? 'it' : 'them'} first.
        </p>
      )}
    </>
  );
}
export function TerminalSettings({ snapshot, save }: EditingProps) {
  const value = snapshot.settings.terminals;
  const patch = (key: string, value: unknown) =>
    save(() => [{ path: 'settings.terminals.' + key, value }]);
  const profile = (id: string, patch: Partial<TerminalProfile>) =>
    save(terminalProfileEdit(id, patch));
  const patchProfiles = (update: (profiles: TerminalProfile[]) => TerminalProfile[]) =>
    save(terminalProfilesEdit(update));
  return (
    <>
      <p className="settings-note">
        Terminal actions use the selected folder, a file’s parent folder, or the active browsing
        column. Each terminal plane gets its own shell.
      </p>
      <label className="settings-row">
        <span>
          External terminal
          <small>Auto uses a running supported terminal, then iTerm, then Terminal.</small>
        </span>
        <Field
          label="External terminal app"
          value={value.application}
          placeholder="auto, iTerm2, Terminal, or /Applications/YourApp.app"
          save={(app) => patch('application', app)}
        />
      </label>
      <label className="settings-row">
        <span>Default shell profile</span>
        <ChoiceButton
          label="Default shell profile"
          value={value.profileID}
          choices={value.profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
          onChoose={(id) => patch('profileID', id)}
        />
      </label>
      <h2>Shell profiles</h2>
      {value.profiles.map((item) => (
        <details className="settings-recipe" key={item.id}>
          <summary>
            <Icon name="right" size={12} />
            <span>{item.name}</span>
          </summary>
          <label className="settings-row">
            <span>Name</span>
            <Field
              label="Profile name"
              value={item.name}
              save={(name) => profile(item.id, { name })}
            />
          </label>
          <label className="settings-row">
            <span>
              Executable<small>Leave empty to use your login shell.</small>
            </span>
            <Field
              label="Shell executable"
              value={item.executable}
              save={(executable) => profile(item.id, { executable })}
            />
          </label>
          <JsonField
            label="Shell arguments"
            value={item.args}
            save={(args) => profile(item.id, { args: args as string[] })}
          />
          <JsonField
            label="Environment"
            value={item.env}
            save={(env) => profile(item.id, { env: env as Record<string, string> })}
          />
          {value.profiles.length > 1 && item.id !== value.profileID && (
            <ReferencedRemove
              users={referencesTo(snapshot.settings, 'profile', item.id)}
              onRemove={() =>
                patchProfiles((profiles) => profiles.filter((profile) => profile.id !== item.id))
              }
            >
              Remove profile
            </ReferencedRemove>
          )}
        </details>
      ))}
      <div className="settings-actions">
        <button
          onClick={() =>
            patchProfiles((profiles) => [
              ...profiles,
              {
                id: crypto.randomUUID(),
                name: 'New shell profile',
                executable: '',
                args: ['-l'],
                env: {},
              },
            ])
          }
        >
          New shell profile
        </button>
      </div>
      <h2>tmux</h2>
      <p className="settings-note">
        Open in tmux creates one window in this shared session. Viewer leaves external tmux sessions
        running when it quits.
      </p>
      {(['executable', 'session', 'socket', 'windowName'] as const).map((key) => (
        <label className="settings-row" key={key}>
          <span>
            {
              {
                executable: 'tmux executable',
                session: 'Shared session',
                socket: 'Socket path (optional)',
                windowName: 'Window name',
              }[key]
            }
          </span>
          <Field
            label={'tmux ' + key}
            value={value.tmux[key]}
            save={(text) => patch('tmux.' + key, text)}
          />
        </label>
      ))}
    </>
  );
}
export function CustomActionSettings({ snapshot, save }: EditingProps) {
  const actions = snapshot.settings.customActions;
  const set = (update: (actions: CustomAction[]) => CustomAction[]) =>
    save((current) => [
      { path: 'settings.customActions', value: update(current.settings.customActions) },
    ]);
  const patch = (
    id: string,
    update: Partial<CustomAction> | ((action: CustomAction) => Partial<CustomAction>),
  ) => save(customActionEdit(id, update));
  const when = (id: string, update: Partial<CustomAction['when']>) =>
    patch(id, (action) => ({ when: { ...action.when, ...update } }));
  const executor = (id: string, kind: CustomAction['executor']['kind'], update: object) =>
    patch(id, (action) =>
      action.executor.kind === kind
        ? { executor: { ...action.executor, ...update } as CustomAction['executor'] }
        : {},
    );
  return (
    <>
      <h2>Custom commands</h2>
      <p className="settings-note">
        Add commands to file actions and Commands. Executable arguments are literal: {'{directory}'}
        , {'{path}'}, {'{name}'}, {'{extension}'}, and a standalone {'{paths}'} are supported. Shell
        actions receive the directory as $1 and selected paths as $2 onward.
      </p>
      {actions.map((action) => (
        <details className="settings-recipe" key={action.id}>
          <summary>
            <Icon name="right" size={12} />
            <span>{action.name}</span>
          </summary>
          <label className="settings-row">
            <span>Name</span>
            <Field
              label="Command name"
              value={action.name}
              save={(name) => patch(action.id, { name })}
            />
          </label>
          <label className="settings-row">
            <span>Search aliases</span>
            <Field
              label="Command aliases"
              value={action.aliases.join(', ')}
              save={(value) =>
                patch(action.id, {
                  aliases: value
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <label className="settings-row">
            <span>Shortcut</span>
            <KeyCapture
              label="Command shortcut"
              kind="shortcut"
              value={action.shortcut}
              owner={(value) => shortcutOwner(snapshot.settings, value, 'custom.' + action.id)}
              onChange={(shortcut) => patch(action.id, { shortcut })}
            />
          </label>
          <label className="settings-row">
            <span>Pin in Commands</span>
            <input
              type="checkbox"
              checked={action.pinned}
              onChange={(event) => patch(action.id, { pinned: event.target.checked })}
            />
          </label>
          <label className="settings-row">
            <span>Order</span>
            <input
              type="number"
              value={action.order}
              onChange={(event) => patch(action.id, { order: Number(event.target.value) })}
            />
          </label>
          <label className="settings-row">
            <span>Icon</span>
            <ChoiceButton
              label="Icon"
              value={action.icon}
              choices={[
                { value: 'command', label: 'Command' },
                { value: 'terminal', label: 'Terminal' },
                { value: 'rename', label: 'Rename' },
                { value: 'folder', label: 'Folder' },
                { value: 'external', label: 'External' },
                { value: 'code', label: 'Code' },
                { value: 'copy', label: 'Copy' },
              ]}
              onChoose={(icon) => patch(action.id, { icon })}
            />
          </label>
          <label className="settings-row">
            <span>Available for</span>
            <ChoiceButton
              label="Available for"
              value={action.when.target}
              choices={[
                { value: 'any', label: 'Files and folders' },
                { value: 'files', label: 'Files' },
                { value: 'folders', label: 'Folders' },
                { value: 'background', label: 'Folder background' },
              ]}
              onChoose={(target) =>
                when(action.id, { target: target as CustomAction['when']['target'] })
              }
            />
          </label>
          <label className="settings-row">
            <span>
              File extensions<small>Leave empty for all formats.</small>
            </span>
            <Field
              label="Command file extensions"
              value={action.when.extensions.join(', ')}
              placeholder="pdf, epub"
              save={(value) =>
                when(action.id, {
                  extensions: value
                    .split(',')
                    .map((item) => item.trim().toLowerCase().replace(/^\./, ''))
                    .filter(Boolean),
                })
              }
            />
          </label>
          <div className="settings-row">
            <span>Selection count</span>
            <div className="command-selection-range">
              <input
                aria-label="Minimum selected items"
                type="number"
                min={0}
                max={action.when.max}
                value={action.when.min}
                onChange={(event) => when(action.id, { min: Number(event.target.value) })}
              />
              <span>to</span>
              <input
                aria-label="Maximum selected items"
                type="number"
                min={action.when.min}
                max={10000}
                value={action.when.max}
                onChange={(event) => when(action.id, { max: Number(event.target.value) })}
              />
            </div>
          </div>
          <label className="settings-row">
            <span>Execution</span>
            <ChoiceButton
              label="Execution"
              value={action.executor.kind}
              choices={[
                { value: 'builtin', label: 'Built-in command' },
                { value: 'sequence', label: 'Command sequence (macro)' },
                { value: 'recipe', label: 'Action recipe' },
                { value: 'terminal', label: 'Terminal plane' },
                { value: 'executable', label: 'Executable' },
                { value: 'shell', label: 'Shell script' },
              ]}
              onChoose={(kind) => {
                const executor: CustomAction['executor'] =
                  kind === 'builtin'
                    ? { kind, command: 'open-terminal' }
                    : kind === 'sequence'
                      ? { kind, commands: ['select-all', 'copy'] }
                      : kind === 'recipe'
                        ? { kind, recipeID: snapshot.settings.recipes[0]?.id ?? 'rename' }
                        : kind === 'terminal'
                          ? { kind, profileID: snapshot.settings.terminals.profileID }
                          : kind === 'shell'
                            ? { kind, executable: '/bin/zsh', script: 'pwd', perItem: false }
                            : {
                                kind: 'executable',
                                executable: '/usr/bin/printf',
                                args: ['%s\\n', '{paths}'],
                                perItem: false,
                              };
                patch(action.id, { executor });
              }}
            />
          </label>
          {action.executor.kind === 'builtin' && (
            <label className="settings-row">
              <span>
                Built-in command<small>Use the command ID from the configuration reference.</small>
              </span>
              <Field
                label="Built-in command ID"
                value={action.executor.command}
                save={(command) => patch(action.id, { executor: { kind: 'builtin', command } })}
              />
            </label>
          )}
          {action.executor.kind === 'sequence' && (
            <label className="settings-row">
              <span>
                Commands
                <small>Command IDs in order, separated by commas. Recorded by Record macro.</small>
              </span>
              <Field
                label="Command sequence"
                value={action.executor.commands.join(', ')}
                save={(text) =>
                  patch(action.id, {
                    executor: {
                      kind: 'sequence',
                      commands: text
                        .split(',')
                        .map((command) => command.trim())
                        .filter(Boolean),
                    },
                  })
                }
              />
            </label>
          )}
          {action.executor.kind === 'recipe' && (
            <label className="settings-row">
              <span>Action recipe</span>
              <ChoiceButton
                label="Action recipe"
                value={action.executor.recipeID}
                choices={snapshot.settings.recipes.map((recipe) => ({
                  value: recipe.id,
                  label: recipe.name,
                }))}
                onChoose={(recipeID) =>
                  patch(action.id, { executor: { kind: 'recipe', recipeID } })
                }
              />
            </label>
          )}
          {action.executor.kind === 'terminal' && (
            <label className="settings-row">
              <span>Shell profile</span>
              <ChoiceButton
                label="Shell profile"
                value={action.executor.profileID}
                choices={snapshot.settings.terminals.profiles.map((profile) => ({
                  value: profile.id,
                  label: profile.name,
                }))}
                onChoose={(profileID) =>
                  patch(action.id, { executor: { kind: 'terminal', profileID } })
                }
              />
            </label>
          )}
          {(action.executor.kind === 'executable' || action.executor.kind === 'shell') && (
            <>
              <label className="settings-row">
                <span>Executable</span>
                <Field
                  label="Command executable"
                  value={action.executor.executable}
                  save={(executable) => executor(action.id, action.executor.kind, { executable })}
                />
              </label>
              {action.executor.kind === 'executable' ? (
                <JsonField
                  label="Arguments"
                  value={action.executor.args}
                  save={(args) => executor(action.id, 'executable', { args })}
                />
              ) : (
                <label className="settings-row">
                  <span>
                    Shell script<small>$1 is the directory; $2 onward are selected paths.</small>
                  </span>
                  <Field
                    label="Command shell script"
                    multiline
                    value={action.executor.script}
                    save={(script) => executor(action.id, 'shell', { script })}
                  />
                </label>
              )}
              <label className="settings-row">
                <span>Run once per selected item</span>
                <input
                  type="checkbox"
                  checked={action.executor.perItem}
                  onChange={(event) =>
                    executor(action.id, action.executor.kind, { perItem: event.target.checked })
                  }
                />
              </label>
            </>
          )}
          <button onClick={() => set((actions) => actions.filter((item) => item.id !== action.id))}>
            Remove command
          </button>
        </details>
      ))}
      <div className="settings-actions">
        <button
          onClick={() =>
            set((actions) => [
              ...actions,
              {
                id: crypto.randomUUID(),
                name: 'New command',
                aliases: [],
                icon: 'command',
                shortcut: '',
                order: actions.length,
                pinned: false,
                when: { target: 'any', extensions: [], min: 0, max: 10000 },
                executor: { kind: 'builtin', command: 'open-terminal' },
              },
            ])
          }
        >
          New command
        </button>
      </div>
    </>
  );
}
export function ConfigurationSettings({ snapshot, save }: Props) {
  const [message, setMessage] = useState('');
  const config = snapshot.config;
  const [section, setSection] = useState('browsing');
  const run = (work: Promise<unknown>, success = '') => {
    void work.then(() => setMessage(success)).catch((error: Error) => setMessage(error.message));
  };
  return (
    <>
      <p className="settings-note">
        Settings and config.jsonc edit the same configuration. Comments are preserved. Invalid edits
        keep the last valid configuration active.
      </p>
      <p className="configuration-path">{config?.path}</p>
      <div className="settings-action-row">
        <button className="primary" onClick={() => run(window.viewer.configOpen())}>
          Open config.jsonc
        </button>
        <button
          onClick={() =>
            run(window.viewer.configValidate(), 'Validation complete. Check diagnostics below.')
          }
        >
          Validate
        </button>
      </div>
      {config?.diagnostics.map((message) => (
        <p className="settings-error" role="alert" key={message}>
          {message}
        </p>
      ))}
      {config?.fallback === 'last-valid' && (
        <p className="settings-error" role="alert">
          Viewer runs on the last valid copy of config.jsonc until the file is fixed.
        </p>
      )}
      {config?.fallback === 'defaults' && (
        <p className="settings-error" role="alert">
          config.jsonc and its last valid copy cannot be read. Viewer runs on its defaults and saves
          nothing until config.jsonc is fixed.
        </p>
      )}
      {config?.missing && (
        <div className="settings-error" role="alert">
          <p>
            config.jsonc was removed. Viewer keeps the current settings and writes the file again
            with your next change.
          </p>
          <button onClick={() => run(window.viewer.configRestore(), 'config.jsonc was restored.')}>
            Restore config.jsonc
          </button>
        </div>
      )}
      {config?.restored && <p role="status">{config.restored}</p>}
      {!!config?.warnings?.length && (
        <>
          <h2>References to missing items</h2>
          <p className="settings-note">
            These stay in config.jsonc; the action or recipe that uses one fails until it is
            changed.
          </p>
          <ul className="settings-warnings">
            {config.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </>
      )}
      {message && <p role="status">{message}</p>}
      <h2>Recent changes</h2>
      {config?.changes.length ? (
        <ul>
          {config.changes.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
      ) : (
        <p className="settings-note">No external changes in this session.</p>
      )}
      <div className="settings-action-row">
        <button onClick={() => run(window.viewer.configTransfer('export'))}>
          Export configuration
        </button>
        <button onClick={() => run(window.viewer.configTransfer('import'))}>
          Import configuration
        </button>
      </div>
      <h2>Reset a section</h2>
      <p className="settings-note">
        This resets the selected configuration section. Your open planes, file operation history,
        credentials and execution approvals are stored separately.
      </p>
      <div className="settings-action-row">
        <ChoiceButton
          label="Configuration section"
          value={section}
          choices={[
            { value: 'browsing', label: 'Browsing' },
            { value: 'folders', label: 'Folder views' },
            { value: 'fileOpening', label: 'File opening' },
            { value: 'previews', label: 'Previews' },
            { value: 'terminals', label: 'Terminals' },
            { value: 'customActions', label: 'Custom commands' },
            { value: 'shortcuts', label: 'Shortcuts' },
            { value: 'search', label: 'Search' },
            { value: 'recipes', label: 'Action recipes' },
          ]}
          onChoose={setSection}
        />
        <button
          onClick={() => {
            const defaults = defaultSettings(snapshot.settings.search.roots[0] || '/');
            save([
              { path: 'settings.' + section, value: defaults[section as keyof typeof defaults] },
            ]);
          }}
        >
          Reset section
        </button>
      </div>
    </>
  );
}
import { defaultSettings } from '../../domain/services';
export function FolderOverrideSettings({ snapshot, save }: Props) {
  const folders = snapshot.settings.folders;
  const count = Object.keys(folders).length;
  return (
    <details className="settings-recipe">
      <summary>
        <Icon name="right" size={12} />
        <span>
          Folder views
          {count > 0 && ` · ${count} ${count === 1 ? 'folder' : 'folders'}`}
        </span>
      </summary>
      <p className="settings-note">
        A folder’s view is shared across planes, roots and workspaces. The controls above set
        defaults for folders without overrides.
      </p>
      {Object.entries(folders).map(([path, view]) => (
        <div className="settings-folder-override" key={path}>
          <span title={path}>{path}</span>
          <ChoiceButton
            label={'View for ' + path}
            value={view.mode || snapshot.settings.browsing.mode}
            choices={[
              { value: 'list', label: 'List' },
              { value: 'grid', label: 'Grid' },
              { value: 'columns', label: 'Columns' },
              { value: 'gallery', label: 'Gallery' },
              { value: 'map', label: 'Map' },
            ]}
            onChoose={(mode) =>
              save([
                {
                  path: 'settings.folders',
                  keys: ['settings', 'folders', path, 'mode'],
                  value: mode,
                },
              ])
            }
          />
          <button
            onClick={() =>
              save([{ path: 'settings.folders', keys: ['settings', 'folders', path], value: null }])
            }
          >
            Reset
          </button>
        </div>
      ))}
      <div className="settings-actions">
        <button
          onClick={() => {
            void window.viewer.chooseFolder().then((path) => {
              if (path)
                save([
                  {
                    path: 'settings.folders',
                    keys: ['settings', 'folders', path, 'mode'],
                    value: snapshot.settings.browsing.mode,
                  },
                ]);
            });
          }}
        >
          Add folder override…
        </button>
      </div>
    </details>
  );
}
