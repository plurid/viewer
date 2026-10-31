// @vitest-environment jsdom
/**
 * THE CHECK PANEL: what is sent and at which level, the permission pictures need, Run and each
 * step with its time, the graded findings with Viewer's reasons and a shared cause's readings, a
 * correction saved only on approval, the tour, the cut sheets with the request's quantities and
 * the corrected copy, and the handoff. A finished check kept when its panel closes: shown again at
 * once while its job is unchanged, marked as before when the job changed, the last five kept.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DesktopEvent, OperationJob } from '../src/domain/contracts';
import type { CheckOpening, CheckProgress, CheckResult } from '../src/domain/fabrication/check';
import type { CheckChange } from '../src/domain/fabrication/job-files';
import type { ModelDataLevel } from '../src/domain/models/permissions';
import type { ModelProvider } from '../src/domain/services';
import type { CommandContext } from '../src/renderer/commands/registry';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { CheckPanel } from '../src/renderer/fabrication/CheckPanel';
import { closeCheck, forgetChecks, openCheck, runCheck } from '../src/renderer/fabrication/check';
import { checkCommands } from '../src/renderer/fabrication/commands';
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
  // the model writes the job's refs: the panel shows the files' names
  summary:
    'The base plate’s DXF S4 puts its right holes 48 mm from the left ones; drawing S2 gives 50 mm.',
  request: [],
  findings: [
    {
      origin: 'model',
      finding: {
        id: 'F1',
        kind: 'pitch',
        summary: 'The bottom holes are 48 mm apart in S4; S2 gives 50 mm.',
        drawing: { ref: 'S2', page: 1, value: 50, quote: '50 mm pitch', box: null, feature: null },
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
      },
      outlines: [
        {
          stop: 'stop-2',
          kind: 'text',
          source: 'page-text',
          label: 'the text on the drawing',
          quote: '50 mm pitch',
          region: [
            [0.4, 0.2],
            [0.6, 0.2],
            [0.6, 0.3],
          ],
        },
        {
          stop: 'stop-2',
          kind: 'feature',
          source: 'segmentation',
          label: 'outline from SAM 3.1',
          confidence: 0.89,
          region: [
            [0.3, 0.4],
            [0.35, 0.4],
            [0.35, 0.45],
          ],
        },
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
        drawing: {
          ref: 'S1',
          page: 1,
          value: 5,
          quote: 'MB20-A1, 5 pieces',
          box: null,
          feature: null,
        },
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
      thickness: { value: 6, source: 'request' },
      question:
        'g6-MB20-A1-4buc.dxf holds 2 separate pieces, and the request asks for 5, which is not a whole number of sets. How many sets should be cut?',
    },
    {
      ref: 'S4',
      path: plate,
      name: 'g6-PL60-B2-2buc.dxf',
      pieces: 1,
      quantity: { sets: 2, pieces: 2, source: 'request' },
      thickness: { value: 6, source: 'request' },
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
    // the job's folder as a probe lists it, for the palette's command
    list: async (path: string) => ({
      path,
      parent: '/Jobs',
      entries: opening.sources.map((source) => ({
        path: source.path,
        parent: path,
        name: source.name,
        extension: '',
        kind: 'file',
        directory: false,
        size: 1000,
        modified: 1,
        created: 1,
        hidden: false,
        mime: '',
        identity: source.path,
      })),
    }),
  });
});
afterEach(() => {
  closeCheck();
  forgetChecks();
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
  await screen.findByText(
    'The bottom holes are 48 mm apart in g6-PL60-B2-2buc.dxf; Job 1042 drawing.pdf gives 50 mm.',
  );
  expect(
    screen.getByText(
      'The base plate’s DXF g6-PL60-B2-2buc.dxf puts its right holes 48 mm from the left ones; drawing Job 1042 drawing.pdf gives 50 mm.',
    ),
  ).toBeTruthy();
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
  expect(screen.getByText('“50 mm pitch” marked on the drawing')).toBeTruthy();
  expect(screen.getByText('Feature: outline from SAM 3.1, confidence 89%')).toBeTruthy();
  // the proposal in one line: what changes, and the copy that holds it
  expect(document.querySelector('.check-correction')!.textContent).toBe(
    'Proposed: pitch along x from 48.00 mm to 50.00 mm, moving 2 holes, saved as g6-PL60-B2-2buc (corrected).dxf beside the original, which is kept.Save g6-PL60-B2-2buc (corrected).dxf',
  );
  expect(screen.getByText('2 pieces · 6 mm, both from the request')).toBeTruthy();
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

it('shows each step of a running check with its time, a cause’s readings and what was left unread', async () => {
  level = 'images';
  let answer!: (value: CheckResult) => void;
  fabrication.mockImplementation(async (request: { kind: string }) =>
    request.kind === 'open'
      ? opening
      : request.kind === 'run'
        ? new Promise((resolve) => (answer = resolve))
        : { kind: 'done' },
  );
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
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
  fireEvent.click(screen.getByRole('button', { name: 'Check 4 files' }));
  await waitFor(() =>
    expect(fabrication).toHaveBeenCalledWith(expect.objectContaining({ kind: 'run' })),
  );
  const step = (id: string, kind: CheckProgress['step'], text: string) =>
    act(() => {
      for (const listener of listeners)
        listener({ type: 'fabrication', progress: { id, step: kind, text } });
    });
  const progress = () => document.querySelector('.check-progress')!.textContent;
  step(opening.id, 'reading', 'Muse Spark is reading the request, 1 drawing page and 2 DXF parts');
  expect(progress()).toContain(
    'Muse Spark is reading the request, 1 drawing page and 2 DXF parts · 0 s',
  );
  clock.mockReturnValue(1_034_000);
  await waitFor(() => expect(progress()).toContain(' · 34 s'), { timeout: 2500 });
  // another check's step is not this one's
  step('another-check', 'outlining', 'SAM 3.1 is outlining 9 features');
  expect(progress()).not.toContain('9 features');
  step(opening.id, 'outlining', 'SAM 3.1 is outlining 3 features');
  expect(progress()).toContain('SAM 3.1 is outlining 3 features · 0 s');
  clock.mockRestore();

  const [pitch] = result.findings as [CheckResult['findings'][number]];
  const reading = (id: string, quote: string, reason: string) => ({
    finding: { ...pitch.finding, id, drawing: { ...pitch.finding.drawing!, quote } },
    grade: { ...pitch.grade, finding: id, reason },
  });
  await act(async () =>
    answer({
      ...result,
      findings: [
        {
          ...pitch,
          finding: {
            ...pitch.finding,
            summary:
              'Hole 5 is 2.00 mm off along x: the 50 mm pitch reads 48.00 mm and the 30 mm pitch reads 32.00 mm. Moving it fixes both.',
          },
          readings: [
            reading(
              'F1',
              '50',
              'Viewer measured 48.00 mm between holes 4 and 5 along x; the drawing gives 50 mm.',
            ),
            reading(
              'F3',
              '30',
              'Viewer measured 32.00 mm between holes 5 and 6 along x; the drawing gives 30 mm.',
            ),
          ],
        },
        {
          origin: 'viewer',
          unread: 'part',
          finding: {
            id: 'F4',
            kind: 'quantity',
            summary:
              'Muse Spark did not read MB20-A1 from the request. Check the request or run the check again.',
            drawing: { ref: 'S1', page: 1, value: null, quote: null, box: null, feature: null },
            dxf: { ref: 'S3', value: null, axis: null, entities: [] },
            photo: null,
            proposal: null,
          },
          grade: {
            finding: 'F4',
            status: 'unverified',
            entities: [],
            reason:
              'The answer lists no part of the request for g6-MB20-A1-4buc.dxf, so nothing was compared.',
            tolerance: 0,
          },
          names: { drawing: 'Job 1042 request.eml', dxf: 'g6-MB20-A1-4buc.dxf' },
          outlines: [],
        },
      ],
    }),
  );
  await screen.findByText(/^Hole 5 is 2\.00 mm off along x/);
  const readings = screen.getByRole('list', { name: 'Readings of F1' });
  expect([...readings.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
    'Confirmed“50”: Viewer measured 48.00 mm between holes 4 and 5 along x; the drawing gives 50 mm.',
    'Confirmed“30”: Viewer measured 32.00 mm between holes 5 and 6 along x; the drawing gives 30 mm.',
  ]);
  expect(
    screen.getByText('Raised by Viewer, from what the answer leaves out of the request.'),
  ).toBeTruthy();
  expect(screen.getByText('Unverified')).toBeTruthy();
});

/** 22:14 on the day of the check, by this machine's clock. */
const evening = new Date(2026, 9, 30, 22, 14).getTime();
const panel = () =>
  render(
    <WorkspaceContext.Provider value={workspace}>
      <CheckPanel />
    </WorkspaceContext.Provider>,
  );
/** The job opened, checked at 22:14 and its correction saved, as a person leaves it. */
async function checkedAndSaved(): Promise<void> {
  await act(() => openCheck([folder], activeWorkspace().id));
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Check 4 files' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  const clock = vi.spyOn(Date, 'now').mockReturnValue(evening);
  fireEvent.click(screen.getByRole('button', { name: 'Check 4 files' }));
  await screen.findByText(
    'The bottom holes are 48 mm apart in g6-PL60-B2-2buc.dxf; Job 1042 drawing.pdf gives 50 mm.',
  );
  clock.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: 'Save g6-PL60-B2-2buc (corrected).dxf' }));
  await waitFor(() => expect(operate).toHaveBeenCalled());
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
}
const kinds = () => fabrication.mock.calls.map(([request]) => (request as { kind: string }).kind);

it('keeps a finished check when its panel closes, and shows it again at once while the job is unchanged', async () => {
  level = 'images';
  let changes: CheckChange[] = [];
  fabrication.mockImplementation(async (request: { kind: string }) =>
    request.kind === 'open'
      ? opening
      : request.kind === 'run'
        ? result
        : request.kind === 'changes'
          ? { kind: 'changes', id: opening.id, changes }
          : { kind: 'done' },
  );
  panel();
  await checkedAndSaved();
  act(() => closeCheck());
  expect(screen.queryByRole('heading', { name: 'Check Job 1042' })).toBeNull();
  // the desktop keeps the record: nothing is closed
  expect(kinds()).toEqual(['open', 'run']);

  // the palette names the check it would show
  const [command] = checkCommands() as [ReturnType<typeof checkCommands>[number]];
  const here: CommandContext = {
    scope: 'folder',
    workspaceID: activeWorkspace().id,
    directory: folder,
    selection: [],
    clipboard: null,
    jobs: [],
  };
  await waitFor(() => expect(command.when(here)).toBe(true));
  expect(typeof command.detail === 'function' && command.detail(here)).toBe(
    'Show the check from 22:14: 2 findings, 1 confirmed by Viewer',
  );

  await act(() => openCheck([folder], activeWorkspace().id));
  expect(kinds()).toEqual(['open', 'run', 'changes']);
  expect(screen.getByRole('heading', { name: 'Check Job 1042' })).toBeTruthy();
  expect(document.querySelector('.check-since')!.textContent).toBe('Checked at 22:14 · Run again');
  expect(
    screen.getByText(
      'The bottom holes are 48 mm apart in g6-PL60-B2-2buc.dxf; Job 1042 drawing.pdf gives 50 mm.',
    ),
  ).toBeTruthy();
  // the correction saved shows as saved, and the cut sheets nest its copy
  expect(screen.getByText('Saved: pitch 48.00 mm → 50.00 mm, measured again.')).toBeTruthy();
  expect(screen.getByText('g6-PL60-B2-2buc.dxf, corrected copy')).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Play the tour' }) as HTMLButtonElement).disabled,
  ).toBe(false);
  expect(screen.queryByText('What is sent')).toBeNull();
  // one Run again, beside when it was checked, runs the same check
  expect(screen.getAllByRole('button', { name: 'Run again' })).toHaveLength(1);
  changes = [];
  fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
  await waitFor(() => expect(kinds()).toEqual(['open', 'run', 'changes', 'run']));
  expect(fabrication).toHaveBeenLastCalledWith({
    kind: 'run',
    id: opening.id,
    providerID: 'meta',
    pages: [],
  });
});

it('says what changed since a kept check, marks its result as before, and checks the job as it is now', async () => {
  level = 'images';
  const fresh: CheckOpening = { ...opening, id: '9d2e4b1a-7c3f-4a5e-9b8d-1f2a3b4c5d6e' };
  let opens = 0;
  fabrication.mockImplementation(async (request: { kind: string }) =>
    request.kind === 'open'
      ? opens++
        ? fresh
        : opening
      : request.kind === 'run'
        ? result
        : request.kind === 'changes'
          ? {
              kind: 'changes',
              id: opening.id,
              changes: [{ name: 'g6-PL60-B2-2buc.dxf', change: 'changed' }],
            }
          : { kind: 'done' },
  );
  panel();
  await checkedAndSaved();
  act(() => closeCheck());
  await act(() => openCheck([folder], activeWorkspace().id));
  expect(document.querySelector('.check-stale p')!.textContent).toBe(
    'g6-PL60-B2-2buc.dxf changed since the check at 22:14. The findings below are from before.',
  );
  expect(screen.getByRole('heading', { name: 'Findings from 22:14' })).toBeTruthy();
  expect(document.querySelector('.check-since')).toBeNull();
  // nothing of the old result is acted on: only Run again
  for (const name of ['Play the tour', 'Prepare cut sheets', 'Export handoff'])
    expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
  // closed again, the palette does not give its grades as current
  act(() => closeCheck());
  const [command] = checkCommands() as [ReturnType<typeof checkCommands>[number]];
  const here: CommandContext = {
    scope: 'folder',
    workspaceID: activeWorkspace().id,
    directory: folder,
    selection: [],
    clipboard: null,
    jobs: [],
  };
  await waitFor(() => expect(command.when(here)).toBe(true));
  expect(typeof command.detail === 'function' && command.detail(here)).toBe(
    'Show the check from 22:14, before the job changed',
  );
  await act(() => openCheck([folder], activeWorkspace().id));

  fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
  await waitFor(() =>
    expect(fabrication).toHaveBeenLastCalledWith({
      kind: 'run',
      id: fresh.id,
      providerID: 'meta',
      pages: [],
    }),
  );
  expect(kinds()).toEqual(['open', 'run', 'changes', 'changes', 'close', 'open', 'run']);
  expect(fabrication).toHaveBeenCalledWith({ kind: 'close', id: opening.id });
  await waitFor(() => expect(document.querySelector('.check-stale')).toBeNull());
  expect(screen.getByRole('heading', { name: 'Findings' })).toBeTruthy();
});

it('keeps the last five checks, and ends the oldest past them', async () => {
  level = 'images';
  const job = (index: number) => `/Jobs/Job ${index}`;
  const id = (index: number) => `6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4${index}`;
  fabrication.mockImplementation(async (request: { kind: string; paths?: string[] }) => {
    if (request.kind === 'open') {
      const index = Number(request.paths![0]!.split(' ').pop());
      return { ...opening, id: id(index), folder: job(index), job: `Job ${index}` };
    }
    if (request.kind === 'run') return result;
    if (request.kind === 'changes') return { kind: 'changes', id: id(2), changes: [] };
    return { kind: 'done' };
  });
  for (let index = 1; index <= 6; index++) {
    await openCheck([job(index)], activeWorkspace().id);
    await runCheck();
  }
  closeCheck();
  expect(fabrication).toHaveBeenCalledWith({ kind: 'close', id: id(1) });
  expect(kinds().filter((kind) => kind === 'close')).toHaveLength(1);
  // the oldest is listed afresh; the next is shown again
  fabrication.mockClear();
  await openCheck([job(1)], activeWorkspace().id);
  expect(kinds()).toEqual(['open']);
  fabrication.mockClear();
  await openCheck([job(2)], activeWorkspace().id);
  // job 1, listed afresh and not checked, ends as job 2 opens
  expect(kinds()).toEqual(['close', 'changes']);
});

it('says plainly when the folder has nothing to check, and offers nothing to run', async () => {
  fabrication.mockImplementation(async () => ({
    kind: 'nothing',
    folder: '/Jobs/Pictures',
    job: 'Pictures',
    text: 'Pictures holds no DXF or DWG file, so there is nothing to check.',
  }));
  panel();
  await act(() => openCheck(['/Jobs/Pictures'], activeWorkspace().id));
  expect(screen.getByRole('heading', { name: 'Check Pictures' })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe(
    'Pictures holds no DXF or DWG file, so there is nothing to check.',
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
    'Close the check',
  ]);
  act(() => closeCheck());
  expect(kinds()).toEqual(['open']);
});
