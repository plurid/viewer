// @vitest-environment jsdom
/**
 * THE CHECK PANEL: what is sent and at which level, the permission pictures need, Run, the graded
 * findings with Viewer's reasons, a correction saved only on approval, the tour, the cut sheets
 * with the request's quantities and the corrected copy, and the handoff.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DesktopEvent, OperationJob } from '../src/domain/contracts';
import type { CheckOpening, CheckResult } from '../src/domain/fabrication/check';
import type { ModelDataLevel } from '../src/domain/models/permissions';
import type { ModelProvider } from '../src/domain/services';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { CheckPanel } from '../src/renderer/fabrication/CheckPanel';
import { closeCheck, openCheck } from '../src/renderer/fabrication/check';
import { WorkspaceContext } from '../src/renderer/workspace/context';
import { activeWorkspace, getState, initialize } from '../src/renderer/state/store';
import { update } from '../src/renderer/state/core';
import { playTour } from '../src/renderer/workspace/tour';
import type * as Tours from '../src/renderer/workspace/tour';

vi.mock('../src/renderer/fabrication/pages', () => ({
  drawCheckPages: vi.fn(async () => ({ pages: [], problems: [] })),
}));
vi.mock('../src/renderer/workspace/tour', async (original) => ({
  ...(await original<typeof Tours>()),
  playTour: vi.fn(),
}));

const meta: ModelProvider = {
  id: 'meta',
  name: 'Meta',
  kind: 'meta',
  endpoint: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3',
  allowContent: false,
};
const folder = '/Jobs/Job 1042';
const version = { identity: '1:2', modified: 1_761_800_000_000, size: 1000 };
const plate = `${folder}/g6-PL60-B2-2buc.dxf`;
const corrected = `${folder}/g6-PL60-B2-2buc (corrected).dxf`;
const opening: CheckOpening = {
  kind: 'opened',
  id: '6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b',
  folder,
  job: 'Job 1042',
  sources: [
    ['S1', 'request', 'Job 1042 request.eml', 'text'],
    ['S2', 'drawing', 'Job 1042 drawing.pdf', 'pages'],
    ['S3', 'dxf', 'g6-MB20-A1-4buc.dxf', 'measurement'],
    ['S4', 'dxf', 'g6-PL60-B2-2buc.dxf', 'measurement'],
  ].map(([ref, kind, name, sending]) => ({
    ref: ref!,
    kind: kind as 'request',
    name: name!,
    path: `${folder}/${name}`,
    version,
    sending: sending as 'text',
  })),
  skipped: [{ name: 'Notes.json', reason: 'not a request, drawing, photo or DXF' }],
  providers: [],
  providerID: 'meta',
};
const plan = {
  kind: 'dxf-correction' as const,
  format: 'dxf' as const,
  from: '8',
  to: '9',
  axis: 'x' as const,
  target: 50,
  measured: 48,
  move: ['11'],
};
const result: CheckResult = {
  kind: 'result',
  id: opening.id,
  provider: { name: 'Meta', model: 'muse-spark-1.3' },
  summary: 'The base plate’s DXF puts its right holes 48 mm from the left ones.',
  request: [],
  findings: [
    {
      origin: 'model',
      finding: {
        id: 'F1',
        kind: 'pitch',
        summary: 'The bottom holes are 48 mm apart in the DXF; the drawing gives 50 mm.',
        drawing: { ref: 'S2', page: 1, value: 50, quote: '50 mm pitch', box: null },
        dxf: { ref: 'S4', value: 48, axis: 'x', entities: ['8', '9'] },
        photo: null,
        proposal: { target: 50, move: ['9', '11'] },
      },
      grade: {
        finding: 'F1',
        status: 'confirmed',
        measured: 48,
        entities: ['8', '9'],
        reason: 'Viewer measured 48.00 mm between holes 4 and 5 along x; the drawing gives 50 mm.',
        tolerance: 0.05,
      },
      names: { drawing: 'Job 1042 drawing.pdf', dxf: 'g6-PL60-B2-2buc.dxf' },
      correction: {
        plan,
        source: plate,
        version,
        name: 'g6-PL60-B2-2buc (corrected).dxf',
        description: [
          'DXF correction',
          'pitch along x from 48.00 mm to 50.00 mm',
          'moves 2 holes',
          'a new DXF beside the original, which is kept',
        ],
      },
      outlines: [
        { stop: 'stop-2', source: 'segmentation', label: 'outline from SAM 3.1', confidence: 0.89 },
      ],
    },
    {
      origin: 'viewer',
      question:
        'g6-MB20-A1-4buc.dxf holds 2 separate pieces, and the request asks for 5, which is not a whole number of sets. How many sets should be cut?',
      finding: {
        id: 'F2',
        kind: 'quantity',
        summary:
          'g6-MB20-A1-4buc.dxf holds 2 separate pieces, and the request asks for 5, which is not a whole number of sets. How many sets should be cut?',
        drawing: { ref: 'S1', page: 1, value: 5, quote: 'MB20-A1, 5 pieces', box: null },
        dxf: { ref: 'S3', value: 4, axis: null, entities: [] },
        photo: null,
        proposal: null,
      },
      grade: {
        finding: 'F2',
        status: 'unverified',
        entities: [],
        reason:
          'Viewer does not choose between sets and pieces: 5 pieces of a drawing of 2 is 2.5 sets.',
        tolerance: 0,
      },
      names: { drawing: 'Job 1042 request.eml', dxf: 'g6-MB20-A1-4buc.dxf' },
      outlines: [],
    },
  ],
  issues: [],
  tour: {
    name: 'Job 1042',
    root: folder,
    stops: [
      {
        id: 'stop-1',
        caption: 'The drawing gives 50 mm.',
        source: 'model',
        target: { kind: 'file', path: 'Job 1042 drawing.pdf', version },
      },
    ],
    skipped: [],
  },
  parts: [
    {
      ref: 'S3',
      path: `${folder}/g6-MB20-A1-4buc.dxf`,
      name: 'g6-MB20-A1-4buc.dxf',
      pieces: 2,
      thickness: { value: 6, source: 'request', text: '6 mm, from the request' },
      question:
        'g6-MB20-A1-4buc.dxf holds 2 separate pieces, and the request asks for 5, which is not a whole number of sets. How many sets should be cut?',
    },
    {
      ref: 'S4',
      path: plate,
      name: 'g6-PL60-B2-2buc.dxf',
      pieces: 1,
      quantity: { sets: 2, pieces: 2, source: 'request', text: '2, from the request' },
      thickness: { value: 6, source: 'request', text: '6 mm, from the request' },
    },
  ],
  notSent: [],
  seconds: 6.2,
};

let level: ModelDataLevel;
let listeners: ((event: DesktopEvent) => void)[];
let operate: ReturnType<typeof vi.fn>;
let fabrication: ReturnType<typeof vi.fn>;
const openLayout = vi.fn();
const workspace = { openLayout } as unknown as WorkspaceController;

beforeEach(() => {
  initialize({ home: '/Jobs', platform: 'darwin', state: null, locations: [], openPaths: [] });
  const { settings } = getState();
  update({
    ...getState(),
    settings: { ...settings, settings: { ...settings.settings, providers: [meta] } },
  });
  level = 'full-text';
  listeners = [];
  operate = vi.fn(async (request: { transform: { kind: string } }) =>
    request.transform.kind === 'dxf-correction' ? 'job-correction' : 'job-handoff',
  );
  fabrication = vi.fn(async (request: { kind: string }) =>
    request.kind === 'open' ? opening : request.kind === 'run' ? result : { kind: 'done' },
  );
  vi.stubGlobal('viewer', {
    fabrication,
    operate,
    providerPermissionGet: async () => ({
      providerID: 'meta',
      kind: 'meta',
      endpoint: 'https://api.meta.ai/v1',
      level,
    }),
    providerPermissionSet: vi.fn(async (_id: string, _endpoint: string, next: ModelDataLevel) => {
      level = next;
      for (const listener of listeners) listener({ type: 'model-permission', providerID: 'meta' });
    }),
    onEvent: (listener: (event: DesktopEvent) => void) => {
      listeners.push(listener);
      return () => {};
    },
    stat: async (path: string) => ({
      path,
      identity: '1:9',
      modified: 1_761_900_000_000,
      size: 1002,
    }),
    openSettings: async () => {},
    save: async () => {},
  });
});
afterEach(() => {
  closeCheck();
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function finish(job: Partial<OperationJob> & { id: string }) {
  act(() =>
    update({
      ...getState(),
      jobs: [
        ...getState().jobs,
        { status: 'completed', completed: [], errors: [], ...job } as OperationJob,
      ],
    }),
  );
}

it('shows what is sent, asks for pictures, runs, and acts on the findings only when asked', async () => {
  render(
    <WorkspaceContext.Provider value={workspace}>
      <CheckPanel />
    </WorkspaceContext.Provider>,
  );
  await act(() => openCheck([folder], activeWorkspace().id));
  expect(screen.getByRole('heading', { name: 'Check Job 1042' })).toBeTruthy();
  expect(screen.getByText('its pages as pictures, with their text')).toBeTruthy();
  expect(
    screen.getAllByText('Viewer’s measurement: holes, pitches and size, not the drawing'),
  ).toHaveLength(2);
  expect(
    screen.getByText(/Left out: Notes\.json \(not a request, drawing, photo or DXF\)/),
  ).toBeTruthy();
  // a text approval does not send pictures
  const run = await screen.findByRole('button', { name: 'Check 4 files' });
  await screen.findByText(
    /Meta may receive filenames, metadata and extracted document text; this check also sends pictures\./,
  );
  expect((run as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Allow pictures for Meta' }));
  expect(window.viewer.providerPermissionSet).toHaveBeenCalledWith(
    'meta',
    'https://api.meta.ai/v1',
    'images',
  );
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Check 4 files' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );

  fireEvent.click(screen.getByRole('button', { name: 'Check 4 files' }));
  await screen.findByText(result.findings[0]!.finding.summary);
  expect(fabrication).toHaveBeenCalledWith({
    kind: 'run',
    id: opening.id,
    providerID: 'meta',
    pages: [],
  });
  expect(screen.getByText('Confirmed')).toBeTruthy();
  expect(screen.getByText('Question')).toBeTruthy();
  expect(
    screen.getByText(
      /Viewer measured 48\.00 mm between holes 4 and 5 along x; the drawing gives 50 mm\./,
    ),
  ).toBeTruthy();
  expect(screen.getByText(/Outline: outline from SAM 3\.1, confidence 89%/)).toBeTruthy();
  expect(screen.getByText(/pitch along x from 48\.00 mm to 50\.00 mm, moves 2 holes/)).toBeTruthy();
  expect(screen.getByText('2, from the request · 6 mm, from the request')).toBeTruthy();
  expect(operate).not.toHaveBeenCalled();

  // the correction is saved only on approval, and its measured result is shown
  fireEvent.click(screen.getByRole('button', { name: 'Save g6-PL60-B2-2buc (corrected).dxf' }));
  await waitFor(() =>
    expect(operate).toHaveBeenCalledWith({
      kind: 'convert',
      sources: [plate],
      destination: folder,
      name: 'g6-PL60-B2-2buc (corrected).dxf',
      transform: plan,
      expectedSources: [{ path: plate, version }],
    }),
  );
  finish({
    id: 'job-correction',
    completed: [
      {
        source: plate,
        destination: corrected,
        correction: {
          axis: 'x',
          target: 50,
          before: 48,
          after: 50,
          shift: { x: 2, y: 0 },
          moved: [],
          web: 10,
          notes: [],
        },
      },
    ],
  });
  await screen.findByText('Saved: pitch 48.00 mm → 50.00 mm, measured again.');
  expect(screen.getByText('g6-PL60-B2-2buc.dxf, corrected copy')).toBeTruthy();

  // the cut sheets nest the corrected copy, with the request's quantities and thicknesses
  fireEvent.click(screen.getByRole('button', { name: 'Prepare cut sheets' }));
  expect(openLayout).toHaveBeenCalledWith(
    [`${folder}/g6-MB20-A1-4buc.dxf`, corrected],
    undefined,
    'nesting',
    {
      quantities: { [corrected]: 2 },
      thicknesses: { [`${folder}/g6-MB20-A1-4buc.dxf`]: 6, [corrected]: 6 },
    },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Play the tour' }));
  expect(playTour).toHaveBeenCalledWith(workspace, {
    name: 'Job 1042',
    root: folder,
    stops: result.tour.stops,
  });

  // the handoff copies the job and the corrected copy, with the 6 mm parts not nested yet
  expect(
    screen.getByText(
      '6 mm is not nested yet: open its tab in the Layout plane and wait for Checked.',
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Export handoff' }));
  await waitFor(() => expect(operate).toHaveBeenCalledTimes(2));
  const [handoff] = operate.mock.calls[1]! as [
    { sources: string[]; transform: { kind: string; check: string; evidence: number[] } },
  ];
  expect(handoff.sources).toEqual([...opening.sources.map((source) => source.path), corrected]);
  expect(handoff.transform).toMatchObject({
    kind: 'fabrication-handoff',
    check: opening.id,
    evidence: [0, 1, 2, 3, 4],
  });
  finish({
    id: 'job-handoff',
    completed: [{ source: '', destination: `${folder}/Job 1042 handoff` }],
  });
  await screen.findByText('Saved “Job 1042 handoff”.');
});

it('says why a check failed, and offers to run it again', async () => {
  level = 'images';
  fabrication.mockImplementation(async (request: { kind: string }) => {
    if (request.kind === 'open') return opening;
    if (request.kind === 'run')
      throw new Error(
        'Meta’s answer does not fit the check’s form at tour, so nothing was graded. Run the check again.',
      );
    return { kind: 'done' };
  });
  render(
    <WorkspaceContext.Provider value={workspace}>
      <CheckPanel />
    </WorkspaceContext.Provider>,
  );
  await act(() => openCheck([folder], activeWorkspace().id));
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Check 4 files' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Check 4 files' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'does not fit the check’s form at tour',
  );
  expect(screen.getByRole('button', { name: 'Run again' })).toBeTruthy();
});
