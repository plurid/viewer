import { useEffect, useState } from 'react';
import type { AgentProposal } from '../../domain/agents/requests';
import { Dialog } from '../ui/primitives';
import { report } from '../state/store';
import { followSnapshot } from '../state/requests';
import type { DesktopEvent } from '../../domain/contracts';
export function AgentReview() {
  const [proposals, setProposals] = useState<AgentProposal[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const following = followSnapshot<AgentProposal[], DesktopEvent>({
      load: () => window.viewer.agentReviewList(),
      subscribe: (listener) => window.viewer.onEvent(listener),
      apply: (items, event) =>
        event.type === 'agent-proposal'
          ? [...items.filter((item) => item.id !== event.proposal.id), event.proposal]
          : items,
      set: setProposals,
      failed: report,
    });
    window.addEventListener('viewer:agent-review', following.reload);
    return () => {
      window.removeEventListener('viewer:agent-review', following.reload);
      following.stop();
    };
  }, []);
  const proposal = proposals.find((item) => item.status === 'review');
  if (!proposal || busy) return null;
  const review = (approve: boolean) => {
    setBusy(true);
    setError('');
    void window.viewer
      .agentReview(proposal.id, approve)
      .catch((error: Error) => {
        setError(error.message);
        report(error);
      })
      .finally(() => setBusy(false));
  };
  return (
    <Dialog
      title={proposal.title}
      onClose={() => {
        if (!busy) review(false);
      }}
      wide
      className="agent-review-dialog"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          review(true);
        }}
      >
        <div className="agent-review-body">
          <p>An agent requested this action.</p>
          {proposal.target && (
            <>
              <p className="configuration-path">
                {proposal.target.directory} · {proposal.target.selection.length} selected
              </p>
              {!!proposal.target.selection.length && (
                <ul className="agent-proposal-files">
                  {proposal.target.selection.slice(0, 8).map((file) => (
                    <li key={file.path} title={file.path}>
                      {file.name}
                    </li>
                  ))}
                  {proposal.target.selection.length > 8 && (
                    <li>And {proposal.target.selection.length - 8} more</li>
                  )}
                </ul>
              )}
            </>
          )}
          <pre className="agent-proposal-detail">{proposal.detail}</pre>
          {proposal.kind !== 'navigation' && (
            <p className="muted">
              Viewer asks you once more in a system dialog before anything runs.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
        <footer>
          <button type="button" disabled={busy} onClick={() => review(false)}>
            Reject
          </button>
          <button className="primary" disabled={busy} type="submit">
            {busy
              ? 'Applying…'
              : proposal.kind === 'task-workflow'
                ? 'Create task'
                : proposal.kind === 'speech'
                  ? proposal.speech?.kind === 'use'
                    ? 'Choose model'
                    : proposal.speech?.kind === 'import'
                      ? 'Import model'
                      : 'Download model'
                  : proposal.kind === 'configuration'
                    ? 'Apply changes'
                    : proposal.removal === 'trash'
                      ? 'Move to Trash'
                      : proposal.kind === 'navigation'
                        ? proposal.title
                        : 'Run action'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
