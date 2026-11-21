// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AgentProposal } from '../src/domain/agents/requests';
import type { ActionPlan } from '../src/domain/services';
import type { OperationPlan } from '../src/domain/operations/operation-plan';
import { itemIdentity } from '../src/domain/files/item-identity';
import { AgentReview } from '../src/renderer/actions/AgentReview';
import { ActionHub } from '../src/renderer/actions/ActionHub';
import {
  OperationReviewControls,
  reviewOperationPlan,
} from '../src/renderer/ui/operations/OperationReview';
import { sendWindowEvent } from '../src/renderer/app/window-events';

const workspace = vi.hoisted(() => ({
  rootID: vi.fn(() => 'root'),
}));
vi.mock('../src/renderer/workspace/context', () => ({ useWorkspace: () => workspace }));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('approval dialogs keep initial keyboard focus on Reject, Cancel or Discard', () => {
  it('focuses Reject when AgentReview opens for an export proposal', async () => {
    const proposal: AgentProposal = {
      id: 'proposal-1',
      kind: 'transform',
      title: 'Export preview.webp',
      detail: 'Export /Granted/Photo.png to /Granted/preview.webp',
      status: 'review',
    };
    const agentReview = vi.fn(async () => proposal);
    Object.assign(window, {
      viewer: {
        agentReviewList: vi.fn(async () => [proposal]),
        agentReview,
        onEvent: () => () => {},
      },
    });
    render(<AgentReview />);
    const reject = await screen.findByRole('button', { name: 'Reject' });
    const approve = screen.getByRole('button', { name: 'Export' });
    expect(document.activeElement).toBe(reject);
    expect(document.activeElement).not.toBe(approve);
    fireEvent.click(document.activeElement as HTMLElement);
    await waitFor(() => expect(agentReview).toHaveBeenCalledWith('proposal-1', false));
  });

  it('resets focus to Reject when AgentReview switches to the next queued proposal', async () => {
    const first: AgentProposal = {
      id: 'proposal-first',
      kind: 'transform',
      title: 'Export one.webp',
      detail: 'Export /Granted/One.png to /Granted/one.webp',
      status: 'review',
    };
    const second: AgentProposal = {
      id: 'proposal-second',
      kind: 'transform',
      title: 'Export two.webp',
      detail: 'Export /Granted/Two.png to /Granted/two.webp',
      status: 'review',
    };
    let onEventListener: ((event: { type: string; proposal: AgentProposal }) => void) | undefined;
    Object.assign(window, {
      viewer: {
        agentReviewList: vi.fn(async () => [first, second]),
        agentReview: vi.fn(async () => first),
        onEvent: (listener: (event: { type: string; proposal: AgentProposal }) => void) => {
          onEventListener = listener;
          return () => {};
        },
      },
    });
    render(<AgentReview />);
    const firstApprove = await screen.findByRole('button', { name: 'Export' });
    firstApprove.focus();
    expect(document.activeElement).toBe(firstApprove);
    act(() =>
      onEventListener?.({
        type: 'agent-proposal',
        proposal: { ...first, status: 'cancelled' },
      }),
    );
    await screen.findByText('Export two.webp');
    const nextReject = screen.getByRole('button', { name: 'Reject' });
    expect(document.activeElement).toBe(nextReject);
  });

  it('shows the named client or Chat that requested the action in AgentReview', async () => {
    const namedProposal = {
      id: 'proposal-named',
      kind: 'transform' as const,
      clientID: 'client-1',
      clientName: 'Research Helper',
      title: 'Export preview.webp',
      detail: 'Export /Granted/Photo.png to /Granted/preview.webp',
      status: 'review' as const,
    };
    Object.assign(window, {
      viewer: {
        agentReviewList: vi.fn(async () => [namedProposal]),
        agentReview: vi.fn(async () => namedProposal),
        onEvent: () => () => {},
      },
    });
    const first = render(<AgentReview />);
    expect(await screen.findByText(/Research Helper requested this action\./)).toBeTruthy();
    first.unmount();

    const chatProposal: AgentProposal = {
      id: 'proposal-chat',
      kind: 'navigation',
      clientID: 'chat:thread-1',
      title: 'Open path',
      detail: 'Open /Granted',
      status: 'review',
    };
    Object.assign(window, {
      viewer: {
        agentReviewList: vi.fn(async () => [chatProposal]),
        agentReview: vi.fn(async () => chatProposal),
        onEvent: () => () => {},
      },
    });
    render(<AgentReview />);
    expect(await screen.findByText(/Chat requested this action\./)).toBeTruthy();
  });

  it('focuses Cancel when OperationReview opens', async () => {
    Object.assign(window, {
      viewer: {
        operationPlan: vi.fn(async () => {}),
      },
    });
    render(<OperationReviewControls />);
    const plan: OperationPlan = {
      version: 1,
      id: 'op-1',
      revision: 1,
      created: 1,
      title: 'Review Model Rename Plan',
      status: 'review',
      undoable: true,
      rows: [
        {
          id: 'row-1',
          kind: 'rename',
          source: '/Granted/a.txt',
          name: 'b.txt',
          approved: true,
        },
      ],
    };
    act(() => reviewOperationPlan(plan));
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    const apply = screen.getByRole('button', { name: 'Apply 1 Change' });
    expect(document.activeElement).toBe(cancel);
    expect(document.activeElement).not.toBe(apply);
    // Moving focus to Apply then switching to a different plan must reset focus back to Cancel.
    apply.focus();
    expect(document.activeElement).toBe(apply);
    act(() =>
      reviewOperationPlan({
        ...plan,
        id: 'op-2',
        title: 'Second Model Rename Plan',
      }),
    );
    await screen.findByText('Second Model Rename Plan');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('shows Discard with initial focus in ActionHub review and cancels the plan', async () => {
    const plan: ActionPlan = {
      id: 'plan-1',
      revision: 1,
      recipeID: 'batch-rename',
      title: 'Batch rename',
      status: 'review',
      undoable: true,
      context: {
        workspaceID: 'workspace',
        paneID: 'pane',
        rootID: 'root',
        actor: 'agent',
        sources: ['/Granted/a.txt'],
      },
      rows: [
        {
          id: 'row-1',
          kind: 'rename',
          source: {
            path: '/Granted/a.txt',
            name: 'a.txt',
            parent: '/Granted',
            extension: '.txt',
            kind: 'file',
            directory: false,
            size: 10,
            modified: 1,
            created: 1,
            hidden: false,
            mime: 'text/plain',
            identity: itemIdentity({ dev: 1n, ino: 2n }),
          },
          destination: '/Granted/b.txt',
          approved: true,
          evidence: [],
        },
      ],
    };
    const actionCancel = vi.fn(async () => ({
      ...plan,
      status: 'cancelled' as const,
      revision: 2,
    }));
    const actionApply = vi.fn(async () => plan);
    Object.assign(window, {
      viewer: {
        actionList: vi.fn(async () => [plan]),
        actionCancel,
        actionApply,
        onEvent: () => () => {},
      },
    });
    render(<ActionHub />);
    await screen.findByRole('button', { name: 'Action tasks' });
    act(() => sendWindowEvent('viewer:tasks', 'plan-1'));
    const discard = await screen.findByRole('button', { name: 'Discard' });
    const apply = screen.getByRole('button', { name: 'Apply 1 Change' });
    expect(document.activeElement).toBe(discard);
    expect(document.activeElement).not.toBe(apply);
    fireEvent.click(discard);
    await waitFor(() => expect(actionCancel).toHaveBeenCalledWith('plan-1'));
    expect(actionApply).not.toHaveBeenCalled();
  });
});
