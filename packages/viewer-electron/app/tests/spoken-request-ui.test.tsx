// @vitest-environment jsdom
/**
 * ASK VIEWER BY VOICE, in the window: "Check this job and prepare the cut sheets" spoken over Job
 * 1042 is transcribed through the Speech settings' provider, shown, planned by Ask Viewer's model,
 * then checked and its cut sheets opened once the check is graded. Without the model's permission
 * Viewer matches the words itself; without the pictures permission the check waits for the
 * person; a job that is not here is offered as the one that is; a step that saves files waits for
 * a press; a recording the speech permission refuses plans nothing.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SpokenAnswer, SpokenRequest } from '../src/domain/command-line/spoken';
import type { DesktopEvent, FileEntry } from '../src/domain/contracts';
import type { CheckOpening, CheckResult } from '../src/domain/fabrication/check';
import type { ModelDataLevel } from '../src/domain/models/permissions';
import type { ModelProvider } from '../src/domain/services';
import type { SpeechReply, SpeechRequest } from '../src/domain/speech/recognition';
import type { CommandContext } from '../src/renderer/commands/registry';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import type * as Check from '../src/renderer/fabrication/check';
import { CommandsContext } from '../src/renderer/commands/context';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { CheckPanel } from '../src/renderer/fabrication/CheckPanel';
import { closeCheck, forgetChecks, openCheck, runCheck } from '../src/renderer/fabrication/check';
import { checkCommands, checkResultCommands } from '../src/renderer/fabrication/commands';
import { SpeechControls } from '../src/renderer/speech/SpeechControls';
import { sendWindowEvent } from '../src/renderer/app/window-events';
import { closeSpoken } from '../src/renderer/command-line/spoken';
import { WorkspaceContext } from '../src/renderer/workspace/context';
import { activeWorkspace, getState, initialize } from '../src/renderer/state/store';
import { update } from '../src/renderer/state/core';
import { spokenRun } from '../src/domain/command-line/spoken';
import { jobFolderCommands } from '../tools/speech/transcribe-live';

const { shown, audio } = vi.hoisted(() => ({
  shown: new Map<string, FileEntry[]>(),
  audio: { capture: vi.fn(), finish: vi.fn(), cancel: vi.fn() },
}));
vi.mock('../src/renderer/explorer/useFolder', () => ({
  shownEntries: (path: string) => shown.get(path),
}));
vi.mock('../src/renderer/speech/capture', () => ({ captureAudio: audio.capture }));
vi.mock('../src/renderer/fabrication/pages', () => ({
  drawCheckPages: vi.fn(async () => ({ pages: [], problems: [] })),
}));
// the check store itself runs; these two are watched
vi.mock('../src/renderer/fabrication/check', async (original) => {
  const actual = await original<typeof Check>();
  return { ...actual, openCheck: vi.fn(actual.openCheck), runCheck: vi.fn(actual.runCheck) };
});

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
const names = ['Job 1042 request.eml', 'Job 1042 drawing.pdf', 'g6-PL60-B2-2buc.dxf'];
const plate = `${folder}/g6-PL60-B2-2buc.dxf`;
const opening: CheckOpening = {
  kind: 'opened',
  id: '6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b',
  folder,
  job: 'Job 1042',
  sources: (
    [
      ['S1', 'request', names[0], 'text'],
      ['S2', 'drawing', names[1], 'pages'],
      ['S3', 'dxf', names[2], 'measurement'],
    ] as const
  ).map(([ref, kind, name, sending]) => ({
    ref,
    kind,
    name: name!,
    path: `${folder}/${name}`,
    version,
    sending,
  })),
  skipped: [],
  providers: [],
  providerID: 'meta',
};
const result: CheckResult = {
  kind: 'result',
  id: opening.id,
  provider: { name: 'Meta', model: 'muse-spark-1.3' },
  summary: 'The DXF S3 puts its holes 48 mm apart; drawing S2 gives 50 mm.',
  request: [],
  findings: [
    {
      origin: 'model',
      finding: {
        id: 'F1',
        kind: 'pitch',
        summary: 'The holes are 48 mm apart in S3; S2 gives 50 mm.',
        drawing: { ref: 'S2', page: 1, value: 50, quote: '50 mm pitch', box: null, feature: null },
        dxf: { ref: 'S3', value: 48, axis: 'x', entities: ['8', '9'] },
        photo: null,
        proposal: { target: 50, move: ['9'] },
      },
      grade: {
        finding: 'F1',
        status: 'confirmed',
        measured: 48,
        entities: ['8', '9'],
        reason: 'Viewer measured 48.00 mm between holes 4 and 5 along x; the drawing gives 50 mm.',
        tolerance: 0.05,
      },
      names: { drawing: names[1], dxf: names[2] },
      correction: {
        plan: {
          kind: 'dxf-correction',
          format: 'dxf',
          from: '8',
          to: '9',
          axis: 'x',
          target: 50,
          measured: 48,
          move: [],
        },
        source: plate,
        version,
        name: 'g6-PL60-B2-2buc (corrected).dxf',
      },
      outlines: [],
    },
  ],
  issues: [],
  tour: { name: 'Job 1042', root: folder, stops: [], skipped: [] },
  parts: [
    {
      ref: 'S3',
      path: plate,
      name: names[2]!,
      pieces: 1,
      quantity: { sets: 4, pieces: 4, source: 'request' },
      thickness: { value: 6, source: 'request' },
    },
  ],
  notSent: [],
  seconds: 6.2,
};
const said = 'Check this job and prepare the cut sheets';
const planned = (steps: string[], named = ''): SpokenAnswer => ({
  steps: steps.map((command, index) => ({ command, named: index ? '' : named })),
  unmatched: '',
  explanation: '',
  by: 'Muse Spark',
});

let level: ModelDataLevel | null;
let listeners: ((event: DesktopEvent) => void)[];
let speech: ReturnType<typeof vi.fn<(request: SpeechRequest) => Promise<SpeechReply>>>;
let promptPlan: ReturnType<typeof vi.fn<(request: SpokenRequest) => Promise<SpokenAnswer>>>;
let fabrication: ReturnType<typeof vi.fn>;
let operate: ReturnType<typeof vi.fn>;
/** The model's answer to the check, held until the test gives it. */
let answer: { give(): void; wait: Promise<void> };
const openLayout = vi.fn();
const workspace = { openLayout } as unknown as WorkspaceController;
const edit = vi.fn();

function hold(): typeof answer {
  let give!: () => void;
  const wait = new Promise<void>((resolve) => {
    give = resolve;
  });
  return { give, wait };
}
beforeEach(() => {
  initialize({ home: '/Jobs', platform: 'darwin', state: null, locations: [], openPaths: [] });
  const { settings } = getState();
  update({
    ...getState(),
    settings: { ...settings, settings: { ...settings.settings, providers: [meta] } },
  });
  shown.set(
    folder,
    names.map((name) => ({
      path: `${folder}/${name}`,
      parent: folder,
      name,
      extension: name.split('.').pop()!,
      kind: 'file',
      directory: false,
      size: 1000,
      modified: 1,
      created: 1,
      hidden: false,
      mime: '',
      identity: `${folder}/${name}`,
    })),
  );
  level = 'images';
  listeners = [];
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  audio.finish.mockReset().mockResolvedValue(new Uint8Array(32000));
  audio.cancel.mockReset();
  audio.capture.mockReset().mockResolvedValue({ finish: audio.finish, cancel: audio.cancel });
  speech = vi.fn(async (request: SpeechRequest): Promise<SpeechReply> => {
    if (request.kind === 'begin')
      return {
        id: request.id,
        preferences: { language: 'en', microphone: '', backend: 'hosted' },
        processing: {
          kind: 'hosted',
          providerID: '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed',
          providerName: 'Meta',
          endpoint: 'https://api.meta.ai/v1',
          model: 'muse-voice-transcribe-1.0',
        },
      };
    if (request.kind === 'transcribe')
      return {
        text: said,
        language: 'en',
        seconds: 2.4,
        milliseconds: 800,
        model: 'muse-voice-transcribe-1.0',
      };
    return null;
  });
  promptPlan = vi.fn(async () => planned(['check-laser-job', 'check-cut-sheets']));
  answer = hold();
  answer.give();
  fabrication = vi.fn(async (request: { kind: string }) => {
    if (request.kind === 'open') return opening;
    if (request.kind === 'run') {
      await answer.wait;
      return result;
    }
    return { kind: 'done' };
  });
  operate = vi.fn(async () => 'job-correction');
  vi.stubGlobal('viewer', {
    speech,
    promptPlan,
    promptCancel: vi.fn(async () => {}),
    fabrication,
    operate,
    providerPermissionGet: async () =>
      level
        ? { providerID: 'meta', kind: 'meta', endpoint: 'https://api.meta.ai/v1', level }
        : null,
    providerPermissionSet: vi.fn(async (_id: string, _endpoint: string, next: ModelDataLevel) => {
      level = next;
      for (const listener of listeners) listener({ type: 'model-permission', providerID: 'meta' });
    }),
    onEvent: (listener: (event: DesktopEvent) => void) => {
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((item) => item !== listener);
      };
    },
    openSettings: vi.fn(async () => {}),
  });
});
afterEach(() => {
  closeSpoken();
  closeCheck();
  forgetChecks();
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

/** The window as the person speaks in it: Job 1042 shown in a folder plane, its check, the panel. */
function window_() {
  const registry = new CommandRegistry();
  const here = (): CommandContext => ({
    scope: 'folder',
    workspaceID: activeWorkspace().id,
    paneID: 'plane',
    directory: folder,
    selection: [],
    clipboard: null,
    jobs: getState().jobs,
  });
  registry.register('window', {
    context: here,
    definitions: () => [...checkCommands(), ...checkResultCommands(workspace)],
  });
  render(
    <CommandsContext.Provider value={registry}>
      <WorkspaceContext.Provider value={workspace}>
        <div className="space-overlay">
          <CheckPanel />
          <SpeechControls onEdit={edit} />
        </div>
      </WorkspaceContext.Provider>
    </CommandsContext.Provider>,
  );
}
/** Chooses the microphone, speaks, and finishes: the transcript arrives. */
async function speak() {
  act(() => sendWindowEvent('viewer:dictate'));
  fireEvent.click(await screen.findByRole('button', { name: 'Finish and transcribe' }));
  await screen.findByText(`“${said}”`);
}
const layout = [
  [plate],
  undefined,
  'nesting',
  { quantities: { [plate]: 4 }, thicknesses: { [plate]: 6 } },
];

it('holds the key, shows the words, plans with Muse Spark, checks the job, then opens its cut sheets', async () => {
  answer = hold();
  window_();
  fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
  await screen.findByText('Listening. Release the keys to send it.');
  expect(
    screen.getByText(
      'Finishing sends the recording to Meta at https://api.meta.ai/v1 using muse-voice-transcribe-1.0.',
    ),
  ).toBeTruthy();
  fireEvent.keyUp(window, { key: ' ', code: 'Space' });
  // the words, as soon as they arrive
  await screen.findByText(`“${said}”`);
  expect(speech.mock.calls.map(([request]) => request.kind)).toEqual(['begin', 'transcribe']);

  await screen.findByText('Check Job 1042, then prepare its cut sheets.');
  const asked = promptPlan.mock.calls[0]![0];
  expect(asked.transcript).toBe(said);
  expect(asked.context.folder).toBe(folder);
  expect(asked.context.commands).toContainEqual({
    id: 'check-laser-job',
    label: 'Check laser job…',
    subject: 'Job 1042',
  });
  expect(asked.context.commands).toContainEqual({
    id: 'check-cut-sheets',
    label: 'Prepare cut sheets',
    after: ['check-laser-job'],
  });
  expect(
    screen.getByText(
      'Muse Spark planned this from your words. Viewer checked each step against the commands here.',
    ),
  ).toBeTruthy();

  // the check opens and runs at once: the model may receive pictures
  await waitFor(() => expect(runCheck).toHaveBeenCalledOnce());
  expect(openCheck).toHaveBeenCalledWith([folder], activeWorkspace().id, 'plane');
  expect(fabrication).toHaveBeenCalledWith({
    kind: 'run',
    id: opening.id,
    providerID: 'meta',
    pages: [],
  });
  // the cut sheets wait for the graded check
  expect(openLayout).not.toHaveBeenCalled();
  answer.give();
  await waitFor(() => expect(openLayout).toHaveBeenCalledWith(...layout));
  expect(await screen.findByText('1 finding, 1 confirmed by Viewer')).toBeTruthy();
  expect(screen.getByText('Opened 1 part in a Layout plane')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  // nothing was saved
  expect(operate).not.toHaveBeenCalled();
});

it('asked again over a job checked and unchanged, shows that check rather than paying for another', async () => {
  fabrication.mockImplementation(async (request: { kind: string }) =>
    request.kind === 'open'
      ? opening
      : request.kind === 'run'
        ? result
        : request.kind === 'changes'
          ? { kind: 'changes', id: opening.id, changes: [] }
          : { kind: 'done' },
  );
  window_();
  await speak();
  await waitFor(() => expect(openLayout).toHaveBeenCalledOnce());
  // the panel closes; the window keeps the graded check
  act(() => closeCheck());
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await speak();
  await waitFor(() => expect(openLayout).toHaveBeenCalledTimes(2));
  expect(
    await screen.findByText(/^Checked at \d\d:\d\d: 1 finding, 1 confirmed by Viewer$/),
  ).toBeTruthy();
  const kinds = fabrication.mock.calls.map(([request]) => (request as { kind: string }).kind);
  expect(kinds.filter((kind) => kind === 'run')).toHaveLength(1);
  expect(kinds).toContain('changes');
});

it('without the model’s permission, matches the words itself; without pictures, the check waits for the person', async () => {
  level = null;
  window_();
  await speak();
  await screen.findByText('Check Job 1042, then prepare its cut sheets.');
  expect(promptPlan).not.toHaveBeenCalled();
  expect(
    screen.getByText('Viewer matched your words to its commands. Meta may not receive file names.'),
  ).toBeTruthy();
  await screen.findByText(
    'Meta may not receive pictures yet. Choose Allow pictures for Meta in the check panel, then Check 3 files.',
  );
  expect(runCheck).not.toHaveBeenCalled();
  expect(fabrication).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'run' }));

  // the person allows pictures and runs the check: the plan goes on to its cut sheets
  fireEvent.click(screen.getByRole('button', { name: 'Allow pictures for Meta' }));
  const run = await screen.findByRole('button', { name: 'Check 3 files' });
  await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(run);
  await waitFor(() => expect(openLayout).toHaveBeenCalledWith(...layout));
});

it('says plainly when the words name a job that is not here, and checks the one that is on a press', async () => {
  promptPlan.mockResolvedValue(planned(['check-laser-job', 'check-cut-sheets'], 'job 1043'));
  window_();
  await speak();
  await screen.findByText('Job 1043 is not here. Job 1042 is.');
  expect(openCheck).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Check Job 1042, then prepare its cut sheets' }),
  );
  await waitFor(() => expect(openLayout).toHaveBeenCalledWith(...layout));
  expect(openCheck).toHaveBeenCalledWith([folder], activeWorkspace().id, 'plane');
});

it('keeps a step that saves files for the person’s press', async () => {
  promptPlan.mockResolvedValue(planned(['check-laser-job', 'check-corrections']));
  window_();
  await speak();
  await screen.findByText('Check Job 1042, then save its corrected copies.');
  const save = await screen.findByRole('button', { name: 'Save corrected copies' });
  expect(
    screen.getByText('g6-PL60-B2-2buc (corrected).dxf, beside each original, which is kept'),
  ).toBeTruthy();
  expect(operate).not.toHaveBeenCalled();
  fireEvent.click(save);
  await waitFor(() =>
    expect(operate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'convert',
        sources: [plate],
        name: 'g6-PL60-B2-2buc (corrected).dxf',
      }),
    ),
  );
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull());
});

it('plans nothing when the speech permission refuses the recording, and leads to its settings', async () => {
  speech.mockImplementation(async (request) => {
    if (request.kind === 'begin')
      throw new Error('Allow recordings for Meta in Settings → Speech, then try again.');
    return null;
  });
  window_();
  act(() => sendWindowEvent('viewer:dictate'));
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Allow recordings for Meta in Settings → Speech, then try again.',
  );
  expect(audio.capture).not.toHaveBeenCalled();
  expect(promptPlan).not.toHaveBeenCalled();
  expect(fabrication).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Open speech settings' }));
  expect(window.viewer.openSettings).toHaveBeenCalledWith('settings.speech');
});

it('hands the words to Ask Viewer as text', async () => {
  answer = hold();
  window_();
  await speak();
  fireEvent.click(screen.getByRole('button', { name: 'Edit as text' }));
  expect(edit).toHaveBeenCalledWith(said);
  expect(screen.queryByRole('complementary', { name: 'Ask Viewer by voice' })).toBeNull();
});

it('the live run offers Muse Spark the check’s commands as the app does', () => {
  const definitions = [...checkCommands(), ...checkResultCommands(workspace)];
  for (const sample of jobFolderCommands.filter((command) => command.id.startsWith('check-'))) {
    const definition = definitions.find((item) => item.id === sample.id)!;
    expect(definition.label, sample.id).toBe(sample.label);
    expect(definition.aliases, sample.id).toEqual(sample.aliases);
    expect(definition.spoken?.after, sample.id).toEqual(sample.after);
    expect(definition.spoken?.follows, sample.id).toBe(sample.follows);
    expect(spokenRun(sample.id, []).run, sample.id).toBe(sample.run);
  }
  expect(definitions.filter((item) => item.spoken).map((item) => item.id)).toEqual(
    jobFolderCommands.filter((command) => command.id.startsWith('check-')).map((item) => item.id),
  );
});
