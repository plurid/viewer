import { describe, expect, it } from 'vitest';
import type { AgentProposal, AgentProposalKind } from '../src/domain/agents/requests';
import type { CapturedTarget } from '../src/domain/automation/actions';
import type { FileEntry } from '../src/domain/contracts';
import { agentProposalKinds, needsNativeConfirmation } from '../src/domain/agents/requests';
import { reviewButton, reviewNote } from '../src/domain/agents/review';
import { imageTransformSchema } from '../src/domain/operations/transforms';

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
      'After Run action, a system dialog asks once more. Then “Rename” runs on the selected item.',
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
      'Choose model',
      'Import model',
      'Download model',
    ]);
    expect(reviewNote(proposals['task-workflow'][0])).toContain(
      'creates the worktree at /work/Worktrees/Feature',
    );
    expect(reviewNote(proposals.navigation[0])).toBe(
      'Open path changes only what Viewer shows. No files change. No system dialog follows.',
    );
  });
});
