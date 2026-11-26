import { withAgentDispatch } from '../app/agent-dispatch';
import { terminalEditing } from '../terminals/sessions';
import { explorerCommandIDs } from '../explorer/input';
import { refreshClipboard, getState } from '../state/store';
import { quickPreviewEdit } from '../previews/QuickPreview';
import { openTerminalFind } from '../terminals/find';
import type {
  CommandContext,
  CommandInvocation,
  CommandRegistry,
  ResolvedCommand,
} from './registry';
import type { LineDispatch } from '../command-line/host';
import { editable, textEditFor } from './editing';
import { routeToEditor } from '../editing/planes';
import { overlayOpen } from '../ui/modal';

const previewFindIDs = ['preview.pdf-search', 'preview.djvu-search', 'preview.epub-find'] as const;

export function windowCommandInvoke(
  registry: CommandRegistry,
  windowContext: () => CommandContext,
  previewCommand: (ids: readonly string[]) => ResolvedCommand | undefined,
) {
  /** Runs a command where it belongs; false when nothing ran (a line stops there). */
  return async (
    id: string,
    remember = true,
    agent?: LineDispatch,
    invocation?: CommandInvocation,
  ): Promise<boolean> => {
    if (agent?.deadline !== undefined && Date.now() > agent.deadline)
      throw new Error('The agent action timed out before finishing.');
    const withAgent = (context: CommandContext): CommandContext =>
      agent || invocation
        ? {
            ...context,
            ...(invocation ? { invocation } : {}),
            ...(agent?.modelRequest ? { modelRequest: true } : {}),
            ...(agent?.id ? { agentDispatchID: agent.id } : {}),
            ...(agent?.deadline !== undefined ? { agentDispatchDeadline: agent.deadline } : {}),
          }
        : context;
    // Edit menu Undo, Redo and Select All reach a CodeMirror editor, which `webContents` does not
    if (routeToEditor(id, getState().activePane)) return true;
    // ⌘E in Quick Preview edits the text file it shows, as its plane
    if (id === 'edit-file' && quickPreviewEdit()) return true;
    // ⌘F in a terminal searches its output, rather than opening the file palette
    if (id === 'find-file') {
      const terminal = document.activeElement?.closest<HTMLElement>('.terminal-plane');
      if (terminal?.dataset.terminalId && openTerminalFind(terminal.dataset.terminalId))
        return true;
      // and in a document's preview it finds in the document, as Preview's ⌘F does
      const find = !overlayOpen() && previewCommand(previewFindIDs);
      if (find) {
        await registry.run({ ...find, context: withAgent(find.context) }, false);
        return true;
      }
    }
    if (
      document.activeElement?.closest('.terminal-plane') &&
      (await withAgentDispatch(agent?.id, () => terminalEditing(getState().activePane, id)))
    )
      return true;
    const edit = textEditFor(id, editable(document.activeElement));
    if (edit) {
      await withAgentDispatch(agent?.id, () => window.viewer.textEdit(edit));
      return true;
    }
    if (editable(document.activeElement) && explorerCommandIDs.has(id)) return false;
    if (overlayOpen() && !['palette', 'settings'].includes(id)) return false;
    const context = registry.context(getState().activePane) || windowContext();
    if (id === 'paste' || id === 'paste-move') {
      await withAgentDispatch(agent?.id, () => refreshClipboard());
      if (agent?.deadline !== undefined && Date.now() > agent.deadline)
        throw new Error('The agent action timed out before finishing.');
    }
    return registry.invoke(id, {
      paneID: context.paneID,
      scope: 'window',
      context: withAgent({ ...context, clipboard: getState().clipboard }),
      remember,
    });
  };
}
