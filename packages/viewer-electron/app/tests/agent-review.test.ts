import { describe, expect, it, vi } from 'vitest';
import type { AgentProposal, AgentProposalKind } from '../src/domain/agents/requests';
import type { CapturedTarget } from '../src/domain/automation/actions';
import type { FileEntry } from '../src/domain/contracts';
import { agentProposalKinds, needsNativeConfirmation } from '../src/domain/agents/requests';
import { reviewButton, reviewNote } from '../src/domain/agents/review';
import { imageTransformSchema } from '../src/domain/operations/transforms';

const { showMessageBox } = vi.hoisted(() => ({
  showMessageBox: vi.fn(async (_options: { message: string; detail: string }) => ({ response: 0 })),
}));
vi.mock('electron', () => ({ dialog: { showMessageBox } }));
import { confirmAgentProposal } from '../src/desktop/native/native-confirmation';

const file = (name: string) => ({ path: '/work/Photos/' + name, name }) as FileEntry;
const target = (selection: FileEntry[]): CapturedTarget => ({
  workspaceID: 'workspace',
  rootID: 'root',
  paneID: 'plane',
  panePath: '/work/Photos',
  directory: '/work/Photos',
  selection,
});
const proposal = (value: Partial<AgentProposal> & Pick<AgentProposal, 'kind'>): AgentProposal => ({
  id: 'proposal',
  title: 'Generated request',
  detail: '',
  status: 'review',
  ...value,
});
// Every kind, with the targets that change what its review says.
const proposals: Record<AgentProposalKind, AgentProposal[]> = {
  command: [
    proposal({
      kind: 'command',
      title: 'Move to Trash',
      commandID: 'trash',
      removal: 'trash',
      target: target([file('A.jpg'), file('B.jpg')]),
    }),
    proposal({ kind: 'command', title: 'Rename', target: target([file('A.jpg')]) }),
    proposal({ kind: 'command', title: 'New Folder', target: target([]) }),
  ],
  configuration: [
    proposal({
      kind: 'configuration',
      patches: [
        { path: 'settings.browsing.mode', value: 'columns' },
        { path: 'ui.zoom', value: 1 },
      ],
    }),
  ],
  'terminal-write': [proposal({ kind: 'terminal-write', terminalID: 'terminal' })],
  navigation: [proposal({ kind: 'navigation', title: 'Open path', target: target([]) })],
  transform: [
    proposal({
      kind: 'transform',
      target: target([file('A.jpg')]),
      transform: {
        plan: imageTransformSchema.parse({ kind: 'image', format: 'png' }),
        destination: '/work/Exports',
        name: 'A.png',
      },
    }),
  ],
  speech: [
    proposal({ kind: 'speech', speech: { kind: 'use', model: 'whisper-tiny' } }),
    proposal({
      kind: 'speech',
      speech: { kind: 'import', model: 'whisper-tiny', source: '/work/model.bin' },
    }),
    proposal({ kind: 'speech', speech: { kind: 'install', model: 'whisper-tiny' } }),
  ],
  'task-workflow': [
    proposal({
      kind: 'task-workflow',
      taskSetup: {
        id: 'task',
        name: 'Feature',
        workspaceID: 'workspace',
        workspaceName: 'Work',
        repo: '/work/Repository',
        destination: '/work/Worktrees/Feature',
        branch: 'feature',
        commit: '0'.repeat(40),
        catalogID: 'catalog',
        checkout: { kind: 'new', name: 'feature', baseID: 'main' },
      },
    }),
  ],
};

describe('agent review text', () => {
  it('promises a system dialog exactly for the requests the desktop confirms natively', () => {
    expect(Object.keys(proposals).sort()).toEqual([...agentProposalKinds].sort());
    for (const value of Object.values(proposals).flat()) {
      const note = reviewNote(value);
      const asks = needsNativeConfirmation(value);
      expect(note.includes('a system dialog asks once more'), value.kind).toBe(asks);
      if (asks) expect(note.startsWith(`After ${reviewButton(value)},`)).toBe(true);
      else if (value.kind !== 'terminal-write') expect(note).toContain('No system dialog follows');
    }
  });
  it('says what approving does for the target under review', () => {
    const [trash, rename, folder] = proposals.command;
    expect(reviewNote(trash)).toBe(
      'After Move to Trash, a system dialog asks once more. Then these 2 items go to the system Trash, where you can restore them.',
    );
    expect(reviewNote(rename)).toBe(
      'After Run Action, a system dialog asks once more. Then “Rename” runs on the selected item.',
    );
    expect(reviewNote(folder)).toContain('“New Folder” runs in this folder.');
    expect(reviewNote(proposals.configuration[0])).toContain(
      'these 2 changes are saved to your configuration',
    );
    expect(reviewButton(proposals.transform[0])).toBe('Export');
    expect(reviewNote(proposals.transform[0])).toBe(
      'Export saves A.png as a new file in /work/Exports. The sources and existing files are kept. No system dialog follows: this review is the approval.',
    );
    expect(proposals.speech.map(reviewButton)).toEqual([
      'Choose Model',
      'Import Model',
      'Download Model',
    ]);
    expect(reviewNote(proposals['task-workflow'][0])).toContain(
      'creates the worktree at /work/Worktrees/Feature',
    );
    expect(reviewNote(proposals.navigation[0])).toBe(
      'Open path changes only what Viewer shows. No files change. No system dialog follows.',
    );
  });
  it('names the requesting client or Chat in native confirmation dialogs', async () => {
    showMessageBox.mockClear();
    await confirmAgentProposal(
      undefined,
      proposal({
        kind: 'command',
        title: 'Rename',
        clientID: 'client-1',
        clientName: 'Research Helper',
        target: target([file('A.jpg')]),
      } as AgentProposal),
    );
    expect(showMessageBox.mock.calls[0]![0]).toMatchObject({
      message: expect.stringContaining('Research Helper'),
    });
    showMessageBox.mockClear();
    await confirmAgentProposal(
      undefined,
      proposal({
        kind: 'command',
        title: 'Move to Trash',
        removal: 'trash',
        clientID: 'chat:conv-1',
        target: target([file('A.jpg')]),
      }),
    );
    expect(showMessageBox.mock.calls[0]![0]).toMatchObject({
      message: expect.stringContaining('Chat'),
    });
  });
  it('bounds large Trash confirmation details on whole lines and keeps the remainder and closing note', async () => {
    showMessageBox.mockClear();
    const entries = Array.from({ length: 300 }, (_, index) =>
      file(`Folder-${String(index + 1).padStart(3, '0')}/Long-Item-Name-${index + 1}.pdf`),
    );
    const closing =
      'Selected folders include the contents counted above; any change to them cancels this approval. Nothing is permanently deleted. This approval applies only to this request.';
    const detail =
      'Move only these items to the system Trash:\n\n' +
      entries.map((item) => item.path).join('\n') +
      '\n\n' +
      closing;
    expect(detail.length).toBeGreaterThan(10000);
    await confirmAgentProposal(
      undefined,
      proposal({
        kind: 'command',
        title: 'Move to Trash',
        commandID: 'trash',
        removal: 'trash',
        target: target(entries),
        detail,
      }),
    );
    const options = showMessageBox.mock.calls[0]![0] as { detail: string };
    expect(options.detail.length).toBeLessThanOrEqual(6000);
    expect(options.detail).toContain(closing);
    expect(options.detail).toMatch(/…and \d+ more, listed in the review\./);
    // Every path line included before the remainder must be intact (not sliced mid-path).
    const listedLines = options.detail
      .split('\n')
      .filter((line) => line.startsWith('/work/Photos/'));
    expect(listedLines.length).toBeGreaterThan(10);
    expect(listedLines.every((line) => line.endsWith('.pdf'))).toBe(true);
  });
});
