import { describe, expect, it, vi } from 'vitest';
import { Desktop } from '../src/desktop/bridge';
import { AgentBroker } from '../src/desktop/agents/agent-broker';
import { AgentServiceTools } from '../src/desktop/agents/service-tools';
import { Workflows } from '../src/desktop/automation/workflows';
import { fileCoordination } from '../src/desktop/files/file-coordination';
import { defaultSettings } from '../src/domain/services';
import type { ActionPlanner } from '../src/desktop/actions/planner';
import type { FileServices } from '../src/desktop/files/file-services';
import type { SettingsService } from '../src/desktop/preferences/settings';
import type { AgentRequests } from '../src/desktop/agents/agent-requests';

vi.mock('electron', () => ({ ipcMain: { removeHandler: vi.fn() } }));
vi.mock('../src/desktop/native/macos-files', () => ({
  macFiles: () => ({ dismissFilePanels: () => {} }),
}));

function fixture() {
  const desktop = Object.create(Desktop.prototype) as Desktop;
  const owner = () => ({ close: vi.fn(async () => {}), flush: vi.fn(async () => {}) });
  for (const name of [
    'chats',
    'agentSessions',
    'gitActions',
    'gitReviews',
    'git',
    'worktrees',
    'agentTaskWorkflows',
    'taskRequests',
    'personTaskWorkflows',
    'trash',
    'settings',
    'comparisons',
    'duplicates',
    'watchRules',
    'terminals',
    'externalTerminals',
    'watchers',
    'operations',
    'buffers',
    'notes',
    'modelPermissions',
    'speechModels',
    'speech',
    'search',
    'executions',
    'appIcons',
    'webPreviews',
    'thumbnails',
    'information',
    'projects',
    'lenses',
    'checkpoints',
    'operationPlans',
    'relationships',
    'receipts',
    'fileAccess',
    'journal',
  ])
    Reflect.set(desktop, name, owner());
  Reflect.set(desktop, 'resources', { ...owner(), clear: vi.fn() });
  Reflect.set(desktop, 'browsers', { closeAll: vi.fn() });
  Reflect.set(desktop, 'mediaDocuments', { invalidate: vi.fn() });
  Reflect.set(desktop, 'optimizationReviews', { invalidate: vi.fn() });
  Reflect.set(desktop, 'transforms', { quiesce: vi.fn(async () => {}) });
  Reflect.set(desktop, 'agentCommands', new Map());
  Reflect.set(desktop, 'agentsConfiguration', Promise.resolve());
  const files = owner();
  const actions = {
    ...owner(),
    all: vi.fn(async () => {
      expect(actions.close).not.toHaveBeenCalled();
      return [];
    }),
    cancel: vi.fn(),
  };
  const unused = () => {
    throw new Error('This service is outside the shutdown path.');
  };
  const workflows = new Workflows('/fixture/Profile', {
    access: async () => {},
    files: { inspect: unused },
    comparisons: { run: unused, cancel: unused },
    plans: { request: unused },
    operations: { all: unused },
    actions: { start: unused, get: unused, cancel: unused },
  });
  // Empty history is already loaded: this exercises the real close guard without file I/O.
  Reflect.set(workflows, 'loaded', Promise.resolve());
  const services = new AgentServiceTools({
    workflows,
    git: { root: unused, inspectStatus: unused, inspectDiff: unused },
    speech: { status: unused, describe: unused },
    proposals: { speech: unused },
    settings: () => defaultSettings('/fixture'),
    generate: unused,
  });
  const broker = new AgentBroker(
    '/fixture/Profile',
    () => defaultSettings('/fixture'),
    () => undefined,
    files as unknown as FileServices,
    actions as unknown as ActionPlanner,
    {
      catalog: () => undefined,
      requests: { stop: vi.fn() } as unknown as AgentRequests,
      config: {} as SettingsService,
      services,
    },
  );
  Reflect.set(broker, 'clients', { list: async () => [], close: async () => {} });
  vi.spyOn(broker.access, 'flush').mockResolvedValue();
  Reflect.set(desktop, 'files', files);
  Reflect.set(desktop, 'actions', actions);
  Reflect.set(desktop, 'workflows', workflows);
  Reflect.set(desktop, 'agents', broker);
  return { desktop, broker, workflows, actions, files };
}

describe('desktop shutdown ownership', () => {
  it('stops agent work before closing its workflow and action owners', async () => {
    const f = fixture();
    const quiesce = vi.spyOn(fileCoordination, 'quiesce').mockResolvedValue();
    try {
      await expect(f.desktop.dispose()).resolves.toBeUndefined();
      expect(f.actions.all).toHaveBeenCalledOnce();
      expect(f.actions.close).toHaveBeenCalledOnce();
      expect(f.files.close).toHaveBeenCalledOnce();
      await expect(f.workflows.request({ kind: 'list' })).rejects.toThrow('Workflows have closed.');
      await f.desktop.dispose();
      expect(f.actions.close).toHaveBeenCalledOnce();
    } finally {
      quiesce.mockRestore();
    }
  });

  it('waits for queued agent configuration before retiring service owners', async () => {
    const f = fixture();
    const quiesce = vi.spyOn(fileCoordination, 'quiesce').mockResolvedValue();
    let configure!: () => void;
    Reflect.set(
      f.desktop,
      'agentsConfiguration',
      new Promise<void>((resolve) => {
        configure = resolve;
      }),
    );
    const closed = f.desktop.dispose();
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      await expect(f.workflows.request({ kind: 'list' })).resolves.toEqual([]);
      expect(f.files.close).not.toHaveBeenCalled();
      configure();
      await expect(closed).resolves.toBeUndefined();
    } finally {
      configure();
      await closed.catch(() => {});
      quiesce.mockRestore();
    }
  });

  it('drains other owners and reports an agent cancellation failure', async () => {
    const f = fixture();
    const quiesce = vi.spyOn(fileCoordination, 'quiesce').mockResolvedValue();
    vi.spyOn(f.broker, 'close').mockRejectedValue(new Error('Agent cancellation failed.'));
    try {
      await expect(f.desktop.dispose()).rejects.toMatchObject({
        message: 'Desktop services failed to stop.',
        errors: [expect.objectContaining({ message: 'Agent cancellation failed.' })],
      });
      expect(f.files.close).toHaveBeenCalledOnce();
      expect(f.actions.close).toHaveBeenCalledOnce();
      await expect(f.workflows.request({ kind: 'list' })).rejects.toThrow('Workflows have closed.');
    } finally {
      quiesce.mockRestore();
    }
  });
});
