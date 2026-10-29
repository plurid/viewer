import { randomUUID } from 'node:crypto';
import type { CustomAction } from '../../domain/automation/actions';
import type { ApiHandlers } from './schemas';
import type { Terminals } from '../terminals/terminals';
import type { ExternalTerminals } from '../terminals/terminal-launch';
import type { Executions } from '../actions/executions';
import type { GitActions } from '../comparison/git-actions';
import { bindGitTarget, type GitTargetWindow } from '../comparison/git-target';
import type { JournalActivity } from '../journal/activity';
import type { FileAccess } from '../files/file-access';
import type { SettingsService } from '../preferences/settings';

type TerminalHandlers = Pick<
  ApiHandlers,
  | 'terminalApplication'
  | 'terminalExternal'
  | 'terminalStart'
  | 'terminalWrite'
  | 'terminalResize'
  | 'terminalAck'
  | 'terminalClose'
  | 'customExecute'
  | 'runCommand'
  | 'commandDraft'
  | 'executionList'
  | 'executionCancel'
>;
interface TerminalPorts {
  terminals: Pick<Terminals, 'start' | 'write' | 'resize' | 'ack' | 'stop'>;
  external: Pick<ExternalTerminals, 'application' | 'open'>;
  executions: Pick<Executions, 'start' | 'startManual' | 'list' | 'cancel'>;
  gitActions: Pick<GitActions, 'stop'>;
  activity: Pick<JournalActivity, 'cancelGit'>;
  fileAccess: Pick<FileAccess, 'require'>;
  settings: Pick<SettingsService, 'snapshot'>;
  isAgent(owner: number): boolean;
  gitWindow(owner: number): GitTargetWindow | undefined;
  isViewer(owner: number): boolean;
  isSettings(owner: number): boolean;
  originID(owner: number): string | undefined;
  openSettings(focus: string): Promise<void>;
}

/** Programs run only on the person's request. A command a workspace drafts is reviewed and saved
 * in Settings, which takes the draft once. */
export function createTerminalHandlers(ports: TerminalPorts): TerminalHandlers {
  let pendingDraft: CustomAction | undefined;
  return {
    terminalApplication: () => ports.external.application(),
    terminalExternal: async ([cwd, tmux]) => {
      await ports.fileAccess.require([cwd]);
      return ports.external.open(cwd, tmux);
    },
    terminalStart: ([request], owner) => ports.terminals.start(request, owner),
    terminalWrite: ([id, data], owner) => ports.terminals.write(id, data, owner),
    terminalResize: ([id, cols, rows], owner) => ports.terminals.resize(id, cols, rows, owner),
    terminalAck: ([id, bytes], owner) => ports.terminals.ack(id, bytes, owner),
    terminalClose: ([id], owner) => {
      ports.gitActions.stop(id, owner);
      ports.terminals.stop(id, owner);
      ports.activity.cancelGit(id, ports.originID(owner));
    },
    customExecute: async ([actionID, target, values], owner) => {
      // never on an agent's request: its approval was for a recipe or a command, not a program
      if (ports.isAgent(owner)) throw new Error('Agents cannot run programs or shell scripts.');
      return ports.executions.start(actionID, target, values, owner);
    },
    runCommand: async ([script, input], owner) => {
      if (ports.isAgent(owner)) throw new Error('Agents cannot run shell commands.');
      const target = await bindGitTarget(input, ports.gitWindow(owner));
      return ports.executions.startManual(script, target, owner);
    },
    commandDraft: async ([request], owner) => {
      if (request) {
        if (!ports.isViewer(owner))
          throw new Error('Create a command draft from a workspace window.');
        const settings = ports.settings.snapshot().settings;
        const profile = settings.terminals.profiles.find(
          (item) => item.id === settings.terminals.profileID,
        );
        pendingDraft = {
          id: randomUUID(),
          name: request.name,
          aliases: [],
          icon: 'terminal',
          shortcut: '',
          order: settings.customActions.length,
          pinned: false,
          when: { target: 'any', extensions: [], min: 0, max: 2000 },
          executor: {
            kind: 'shell',
            executable: profile?.executable || process.env.SHELL || '/bin/sh',
            script: request.script,
            perItem: false,
          },
        };
        await ports.openSettings('settings.customActions');
        return;
      }
      if (!ports.isSettings(owner)) throw new Error('Review command drafts in Settings.');
      const draft = pendingDraft;
      pendingDraft = undefined;
      return draft;
    },
    executionList: (_args, owner) => ports.executions.list(owner),
    executionCancel: ([id], owner) => ports.executions.cancel(id, owner),
  };
}
