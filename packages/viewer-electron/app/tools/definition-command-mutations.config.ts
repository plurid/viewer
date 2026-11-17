import { defineConfig } from 'vitest/config';
import base from '../vitest.config.ts';

interface MutationEdit {
  before: string;
  after: string;
  all?: boolean;
}

interface MutationProbe extends MutationEdit {
  file: string;
  extra?: MutationEdit[];
}

const probes: Record<string, MutationProbe> = {
  rendererAuthority: {
    file: '/src/renderer/terminals/definition-command-session.ts',
    before: 'if (reason) throw new Error(reason);',
    after: '',
  },
  noticeWaiting: {
    file: '/src/renderer/terminals/definition-command-session.ts',
    before: "definitionChoice(workspace, pane).phase === 'waiting',",
    after: 'true,',
  },
  clearLine: {
    file: '/src/desktop/terminals/terminal-worker.ts',
    before: "const clearLine = initial.needsPasteMode ? '\\x15' : '';",
    after: "const clearLine = '';",
  },
  insertMode: {
    file: '/src/desktop/terminals/terminal-worker.ts',
    before: "const insertMode = initial.restoreInsertMode ? '\\x1bS' : '';",
    after: "const insertMode = '';",
  },
  approvalParent: {
    file: '/src/desktop/bridge.ts',
    before: 'definitionWindow.length ? definitionWindow[0] : this.window',
    after: 'definitionWindow[0]',
  },
  closedApprovalParent: {
    file: '/src/desktop/bridge.ts',
    before: 'definitionWindow.length && (!parent || parent.isDestroyed())',
    after: 'false',
  },
  persistedFolder: {
    file: '/src/desktop/workspaces/definition-commands.ts',
    before: 'cwd !== requestedCwd || cwd !== paneCwd',
    after: 'cwd !== requestedCwd',
  },
  inspectedFolder: {
    file: '/src/desktop/workspaces/definition-commands.ts',
    before: 'folders.some((cwd) => cwd !== folders[0])',
    after: 'false',
  },
  inspectedProfile: {
    file: '/src/desktop/workspaces/definition-commands.ts',
    before: "if (request.profileID !== current.profileID) return { kind: 'changed' };",
    after: '',
  },
  pendingApproval: {
    file: '/src/desktop/workspaces/definition-commands.ts',
    before: "if (!wait) return { kind: 'starting' };",
    after: "if (!wait) return { kind: 'stopped' };",
  },
  pendingOwner: {
    file: '/src/desktop/workspaces/definition-commands.ts',
    before: 'pending.owner !== owner ||',
    after: '',
  },
  clientFolder: {
    file: '/src/renderer/terminals/definition-command-session.ts',
    before: "return presentation.kind === 'available' ? presentation : undefined;",
    after: 'return catalogCommand(workspace, pane);',
  },
  zshPrefill: {
    file: '/src/desktop/terminals/terminal-worker.ts',
    before: "initial.restoreInsertMode ? '\\x1bS'",
    after: "initial.restoreInsertMode ? '\\x1bi'",
  },
  lookupWindow: {
    file: '/src/desktop/workspaces/definition-command-lookup.ts',
    before: 'window.workspaceID !== workspaceID',
    after: 'false',
  },
  lookupKey: {
    file: '/src/desktop/workspaces/definition-command-lookup.ts',
    before: 'workspace.definition?.key !== key',
    after: 'false',
  },
  lookupTerminal: {
    file: '/src/desktop/workspaces/definition-command-lookup.ts',
    before: 'item.id === terminalID',
    after: 'true',
  },
  lookupPlane: {
    file: '/src/desktop/workspaces/definition-command-lookup.ts',
    before: 'pane.definitionPlane !== plane',
    after: 'false',
  },
  basis: {
    file: '/src/desktop/workspaces/definition-commands.ts',
    before: 'found.basis !== item.basis',
    after: 'false',
  },
  pasteClearsDcs: {
    file: '/src/desktop/terminals/terminal-start-input.ts',
    before: 'this.dcsWaiting = false;',
    after: '',
  },
  outputClearsDcs: {
    file: '/src/desktop/terminals/terminal-start-input.ts',
    before: 'observeOutput(data: string): void {',
    after: 'observeOutput(data: string): void { if (data) this.dcsWaiting = false;',
  },
  shellReady: {
    file: '/src/desktop/terminals/terminal-worker.ts',
    before: '(initial.needsPasteMode && !initial.input.bracketedPaste)',
    after: 'false',
  },
  latestPaste: {
    file: '/src/desktop/terminals/terminal-start-input.ts',
    before: "if (sequence === '\\x1b[?2004l') this.pasteMode = false;",
    after: '',
  },
  focusMode: {
    file: '/src/desktop/terminals/terminal-start-input.ts',
    before: "if (payload === '18t') return 'size';",
    after: "if (payload === '18t') return 'size'; if (payload === '?1004h') return 'focus';",
  },
  droppedDcsClears: {
    file: '/src/desktop/terminals/terminal-start-input.ts',
    before: "if (dcsReport(sequence)) return 'drop';",
    after: "if (dcsReport(sequence)) { this.dcsWaiting = false; return 'drop'; }",
  },
  dcsDrop: {
    file: '/src/desktop/terminals/terminal-start-input.ts',
    before: "if (dcsReport(sequence)) return 'drop';",
    after: "if (dcsReport(sequence)) return 'pass';",
  },
  pendingQuery: {
    file: '/src/desktop/terminals/terminal-worker.ts',
    before:
      'if (initial.input.waiting || (initial.needsPasteMode && !initial.input.bracketedPaste)) {',
    after: 'if (false) {',
  },
  doubleEscape: {
    file: '/src/desktop/terminals/terminal-start-input.ts',
    before: "if (introducer === '\\x1b') return start + 1;",
    after: '',
  },
  lateYesStore: {
    file: '/src/desktop/actions/execution-confirmations.ts',
    before: 'if (queue.closed) {',
    after: "if (typeof declined === 'boolean') return work;\n  if (queue.closed) {",
    extra: [
      { before: "if (queue.closed) return { kind: 'declined' };", after: '', all: true },
      { before: ') ||\n          queue.closed', after: ')' },
      {
        before:
          'if (unapproved.length) await this.record(fingerprints, confirmed, () => !queue.closed);',
        after: 'if (unapproved.length) await this.record(fingerprints, confirmed);',
      },
    ],
  },
  recordWindow: {
    file: '/src/desktop/actions/execution-confirmations.ts',
    before: 'if (!valid()) return;',
    after: '',
  },
  approvedFolder: {
    file: '/src/desktop/terminals/terminals.ts',
    before: 'options.approvedCwd !== cwd ||',
    after: '',
  },
  workspace: {
    file: '/src/desktop/terminals/terminals.ts',
    before: 'existing.request.workspaceID !== request.workspaceID ||',
    after: '',
  },
  root: {
    file: '/src/desktop/terminals/terminals.ts',
    before: 'existing.request.rootID !== request.rootID ||',
    after: '',
  },
  profile: {
    file: '/src/desktop/terminals/terminals.ts',
    before: 'existing.request.profileID !== request.profileID ||',
    after: '',
  },
  unicodePage: {
    file: '/src/desktop/actions/execution-confirmations.ts',
    before: 'if (end < remaining.length && /[\\uD800-\\uDBFF]/.test(remaining[end - 1]!)) end--;',
    after: '',
  },
  becameRunning: {
    file: '/src/desktop/workspaces/definition-commands.ts',
    before: 'if (await this.ports.terminals.running(current.request, owner)) {',
    after: 'if (false) {',
  },
};
const name = process.env.VIEWER_DEFINITION_COMMAND_MUTATION;
const probe = name ? probes[name] : undefined;
if (name && !probe) throw new Error('Choose a known definition command mutation.');

/** Mutations run in memory so review never changes the shared working tree. */
export default defineConfig({
  ...base,
  plugins: [
    ...(base.plugins ?? []),
    {
      name: 'definition-command-regression-probe',
      enforce: 'pre',
      transform(code, id) {
        if (!probe || !id.endsWith(probe.file)) return;
        let changed = code;
        for (const edit of [probe, ...(probe.extra ?? [])]) {
          if (!changed.includes(edit.before))
            throw new Error('The mutation no longer matches its source.');
          changed = edit.all
            ? changed.replaceAll(edit.before, edit.after)
            : changed.replace(edit.before, edit.after);
        }
        return changed;
      },
    },
  ],
  test: { ...base.test, fsModuleCache: false },
});
