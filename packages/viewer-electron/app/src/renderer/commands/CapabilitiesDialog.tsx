import { useId, useState } from 'react';
import type { Pane } from '../../domain/contracts';
import type { CommandRequest, DiscoverableCommand } from './registry';
import { commandScore, normalize } from './registry';
import {
  defaultToolbar,
  moveToolbarCommand,
  toolbarCommands,
} from '../../domain/preferences/toolbars';
import { activeWorkspace, useViewer } from '../state/store';
import { errorMessage } from '../../domain/errors';
import { useCommands, useCommandRevision } from './context';
import { toolbarKind, saveToolbar } from './toolbar';
import { Dialog, IconButton, PathField } from '../ui/primitives';
import { Disclosure } from '../ui/Disclosure';
import { Icon } from '../ui/Icon';
import { showKeymapHelp } from '../keys/sequences';
import { baseName, paneTitle } from '../../domain/workspaces/planes';
import { previewModules } from '../previews/registry';
import './capabilities.css';

/** Each kind of plane has a toolbar of its own, named in words. */
const planeNames: Record<Pane['type'], string> = {
  task: 'Task',
  receipt: 'Command receipt',
  folder: 'Folder',
  preview: 'Preview',
  search: 'Search results',
  terminal: 'Terminal',
  collection: 'Collection',
  scratch: 'Scratch text',
  note: 'Note',
  check: 'Job check',
  diff: 'Diff',
  'git-changes': 'Git changes',
  chat: 'Conversation',
  server: 'Local server',
  browser: 'Browser',
  media: 'Media editor',
  layout: 'Layout',
  journal: 'Journal',
  overview: 'Overview',
};
/** "PDF document", "Folder": a toolbar kind (toolbar.ts `toolbarKind`) as people say it. */
function toolbarName(kind: string): string {
  if (!kind.startsWith('preview:')) return planeNames[kind as Pane['type']] ?? kind;
  const id = kind.slice('preview:'.length);
  return previewModules.find((module) => module.id === id)?.label ?? 'Other files';
}

/** Inspect, invoke and pin the existing command catalog, all against the captured selection. */
export function CapabilitiesDialog({
  request,
  onClose,
}: {
  request: CommandRequest;
  onClose(): void;
}) {
  const registry = useCommands();
  useCommandRevision(request.paneID);
  const [query, setQuery] = useState(''),
    [onlyAvailable, setOnlyAvailable] = useState(true);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pinLimitID = useId();
  // pinned tools and keyboard help: opening one closes the other (DESIGN.md Discovery Space Rule)
  const sections = useId();
  const settings = useViewer((state) => state.settings.settings);
  const pane = useViewer((state) =>
    activeWorkspace(state).panes.find((pane) => pane.id === request.paneID),
  );
  const kind = toolbarKind(pane);
  const pinned = kind ? toolbarCommands(settings.toolbars, kind) : [];
  // saved pins, even none, are the person's; a reset brings back the kind's defaults, if any
  const customized = !!kind && Object.hasOwn(settings.toolbars, kind);
  const defaults = (kind && defaultToolbar[kind]) || [];
  const commands = registry
    .discover(request)
    .filter((command) => !command.setting && command.id !== 'capabilities');
  const needle = normalize(query.trim());
  const rows = commands
    .map((command) => ({ command, score: needle ? commandScore(command, needle) : 1 }))
    .filter(({ command, score }) => score > 0 && (!onlyAvailable || command.available))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.command.group.localeCompare(b.command.group) ||
        a.command.label.localeCompare(b.command.label),
    );
  const save = async (next: readonly string[] | undefined) => {
    if (!kind || busy) return;
    setBusy(true);
    setError('');
    try {
      await saveToolbar(kind, next);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const run = async (command: DiscoverableCommand) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (await registry.run(command)) onClose();
      else {
        setError('The target changed. Close this view and open it for the current selection.');
        setBusy(false);
      }
    } catch (error) {
      setError(errorMessage(error));
      setBusy(false);
    }
  };
  // Defaults remain visible until explicitly customized; an empty saved array means no pins.
  const effectivePinned = pinned;
  const capturedPath = request.context?.path ?? pane?.path;
  const targetName = request.context?.selection?.length
    ? request.context.selection.length +
      (request.context.selection.length === 1 ? ' selected item' : ' selected items')
    : pane
      ? paneTitle(pane)
      : capturedPath
        ? baseName(capturedPath)
        : 'Workspace';
  return (
    <Dialog title="What can I do here?" wide className="capabilities-dialog" onClose={onClose}>
      <div className="dialog-body capabilities-body">
        <div className="capabilities-context">
          <strong>{targetName}</strong>
          {capturedPath && (
            <PathField className="capabilities-path" path={capturedPath} layout="line" />
          )}
        </div>
        <div className="capabilities-search">
          <input
            data-autofocus
            aria-label="Find an action"
            placeholder="Find an action…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <label>
            <input
              type="checkbox"
              checked={onlyAvailable}
              onChange={(event) => setOnlyAvailable(event.target.checked)}
            />
            Available here
          </label>
        </div>
        {kind && (
          <Disclosure
            variant="compact"
            aria-label="Pinned tools"
            className="capabilities-pins"
            group={sections}
            closeOnEscape
            summary="Pinned to this toolbar"
            meta={
              <>
                · {effectivePinned.length} of 8
                {effectivePinned.length >= 8 && (
                  <small id={pinLimitID}>Unpin a tool to add another.</small>
                )}
              </>
            }
          >
            <div className="capabilities-section-heading">
              <h3>{toolbarName(kind)}</h3>
              <button disabled={busy || !customized} onClick={() => void save(undefined)}>
                Reset to defaults
              </button>
            </div>
            {effectivePinned.length === 0 && (
              <p>
                No pinned tools. Pin an action below
                {customized && defaults.length ? ', or reset to the defaults.' : '.'}
              </p>
            )}
            <ol>
              {effectivePinned.map((id, index) => {
                const command = commands.find((command) => command.id === id);
                return (
                  <li key={id}>
                    <span>
                      {command?.label ?? `Missing action: ${id}`}
                      <small>
                        {command
                          ? command.unavailable
                          : 'Keep this reference, or unpin it. No other action will take its place.'}
                      </small>
                    </span>
                    <div>
                      <IconButton
                        icon="up"
                        label={`Move ${command?.label ?? id} earlier`}
                        disabled={busy || index === 0}
                        onClick={() => void save(moveToolbarCommand(effectivePinned, id, -1))}
                      />
                      <IconButton
                        icon="down"
                        label={`Move ${command?.label ?? id} later`}
                        disabled={busy || index === effectivePinned.length - 1}
                        onClick={() => void save(moveToolbarCommand(effectivePinned, id, 1))}
                      />
                      <button
                        disabled={busy}
                        onClick={() => void save(effectivePinned.filter((item) => item !== id))}
                      >
                        Unpin
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Disclosure>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="capabilities-results" aria-label="Actions">
          <p role="status">
            {rows.length} actions{needle ? ' · closest matches first' : ''}
          </p>
          <div className="capabilities-action-scroll" tabIndex={0} aria-label="Action list">
            {rows.length === 0 && (
              <div className="capabilities-empty" role="status">
                <strong>{needle ? 'No matching actions' : 'No actions available here'}</strong>
                <p>
                  {needle
                    ? 'Try another name or a shorter phrase.'
                    : 'Choose a file or open a different view.'}
                  {onlyAvailable ? ' You can also show actions for other contexts.' : ''}
                </p>
                {needle && <button onClick={() => setQuery('')}>Clear search</button>}
                {onlyAvailable && (
                  <button onClick={() => setOnlyAvailable(false)}>Show all actions</button>
                )}
              </div>
            )}
            <ul>
              {rows.map(({ command }) => (
                <li key={command.id}>
                  <Icon name={command.icon ?? 'command'} size={18} />
                  <div>
                    <strong>{command.label}</strong>
                    <small>
                      {command.group}
                      {command.detail ? ' · ' + command.detail : ''}
                    </small>
                    {!command.available && (
                      <small className="capability-unavailable">{command.unavailable}</small>
                    )}
                  </div>
                  {command.shortcut && <kbd>{command.shortcut}</kbd>}
                  {kind && (
                    <button
                      disabled={
                        busy || (!pinned.includes(command.id) && effectivePinned.length >= 8)
                      }
                      aria-describedby={
                        !pinned.includes(command.id) && effectivePinned.length >= 8
                          ? pinLimitID
                          : undefined
                      }
                      aria-pressed={pinned.includes(command.id)}
                      onClick={() =>
                        void save(
                          pinned.includes(command.id)
                            ? effectivePinned.filter((id) => id !== command.id)
                            : [...effectivePinned, command.id],
                        )
                      }
                    >
                      {pinned.includes(command.id) ? 'Unpin' : 'Pin'}
                    </button>
                  )}
                  <button disabled={!command.available || busy} onClick={() => void run(command)}>
                    Run
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <Disclosure
          variant="compact"
          className="capabilities-help"
          group={sections}
          closeOnEscape
          summary="Keyboard and mouse"
        >
          <dl>
            <dt>Tab · Shift+Tab</dt>
            <dd>Move between controls. Text fields keep their editing keys.</dd>
            <dt>Escape</dt>
            <dd>Dismiss the current dialog or menu before changing the workspace.</dd>
            <dt>File views</dt>
            <dd>
              Arrow keys move selection; Shift extends it. Space previews a file. Double-click opens
              it.
            </dd>
          </dl>
          <button
            onClick={() => {
              onClose();
              showKeymapHelp();
            }}
          >
            Show configured key sequences
          </button>
        </Disclosure>
      </div>
      <footer>
        <button onClick={onClose}>Done</button>
      </footer>
    </Dialog>
  );
}
