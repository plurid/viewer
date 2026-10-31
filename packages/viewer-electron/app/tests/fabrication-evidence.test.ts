// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  CheckOpening,
  CheckResult,
  FabricationReply,
  FabricationRequest,
} from '../src/domain/fabrication/check';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import {
  checkSession,
  closeCheck,
  forgetChecks,
  loadCheck,
  openCheck,
  reviewEvidence,
} from '../src/renderer/fabrication/check';
import {
  activeWorkspace,
  flushState,
  initialize,
  newWorkspace,
  setActivePane,
  switchWorkspace,
} from '../src/renderer/state/store';
import { addContentPane } from '../src/renderer/state/panes';

const folder = '/fixtures/Job';
const version = { identity: '1:2', modified: 1, size: 100 };
const opening: CheckOpening = {
  kind: 'opened',
  id: '6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b',
  folder,
  job: 'Job',
  skipped: [],
  providers: [],
  sources: [
    {
      ref: 'S1',
      kind: 'request',
      name: 'Order.txt',
      path: folder + '/Order.txt',
      version,
      sending: 'text',
    },
    {
      ref: 'S2',
      kind: 'drawing',
      name: 'Drawing.pdf',
      path: folder + '/Drawing.pdf',
      version,
      sending: 'pages',
    },
    {
      ref: 'S3',
      kind: 'dxf',
      name: 'Plate.dxf',
      path: folder + '/Plate.dxf',
      version,
      sending: 'measurement',
    },
  ],
};
const result: CheckResult = {
  kind: 'result',
  id: opening.id,
  provider: { name: 'Recorded', model: 'test' },
  summary: 'Review pitch',
  request: [],
  parts: [],
  issues: [],
  notSent: [],
  seconds: 1,
  findings: [
    {
      origin: 'model',
      names: { drawing: 'Drawing.pdf', dxf: 'Plate.dxf' },
      outlines: [],
      grade: {
        finding: 'F1',
        status: 'unverified',
        entities: [],
        reason: 'Review source',
        tolerance: 0.05,
      },
      finding: {
        id: 'F1',
        kind: 'pitch',
        summary: 'Review pitch',
        drawing: { ref: 'S2', page: 1, value: 50, quote: '50 mm pitch', box: null, feature: null },
        dxf: { ref: 'S3', entities: ['1', '2'], axis: 'x', value: 48 },
        photo: null,
        proposal: null,
      },
    },
  ],
  tour: { name: 'Review', root: folder, stops: [], skipped: [] },
};
const saved = (): FabricationReply => ({
  kind: 'saved',
  paths: [folder],
  opening,
  result,
  status: 'completed',
  updated: 100,
  changes: [],
  corrections: {},
  handoffs: [],
});
const fabrication = vi.fn<(request: FabricationRequest) => Promise<FabricationReply>>();
beforeEach(() => {
  Object.assign(window, { viewer: { save: vi.fn(async () => {}), fabrication } });
  initialize({ home: folder, platform: 'darwin', state: null, locations: [], openPaths: [] });
  fabrication
    .mockReset()
    .mockImplementation(async (request) =>
      request.kind === 'changes' ? { kind: 'changes', id: opening.id, changes: [] } : saved(),
    );
});
afterEach(async () => {
  closeCheck();
  forgetChecks();
  await flushState(false);
});
function controller() {
  const space = activeWorkspace();
  return {
    rootID: vi.fn(() => space.panes[0]!.id),
    openEvidence: vi.fn(async (evidence) => evidence.path),
    whenPanesReady: vi.fn(async () => {}),
    captureLayout: vi.fn(() => ({ placements: [] })),
    comparePanes: vi.fn(async () => {}),
    collapsePinnedPane: vi.fn(() => true),
    openCheckPlane: vi.fn(async () => 'check-view'),
  } satisfies Partial<WorkspaceController>;
}

it('keeps views of the same saved check owned by their respective workspaces', async () => {
  const first = activeWorkspace();
  await loadCheck(opening.id, first.id, first.panes[0]!.id, 'first-check');
  await newWorkspace('Second');
  const second = activeWorkspace();
  await loadCheck(opening.id, second.id, second.panes[0]?.id, 'second-check');
  expect(checkSession(opening.id, first.id)?.viewPaneID).toBe('first-check');
  expect(checkSession(opening.id, second.id)?.viewPaneID).toBe('second-check');
  await switchWorkspace(first.id);
  expect(checkSession(opening.id)?.paneID).toBe(first.panes[0]!.id);
});

it('keeps the window attached while saved views still reference the check', async () => {
  const first = activeWorkspace();
  addContentPane({
    id: 'first-check',
    type: 'check',
    checkID: opening.id,
    path: folder,
    title: 'Job',
  });
  const firstView = (await loadCheck(opening.id, first.id, undefined, 'first-check'))!;
  await newWorkspace('Second');
  const second = activeWorkspace();
  addContentPane({
    id: 'second-check',
    type: 'check',
    checkID: opening.id,
    path: folder,
    title: 'Job',
  });
  const secondView = (await loadCheck(opening.id, second.id, undefined, 'second-check'))!;
  closeCheck(firstView);
  closeCheck(secondView);
  forgetChecks();
  expect(fabrication).not.toHaveBeenCalledWith({ kind: 'close', id: opening.id });
});

it('refreshes a running view from its completed document without another model run', async () => {
  const space = activeWorkspace();
  addContentPane({
    id: 'check-view',
    type: 'check',
    checkID: opening.id,
    path: folder,
    title: 'Job',
  });
  const running = saved();
  if (running.kind !== 'saved') throw new Error('Expected a saved fixture.');
  fabrication.mockResolvedValueOnce({ ...running, status: 'running', result: undefined });
  await loadCheck(opening.id, space.id, undefined, 'check-view');
  expect(checkSession(opening.id)?.phase).toBe('asking');
  await loadCheck(opening.id, space.id, undefined, 'check-view', () => true, true);
  expect(checkSession(opening.id)?.phase).toBe('checked');
  expect(checkSession(opening.id)?.result).toEqual(result);
  expect(fabrication.mock.calls.map(([request]) => request.kind)).toEqual(['read', 'read']);
});

it('does not let a background check read replace the active command target', async () => {
  const space = activeWorkspace();
  const otherID = '9c0d1e2f-3a4b-4e5f-8a7b-6f1c2a9e3b4d';
  addContentPane({
    id: 'active-check',
    type: 'check',
    checkID: opening.id,
    path: folder,
    title: 'Job',
  });
  addContentPane({
    id: 'other-check',
    type: 'check',
    checkID: otherID,
    path: folder,
    title: 'Other',
  });
  setActivePane('active-check');
  await loadCheck(opening.id, space.id, undefined, 'active-check');
  const other = saved();
  if (other.kind !== 'saved') throw new Error('Expected a saved fixture.');
  fabrication.mockResolvedValueOnce({
    ...other,
    opening: { ...opening, id: otherID },
    result: { ...result, id: otherID },
  });
  await loadCheck(otherID, space.id, undefined, 'other-check');
  expect(checkSession()?.opening?.id).toBe(opening.id);
  expect(checkSession(otherID)?.result?.id).toBe(otherID);
});

it('opens captured drawing and DXF evidence first, then compares after every view is ready', async () => {
  const space = activeWorkspace();
  const current = (await loadCheck(opening.id, space.id, space.panes[0]!.id))!;
  const view = controller();
  await reviewEvidence(view as unknown as WorkspaceController, current);
  expect(view.openEvidence.mock.calls.map(([evidence]) => evidence.path)).toEqual([
    folder + '/Drawing.pdf',
    folder + '/Plate.dxf',
    folder + '/Order.txt',
  ]);
  for (const call of view.openEvidence.mock.calls)
    expect(call).toEqual([
      expect.objectContaining({ version }),
      space.panes[0]!.id,
      { frame: false },
    ]);
  expect(view.comparePanes).toHaveBeenCalledOnce();
  expect(view.comparePanes.mock.invocationCallOrder[0]).toBeGreaterThan(
    view.whenPanesReady.mock.invocationCallOrder[0]!,
  );
  expect(checkSession()?.evidenceBefore).toEqual({ placements: [] });
});

it('stops a pending review when the originating workspace changes', async () => {
  const space = activeWorkspace();
  const current = (await loadCheck(opening.id, space.id, space.panes[0]!.id))!;
  let release!: (reply: FabricationReply) => void;
  fabrication.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const view = controller();
  const reviewing = reviewEvidence(view as unknown as WorkspaceController, current);
  await newWorkspace('Elsewhere');
  release({ kind: 'changes', id: opening.id, changes: [] });
  await expect(reviewing).rejects.toThrow('originating workspace');
  expect(view.openEvidence).not.toHaveBeenCalled();
  expect(view.comparePanes).not.toHaveBeenCalled();
});

it('does not let a delayed older open replace a newer check request', async () => {
  const space = activeWorkspace();
  let release!: (reply: FabricationReply) => void;
  fabrication.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  fabrication.mockImplementation(async (request) =>
    request.kind === 'list'
      ? {
          kind: 'checks',
          checks: [{ id: opening.id, job: opening.job, folder, status: 'completed', updated: 100 }],
        }
      : saved(),
  );
  const view = controller();
  const older = openCheck(
    ['/fixtures/old'],
    space.id,
    space.panes[0]!.id,
    view as unknown as WorkspaceController,
  );
  await openCheck([folder], space.id, space.panes[0]!.id, view as unknown as WorkspaceController);
  release({
    kind: 'checks',
    checks: [{ id: 'old', job: 'Old', folder: '/fixtures/old', status: 'completed', updated: 1 }],
  });
  await older;
  expect(view.openCheckPlane).toHaveBeenCalledOnce();
  expect(checkSession()?.opening?.id).toBe(opening.id);
});
