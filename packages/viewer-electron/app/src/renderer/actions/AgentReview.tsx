import { useEffect, useState } from 'react';
import type { AgentProposal } from '../../domain/agent-requests';
import { Dialog } from '../ui/primitives';
import { report } from '../state/store';
export function AgentReview() {
  const [proposals, setProposals] = useState<AgentProposal[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void window.viewer.agentReviewList().then(setProposals).catch(report);
    return window.viewer.onEvent((event) => {
      if (event.type === 'agent-proposal')
        setProposals((items) => [
          ...items.filter((item) => item.id !== event.proposal.id),
          event.proposal,
        ]);
    });
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
          {error && <p role="alert">{error}</p>}
        </div>
        <footer>
          <button type="button" disabled={busy} onClick={() => review(false)}>
            Reject
          </button>
          <button className="primary" disabled={busy} type="submit">
            {busy
              ? 'Applying…'
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
