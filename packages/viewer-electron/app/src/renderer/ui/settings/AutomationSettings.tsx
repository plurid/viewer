import { KeyCapture } from './KeyCapture';
import { useConfirmation } from './ConfirmAction';
import { shortcutOwner } from '../../../domain/preferences/shortcuts';
import { useState } from 'react';
import type { SettingsPatch, SettingsSnapshot } from '../../../domain/services';
import type { CustomAction, TerminalProfile } from '../../../domain/automation/actions';
import { Field } from './SettingField';
import { referencesTo } from '../../../domain/automation/references';
import { ChoiceButton } from '../ChoiceMenu';
import { CommandFields } from './CommandFields';
import {
  customActionEdit,
  terminalProfileEdit,
  terminalProfilesEdit,
  type SettingsChange,
} from './settings-edits';
import { defaultSettings } from '../../../domain/services';
import { plural } from '../../../domain/plural';
import { errorMessage } from '../../../domain/errors';
import { PathField } from '../primitives';
import { PathLabel } from '../PathLabel';
import { Disclosure } from '../Disclosure';
import { WorkspaceDefinitionsSettings } from './WorkspaceDefinitionsSettings';
import { NumberField } from '../NumberField';
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
  // JSON is a long value: the whole row under its label, as a Mac's form puts a text view
  return (
    <div className="settings-json-field">
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
/** A Remove button for an item others use: kept, naming them, until they change. */
/** The configuration sections Reset a Section offers, as people name them. */
const sectionLabels: Readonly<Record<string, string>> = {
  browsing: 'Browsing',
  folders: 'Folder views',
  fileOpening: 'File opening',
  previews: 'Previews',
  terminals: 'Terminals',
  customActions: 'Custom commands',
  shortcuts: 'Shortcuts',
  search: 'Search',
  recipes: 'Action recipes',
};
export function ReferencedRemove({
  users,
  onRemove,
  name,
  children,
}: {
  users: string[];
  onRemove(): void;
  /** What it removes, as the confirmation names it: "the recipe “Organize”". */
  name: string;
  children: React.ReactNode;
}) {
  const confirmation = useConfirmation();
  return (
    <>
      <button
        className="danger"
        disabled={!!users.length}
        onClick={() =>
          confirmation.ask({
            title: `Remove ${name}?`,
            detail: 'It is removed from your settings. Nothing on disk changes.',
            action: 'Remove',
            run: onRemove,
          })
        }
      >
        {children}
      </button>
      {confirmation.dialog}
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
      <div className="settings-row">
        <span>Default shell profile</span>
        <ChoiceButton
          label="Default shell profile"
          value={value.profileID}
          choices={value.profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
          onChoose={(id) => patch('profileID', id)}
        />
      </div>
      <h2>Shell profiles</h2>
      {value.profiles.map((item) => (
        <Disclosure variant="row" className="settings-recipe" key={item.id} summary={item.name}>
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
              name={`the terminal profile “${item.name}”`}
              users={referencesTo(snapshot.settings, 'profile', item.id)}
              onRemove={() =>
                patchProfiles((profiles) => profiles.filter((profile) => profile.id !== item.id))
              }
            >
              Remove Profile
            </ReferencedRemove>
          )}
        </Disclosure>
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
          New Shell Profile
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
export function CustomActionSettings({
  snapshot,
  save,
  draft,
  onDraftDone,
}: EditingProps & { draft?: CustomAction; onDraftDone?(): void }) {
  const actions = snapshot.settings.customActions;
  const confirmation = useConfirmation();
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
      {draft && (
        <section className="settings-recipe" aria-label="Command draft">
          <h3>{draft.name}</h3>
          {draft.executor.kind === 'shell' && <pre>{draft.executor.script}</pre>}
          <p className="settings-note">
            Add it, then set its name, shortcut and where it shows below. Viewer asks you before it
            first runs.
          </p>
          <button
            onClick={() => {
              set((actions) =>
                actions.some((item) => item.id === draft.id) ? actions : [...actions, draft],
              );
              onDraftDone?.();
            }}
          >
            Add Command
          </button>
          <button onClick={onDraftDone}>Dismiss</button>
        </section>
      )}
      <p className="settings-note">
        Add commands to file menus and Commands. Program arguments are passed as typed, with{' '}
        {'{directory}'}, {'{path}'}, {'{name}'}, {'{extension}'} and {'{paths}'} on its own filled
        in. A shell script receives the folder as $1 and the selected paths as $2 onward.
      </p>
      {actions.map((action) => (
        <Disclosure variant="row" className="settings-recipe" key={action.id} summary={action.name}>
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
          <div className="settings-row">
            <span>Shortcut</span>
            <KeyCapture
              label="Command shortcut"
              kind="shortcut"
              value={action.shortcut}
              owner={(value) => shortcutOwner(snapshot.settings, value, 'custom.' + action.id)}
              onChange={(shortcut) => patch(action.id, { shortcut })}
            />
          </div>
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
            <NumberField value={action.order} onCommit={(order) => patch(action.id, { order })} />
          </label>
          <div className="settings-row">
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
          </div>
          <div className="settings-row">
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
          </div>
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
              <NumberField
                aria-label="Minimum selected items"
                min={0}
                max={action.when.max}
                value={action.when.min}
                onCommit={(min) => when(action.id, { min })}
              />
              <span>to</span>
              <NumberField
                aria-label="Maximum selected items"
                min={action.when.min}
                max={10000}
                value={action.when.max}
                onCommit={(max) => when(action.id, { max })}
              />
            </div>
          </div>
          <div className="settings-row">
            <span>Execution</span>
            <ChoiceButton
              label="Execution"
              value={action.executor.kind}
              choices={[
                { value: 'builtin', label: 'Built-in command' },
                { value: 'sequence', label: 'Command sequence (macro)' },
                { value: 'workflow', label: 'Workflow' },
                { value: 'recipe', label: 'Action recipe' },
                { value: 'terminal', label: 'Terminal plane' },
                { value: 'executable', label: 'Executable' },
                { value: 'shell', label: 'Shell script' },
              ]}
              onChoose={(kind) => {
                const executor: CustomAction['executor'] =
                  kind === 'builtin'
                    ? { kind, command: 'open-terminal' }
                    : kind === 'workflow'
                      ? { kind, steps: [{ kind: 'command', line: 'refresh' }] }
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
          </div>
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
                <small>Command IDs in order, separated by commas. Record Macro fills it in.</small>
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
            <div className="settings-row">
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
            </div>
          )}
          {action.executor.kind === 'terminal' && (
            <div className="settings-row">
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
            </div>
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
          <CommandFields
            action={action}
            actions={actions}
            change={(update) => patch(action.id, update)}
          />
          <button
            className="danger"
            onClick={() =>
              confirmation.ask({
                title: `Remove the command “${action.name}”?`,
                detail: 'Its menu item, shortcut and palette row go with it.',
                action: 'Remove',
                run: () => set((actions) => actions.filter((item) => item.id !== action.id)),
              })
            }
          >
            Remove Command
          </button>
        </Disclosure>
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
          New Command
        </button>
      </div>
      {confirmation.dialog}
    </>
  );
}
export function ConfigurationSettings({ snapshot, save }: Props) {
  const [message, setMessage] = useState('');
  const config = snapshot.config;
  const [section, setSection] = useState('browsing');
  const confirmation = useConfirmation();
  const run = (work: Promise<unknown>, success = '') => {
    void work.then(() => setMessage(success)).catch((error: Error) => setMessage(error.message));
  };
  return (
    <>
      <p className="settings-note">
        Settings and config.jsonc edit the same configuration, and your comments stay. While the
        file has a mistake, Viewer keeps using the last version it could read.
      </p>
      {config?.path && (
        <PathField
          className="configuration-path"
          path={config.path}
          onError={(error) => setMessage(errorMessage(error))}
        />
      )}
      <div className="settings-action-row">
        <button className="primary" onClick={() => run(window.viewer.configOpen())}>
          Open config.jsonc
        </button>
        <button
          onClick={() =>
            run(window.viewer.configValidate(), 'Checked. Any problems are listed below.')
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
          Viewer keeps using the last config.jsonc it could read until the file is fixed.
        </p>
      )}
      {config?.fallback === 'defaults' && (
        <p className="settings-error" role="alert">
          Neither config.jsonc nor its last copy can be read. Viewer uses its defaults and saves
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
            <li key={path}>
              <PathLabel path={path} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="settings-note">No external changes in this session.</p>
      )}
      <div className="settings-action-row">
        <button onClick={() => run(window.viewer.configTransfer('export'))}>
          Export Configuration
        </button>
        <button onClick={() => run(window.viewer.configTransfer('import'))}>
          Import Configuration
        </button>
      </div>
      <WorkspaceDefinitionsSettings />
      <h2>Reset a section</h2>
      <p className="settings-note">
        Puts the chosen section back to its defaults. Open planes, file operation history, keys and
        approvals are kept.
      </p>
      <div className="settings-action-row">
        <ChoiceButton
          label="Configuration section"
          value={section}
          choices={Object.entries(sectionLabels).map(([value, label]) => ({ value, label }))}
          onChoose={setSection}
        />
        <button
          className="danger"
          onClick={() => {
            const label = sectionLabels[section] ?? section;
            confirmation.ask({
              title: `Reset ${label} to its defaults?`,
              detail:
                section === 'customActions' || section === 'recipes'
                  ? `Every ${label.toLowerCase()} entry of your own is removed.`
                  : `Every ${label} setting goes back to its default.`,
              action: 'Reset',
              run: () => {
                const defaults = defaultSettings(snapshot.home || '/');
                save([
                  {
                    path: 'settings.' + section,
                    value: defaults[section as keyof typeof defaults],
                  },
                ]);
              },
            });
          }}
        >
          Reset Section
        </button>
        {confirmation.dialog}
      </div>
    </>
  );
}
export function FolderOverrideSettings({ snapshot, save }: Props) {
  const folders = snapshot.settings.folders;
  const count = Object.keys(folders).length;
  return (
    <Disclosure
      variant="row"
      className="settings-recipe"
      summary="Folder views"
      meta={count > 0 && plural(count, 'folder')}
    >
      <p className="settings-note">
        A folder’s view is shared across planes, roots and workspaces. The controls above set
        defaults for folders without overrides.
      </p>
      {Object.entries(folders).map(([path, view]) => (
        <div className="settings-folder-override" key={path}>
          <PathField path={path} />
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
          Add Folder Override…
        </button>
      </div>
    </Disclosure>
  );
}
