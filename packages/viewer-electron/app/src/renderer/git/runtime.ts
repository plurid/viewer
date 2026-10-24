import {
  gitTerminalProfileID,
  readOnlyGitAction,
  type GitActionReply,
  type GitActionRequest,
} from '../../domain/comparison/git-actions';
import { closeTerminal, retainTerminal, terminalSession } from '../terminals/sessions';

/** Subscribe before launching: even a very short Git command retains its first output and exit. */
export async function runGitAction(
  request: GitActionRequest,
  scrollback: number,
  publish: (reply: GitActionReply) => void,
): Promise<GitActionReply> {
  const release = retainTerminal(request.id);
  try {
    const session = await terminalSession(
      {
        id: request.id,
        workspaceID: request.target.workspaceID,
        rootID: request.target.rootID,
        cwd: request.target.directory,
        profileID: gitTerminalProfileID,
        cols: request.cols ?? 80,
        rows: request.rows ?? 24,
      },
      scrollback,
      { readonly: true, processLabel: 'Git' },
    );
    if (session.disposed) throw new Error('The Git terminal closed before launch.');
    const reply = await window.viewer.gitAction(request);
    if (session.disposed) {
      await window.viewer.terminalClose(request.id);
      throw new Error('The Git terminal closed. Check the repository before running it again.');
    }
    session.started = true;
    session.readonly = readOnlyGitAction(request.kind);
    session.terminal.options.disableStdin = session.readonly;
    // Keep the lease until the host record exists, including callbacks from queued layout work.
    publish(reply);
    return reply;
  } catch (error) {
    closeTerminal(request.id);
    throw error;
  } finally {
    release();
  }
}
