import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { Desktop } from '../src/desktop/bridge';
import { OptimizationReviews } from '../src/desktop/transforms/optimization-reviews';
import { reportFailure } from '../src/domain/diagnostics/report-failure';
import type { BrowserWindow } from 'electron';
import type { OperationJob } from '../src/domain/contracts';
import type { DiagnosticErrorFields } from '../src/domain/diagnostics/failure';

vi.mock('electron', () => ({ app: {} }));
vi.mock('../src/desktop/native/window-dialogs', () => ({
  attachWindowDialogs: vi.fn(),
  WindowDialogs: class {},
}));
vi.mock('../src/desktop/preferences/profile-migration', () => ({
  planLegacyProfileRestoration: (state: unknown) => ({
    state,
    patches: [{ path: 'ui.space.grid', value: true }],
    warnings: [],
  }),
}));

function failure(): Error {
  const error = Object.assign(new TypeError('Private client document'), { code: 'ENOENT' });
  error.stack =
    'TypeError: Private client document\n' +
    '    at Private.Client (/Applications/Viewer.app/Contents/main.js:12:76)';
  return error;
}

function fixture() {
  const desktop = Object.create(Desktop.prototype) as Desktop;
  const diagnose = vi.fn<(detail: string, fields?: DiagnosticErrorFields) => void>();
  Object.assign(desktop, { options: { diagnose } });
  return { desktop, diagnose };
}

function invoke(desktop: Desktop, method: string, ...args: unknown[]): unknown {
  return Reflect.get(desktop, method).call(desktop, ...args);
}

function expectMetadata(fields: DiagnosticErrorFields | undefined): void {
  expect(fields).toMatchObject({ errorClass: 'TypeError', code: 'ENOENT' });
  expect(reportFailure({ ...fields }, '/Applications/Viewer.app', new Set(['ENOENT']))).toEqual({
    name: 'TypeError',
    code: 'ENOENT',
    frames: [{ path: 'Contents/main.js', line: 12, column: 76 }],
    outside: 0,
  });
}

describe('desktop failures keep their structured metadata', () => {
  it('records a rejected legacy profile restoration with its error fields', async () => {
    const { desktop, diagnose } = fixture();
    Object.assign(desktop, {
      storage: { load: async () => ({ state: {} }) },
      settings: {
        load: async () => {},
        snapshot: () => ({ revision: 1 }),
        patch: vi.fn().mockRejectedValue(failure()),
      },
      definitions: { load: async () => {} },
      workspaceSessions: { seed: vi.fn() },
    });
    await desktop.prepareSettings();
    expect(diagnose).toHaveBeenCalledOnce();
    expectMetadata(diagnose.mock.calls[0]![1]);
  });

  it('records each rejected window-close cleanup and state save with its error fields', async () => {
    const { desktop, diagnose } = fixture();
    const window = Object.assign(new EventEmitter(), {
      webContents: Object.assign(new EventEmitter(), { id: 7 }),
    });
    const owner = { stopOwner: vi.fn() };
    for (const name of [
      'speech',
      'fabrication',
      'backups',
      'browsers',
      'mediaDocuments',
      'gitActions',
      'worktrees',
      'agentTaskWorkflows',
      'taskRequests',
      'personTaskWorkflows',
      'gitReviews',
      'terminals',
      'executions',
    ])
      Reflect.set(desktop, name, owner);
    Object.assign(desktop, {
      windows: new Map(),
      definitions: { clearRootSearch: vi.fn() },
      agentCommands: new Map(),
      flushes: { disconnected: vi.fn() },
      chats: { retain: vi.fn() },
      canvases: { release: vi.fn() },
      resources: { clear: vi.fn() },
      optimizationReviews: { stopOwner: vi.fn().mockRejectedValue(failure()) },
      webPreviews: { stopOwner: vi.fn().mockRejectedValue(failure()) },
      workspaceSessions: { close: vi.fn(), snapshot: () => ({}) },
      withPreferences: (state: unknown) => state,
      storage: { save: vi.fn().mockRejectedValue(failure()) },
    });
    desktop.attach(window as unknown as BrowserWindow, 'viewer');
    window.emit('closed');
    await vi.waitFor(() => expect(diagnose).toHaveBeenCalledTimes(3));
    for (const [, fields] of diagnose.mock.calls) expectMetadata(fields);
  });

  it('keeps metadata when adding index reconfiguration context', async () => {
    const { desktop, diagnose } = fixture();
    Object.assign(desktop, {
      settings: { snapshot: () => ({ settings: { search: { roots: [] } } }) },
      configureIndex: vi.fn().mockRejectedValue(failure()),
      emit: vi.fn(),
    });
    await invoke(desktop, 'reconfigureIndex');
    expect(diagnose.mock.calls[0]![0]).toBe('Index configuration failed: Private client document');
    expectMetadata(diagnose.mock.calls[0]![1]);
  });

  it('keeps metadata when adding agent audit context', async () => {
    const { desktop, diagnose } = fixture();
    Object.assign(desktop, {
      audited: new Set(),
      agents: { clients: { audit: vi.fn().mockRejectedValue(failure()) } },
    });
    invoke(desktop, 'auditProposal', { id: 'review', title: 'Review', status: 'completed' });
    await vi.waitFor(() => expect(diagnose).toHaveBeenCalledOnce());
    expectMetadata(diagnose.mock.calls[0]![1]);
  });

  it('records a rejected optimization candidate disposal with its error fields', async () => {
    const unused = async (): Promise<never> => {
      throw new Error('This test must not reach a file or process.');
    };
    const diagnose = vi.fn<(detail: string, fields?: DiagnosticErrorFields) => void>();
    const reviews = new OptimizationReviews(
      '/fixtures/candidates',
      { execute: unused, pdfInspect: unused },
      { grant: unused, release: vi.fn() },
      unused,
      () => 'job',
      unused,
      diagnose,
    );
    Reflect.set(reviews, 'jobs', new Map([['job', ['candidate']]]));
    Reflect.set(
      reviews,
      'candidates',
      new Map([
        [
          'candidate',
          {
            released: true,
            jobs: new Set(['job']),
            summary: { id: 'candidate', outputBytes: 0 },
            stage: { dispose: vi.fn().mockRejectedValue(failure()) },
          },
        ],
      ]),
    );
    reviews.jobChanged({ id: 'job', status: 'completed' } as OperationJob);
    await vi.waitFor(() => expect(diagnose).toHaveBeenCalledOnce());
    expectMetadata(diagnose.mock.calls[0]![1]);
  });
});
