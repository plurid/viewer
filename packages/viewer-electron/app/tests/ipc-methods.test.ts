import { describe, expect, it, vi } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ApiHandlers } from '../src/desktop/ipc/schemas';
import { methodWindows, schemas, settingsEvents } from '../src/desktop/ipc/schemas';
import { Desktop } from '../src/desktop/bridge';
import type { DesktopEvent } from '../src/domain/contracts';
import { paneTypes } from '../src/domain/contracts';
import type { SessionKeys } from '../src/domain/preferences/session-keys';
import { createCommandLineHandlers } from '../src/desktop/ipc/command-line-handlers';
import { createMediaHandlers } from '../src/desktop/ipc/media-handlers';
import { createPasteboardHandlers } from '../src/desktop/ipc/pasteboard-handlers';
import { createLicenseHandlers } from '../src/desktop/ipc/license-handlers';

describe('IPC method table', () => {
  it('accepts exact large server identities and rejects malformed or unmarked rounded values', () => {
    expect(
      schemas.localServerStart.safeParse(['/Folder', 'server', '12:9007199254740993:u64']).success,
    ).toBe(true);
    for (const identity of ['12:9007199254740993', '12:18446744073709551616:u64', '12:2:forged'])
      expect(schemas.localServerStart.safeParse(['/Folder', 'server', identity]).success).toBe(
        false,
      );
  });
  it('bounds license requests and permits key changes only from Settings', async () => {
    const service = {
      status: vi.fn(async (_hide?: boolean) => ({ kind: 'trial', daysLeft: 30 }) as const),
      enter: vi.fn(
        async (_key: string) =>
          ({ kind: 'licensed', email: 'generated@buyer.example.invalid' }) as const,
      ),
      remove: vi.fn(async () => ({ kind: 'trial-ended' }) as const),
      buy: vi.fn(async () => {}),
    };
    const handler = createLicenseHandlers({
      license: service,
      isSettings: (owner) => owner === 2,
    }).license;
    expect(methodWindows.license).toBe('both');
    expect(settingsEvents).toContain('license');
    expect(schemas.license.safeParse([{ kind: 'enter', key: 'x'.repeat(4096) }]).success).toBe(
      true,
    );
    for (const request of [
      { kind: 'enter', key: 'x'.repeat(4097) },
      { kind: 'enter' },
      { kind: 'buy', url: 'https://other.example.invalid' },
      { kind: 'status', key: 'unexpected' },
      { kind: 'paid' },
    ])
      expect(schemas.license.safeParse([request]).success).toBe(false);
    for (const request of [{ kind: 'enter', key: 'generated' }, { kind: 'remove' }] as const)
      await expect(handler([request], 1)).rejects.toThrow('Settings');
    expect(service.enter).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();
    await handler([{ kind: 'enter', key: 'generated' }], 2);
    await handler([{ kind: 'remove' }], 2);
    await handler([{ kind: 'status', hideReminder: true }], 1);
    await handler([{ kind: 'buy' }], 1);
    expect(service.enter).toHaveBeenCalledExactlyOnceWith('generated');
    expect(service.remove).toHaveBeenCalledOnce();
    expect(service.status).toHaveBeenCalledWith(true);
    expect(service.buy).toHaveBeenCalledOnce();
    const off = createLicenseHandlers({ isSettings: () => true }).license;
    expect(await off([{ kind: 'status' }], 1)).toBeUndefined();
  });
  it('copies plain text through the desktop without treating output as file paths', async () => {
    const writeText = vi.fn(async () => {});
    const requireAccess = vi.fn();
    const handlers = createPasteboardHandlers({
      pasteboard: {
        writeText,
        write: vi.fn(),
        read: vi.fn(),
        readForPaste: vi.fn(),
        dropped: vi.fn(),
        copyText: vi.fn(),
      },
      operations: { start: vi.fn(), createImage: vi.fn() },
      isAgent: () => false,
      fileAccess: { require: requireAccess },
      window: () => undefined,
    });
    const text = 'Applications\nModel α: completed\n';
    await handlers.clipboardWriteText(schemas.clipboardWriteText.parse([text]), 1);
    expect(writeText).toHaveBeenCalledWith(text);
    expect(requireAccess).not.toHaveBeenCalled();
    expect(methodWindows.clipboardWriteText).toBe('both');
    expect(schemas.clipboardWriteText.safeParse(['']).success).toBe(true);
    expect(schemas.clipboardWriteText.safeParse([{}]).success).toBe(false);
    expect(schemas.clipboardWriteText.safeParse(['x'.repeat(16 * 1024 * 1024 + 1)]).success).toBe(
      false,
    );
  });
  it('accepts only a destination for clipboard paste in a workspace window', () => {
    expect(methodWindows.clipboardPaste).toBe('viewer');
    expect(schemas.clipboardPaste.safeParse(['/fixtures/destination']).success).toBe(true);
    for (const args of [[], ['relative'], ['/fixtures', { png: 'unexpected' }], [{ image: true }]])
      expect(schemas.clipboardPaste.safeParse(args).success).toBe(false);
    expect(
      schemas.operate.parse([
        { kind: 'mkfile', sources: [], destination: '/fixtures', name: 'image.png', imageBytes: 1 },
      ]),
    ).toEqual([{ kind: 'mkfile', sources: [], destination: '/fixtures', name: 'image.png' }]);
  });
  it('bounds worksheet pages and cancellation to existing viewer resources', () => {
    expect(schemas.document.safeParse(['resource']).success).toBe(true);
    expect(
      schemas.document.safeParse([
        'resource',
        { requestID: 'page', sheet: 'Data', fromRow: 2400, limit: 100 },
      ]).success,
    ).toBe(true);
    for (const request of [
      { requestID: 'page', fromRow: 0 },
      { requestID: 'page', limit: 101 },
      { requestID: 'page', path: '/other/file.xlsx' },
      { sheet: 'Data' },
    ])
      expect(schemas.document.safeParse(['resource', request]).success).toBe(false);
    expect(methodWindows.cancelDocument).toBe('viewer');
    expect(schemas.cancelDocument.safeParse(['resource', 'page']).success).toBe(true);
  });
  it('assigns every method a window', () => {
    expect(Object.keys(methodWindows).sort()).toEqual(Object.keys(schemas).sort());
  });
  it('allows CLI installation in a workspace while keeping uninstall in Settings', async () => {
    expect(methodWindows.shellCommand).toBe('both');
    const status = { path: '/fixtures/.local/bin/viewer', installed: true, executable: true };
    const installer = {
      status: vi.fn(async () => status),
      install: vi.fn(async () => status),
      uninstall: vi.fn(async () => ({ ...status, installed: false })),
    };
    const desktop = Object.create(Desktop.prototype) as Desktop;
    Reflect.set(desktop, 'shellCommand', installer);
    Reflect.set(
      desktop,
      'windows',
      new Map([
        [1, { role: 'viewer' }],
        [2, { role: 'settings' }],
      ]),
    );
    const createHandlers = Reflect.get(desktop, 'createHandlers') as () => ApiHandlers;
    const handler = createHandlers.call(desktop).shellCommand;
    await expect(handler(['status'], 1)).resolves.toEqual(status);
    await expect(handler(['install'], 1)).resolves.toEqual(status);
    expect(() => handler(['uninstall'], 1)).toThrow('Settings');
    expect(installer.uninstall).not.toHaveBeenCalled();
    await expect(handler(['uninstall'], 2)).resolves.toMatchObject({ installed: false });
    expect(installer.uninstall).toHaveBeenCalledOnce();
  });
  it('keeps credentials in Settings and file changes in the workspace window', () => {
    for (const method of [
      'providerCredential',
      'agentToken',
      'agentClients',
      'fileAccessRevoke',
      // imports replace the whole configuration, agents and providers included
      'configTransfer',
      'configRestore',
    ])
      expect(methodWindows[method as keyof typeof methodWindows]).toBe('settings');
    for (const method of [
      'operate',
      'save',
      'trashConfirmation',
      'printPDF',
      'clipboardWrite',
      // text a person edits or keeps unsaved, and the saves that write it
      'textOpen',
      'textSave',
      'textSaveAs',
      'textEditEnd',
      'textPrompt',
      'bufferList',
      'bufferRead',
      'bufferWrite',
      'bufferDiscard',
      'htmlPreview',
      'htmlPreviewClose',
      'localServerStart',
      'localServers',
      'localServerInspect',
      'localServerAction',
    ])
      expect(methodWindows[method as keyof typeof methodWindows]).toBe('viewer');
  });
  it('limits provider checks to fixed synthetic variants without caller content', () => {
    expect(schemas.providerCheck.safeParse([{ providerID: 'gemini', kind: 'text' }]).success).toBe(
      true,
    );
    expect(methodWindows.providerCheck).toBe('both');
    expect(
      schemas.providerCheck.safeParse([
        { providerID: 'gemini', kind: 'chat-schema', prompt: 'private data' },
      ]).success,
    ).toBe(false);
    expect(
      schemas.providerCheck.safeParse([{ providerID: 'gemini', kind: 'custom-schema' }]).success,
    ).toBe(false);
  });
  it('sends Settings the permission changes its provider controls show', () => {
    // A permission granted or revoked in the workspace window reaches an open Settings window.
    expect(methodWindows.providerPermissionSet).toBe('both');
    expect(settingsEvents).toContain('model-permission');
    expect(settingsEvents).not.toContain('open');
  });
  it('forwards session-keys events to Settings windows when temporary bindings change', () => {
    expect(settingsEvents).toContain('session-keys');
    const desktop = Object.create(Desktop.prototype) as Desktop;
    const viewerSent: DesktopEvent[] = [];
    const settingsSent: DesktopEvent[] = [];
    const makeWindow = (id: number, sent: DesktopEvent[]) => ({
      isDestroyed: () => false,
      webContents: {
        id,
        isDestroyed: () => false,
        send: (_channel: string, event: DesktopEvent) => sent.push(event),
      },
    });
    Reflect.set(
      desktop,
      'windows',
      new Map([
        [1, { window: makeWindow(1, viewerSent), originID: 'o-1', role: 'viewer' }],
        [2, { window: makeWindow(2, settingsSent), originID: 'o-2', role: 'settings' }],
      ]),
    );
    Reflect.set(desktop, 'options', {});
    let current: SessionKeys = {
      bindings: [{ table: 'prefix', keys: ['x'], line: 'refresh' }],
      aliases: [],
    };
    const handlers = createCommandLineHandlers({
      settings: { snapshot: vi.fn(), patch: vi.fn() },
      credentials: { ids: () => [] },
      providers: { generate: vi.fn() },
      sessionKeys: () => current,
      setSessionKeys: (keys) => {
        current = keys;
      },
      emit: (event) => desktop.emit(event),
    });
    handlers.sessionKeysDiscard([], 2);
    expect(viewerSent.some((event) => event.type === 'session-keys')).toBe(true);
    expect(settingsSent.some((event) => event.type === 'session-keys')).toBe(true);
  });
  it('checks fileAccess.require before touching disk in imageInspect and pdfInspect', async () => {
    const requireAccess = vi.fn(async () => {
      throw Object.assign(new Error('Folder access required.'), { code: 'FILE_ACCESS_REQUIRED' });
    });
    const inspectImage = vi.fn();
    const pdfInspect = vi.fn();
    const handlers = createMediaHandlers({
      browsers: { request: vi.fn() },
      documents: { request: vi.fn() },
      optimization: { request: vi.fn() },
      transforms: { inspectImage, pdfInspect },
      resources: { grantBytes: vi.fn() },
      fileAccess: {
        scoped: true,
        remember: vi.fn(),
        allowOnce: vi.fn(),
        require: requireAccess,
      },
      window: () => undefined,
    });
    const missing = '/nonexistent-viewer-path-for-access-check/photo.png';
    await expect(handlers.imageInspect([missing], 1)).rejects.toMatchObject({
      code: 'FILE_ACCESS_REQUIRED',
    });
    await expect(handlers.pdfInspect([missing], 1)).rejects.toMatchObject({
      code: 'FILE_ACCESS_REQUIRED',
    });
    expect(requireAccess).toHaveBeenCalledTimes(2);
    expect(inspectImage).not.toHaveBeenCalled();
    expect(pdfInspect).not.toHaveBeenCalled();
  });
  it('bounds canvas complete-action patch size, key length, reserved keys and workflow bindings', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const base = {
      kind: 'complete-action' as const,
      id,
      frameID: id,
      runID: id,
    };
    expect(
      schemas.canvas.safeParse([{ ...base, output: { result: 'ok', patch: { count: 1 } } }])
        .success,
    ).toBe(true);
    expect(
      schemas.canvas.safeParse([
        { ...base, output: { result: 'ok', patch: { big: 'x'.repeat(130_000) } } },
      ]).success,
    ).toBe(false);
    expect(
      schemas.canvas.safeParse([
        { ...base, output: { result: 'ok', patch: { ['k'.repeat(201)]: 1 } } },
      ]).success,
    ).toBe(false);
    const reservedPatch = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    expect(
      schemas.canvas.safeParse([{ ...base, output: { result: 'ok', patch: reservedPatch } }])
        .success,
    ).toBe(false);
    expect(
      schemas.canvas.safeParse([
        { ...base, output: { result: 'ok', patch: { constructor: 'bad' } } },
      ]).success,
    ).toBe(false);
    const workflowContext = {
      workspaceID: 'w',
      rootID: 'r',
      paneID: 'p',
      sources: [],
      actor: 'user' as const,
    };
    expect(
      schemas.workflow.safeParse([
        {
          kind: 'start',
          file: '/fixtures/flow.json',
          revision: '1',
          bindings: { k0: '/fixtures/item-0' },
          context: workflowContext,
        },
      ]).success,
    ).toBe(true);
    const tooManyBindings = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [`k${index}`, `/fixtures/item-${index}`]),
    );
    expect(
      schemas.workflow.safeParse([
        {
          kind: 'start',
          file: '/fixtures/flow.json',
          revision: '1',
          bindings: tooManyBindings,
          context: workflowContext,
        },
      ]).success,
    ).toBe(false);

    const workspace = {
      id: 'ws-1',
      name: 'Main',
      panes: [],
      roots: [],
      arrangement: {},
    };
    const validState = {
      version: 13 as const,
      workspaces: [workspace],
      activeWorkspace: 'ws-1',
      favorites: [],
      recents: [],
      look: 'dark' as const,
    };
    expect(schemas.save.safeParse([validState]).success).toBe(true);
    const oversizedArrangement = Object.fromEntries(
      Array.from({ length: 201 }, (_, index) => [`k${index}`, 'v']),
    );
    expect(
      schemas.save.safeParse([
        { ...validState, workspaces: [{ ...workspace, arrangement: oversizedArrangement }] },
      ]).success,
    ).toBe(false);
    const oversizedPreviewStates = Object.fromEntries(
      Array.from({ length: 2001 }, (_, index) => [`ws-1:p${index}`, {}]),
    );
    expect(
      schemas.save.safeParse([{ ...validState, previewStates: oversizedPreviewStates }]).success,
    ).toBe(false);
    const oversizedProfile = Object.fromEntries(
      Array.from({ length: 201 }, (_, index) => [`ui.key${index}`, true]),
    );
    expect(
      schemas.save.safeParse([
        { ...validState, profile: { id: 'p1', previous: oversizedProfile } },
      ]).success,
    ).toBe(false);
  });
});
describe('the workspace snapshot agents read (2026-10-23)', () => {
  it.each(Object.values(paneTypes))(
    'publishes the %s plane kind without exposing private document fields',
    (type) => {
      const target = {
        workspaceID: 'w',
        rootID: 'p',
        paneID: 'p',
        directory: '/tmp',
        selection: [],
      };
      const snapshot = {
        activeWorkspace: 'w',
        workspaces: [
          {
            id: 'w',
            name: 'Work',
            roots: ['p'],
            panes: [
              {
                id: 'p',
                type,
                path: '/tmp',
                documentID: 'private-document',
                text: 'private note contents',
              },
            ],
          },
        ],
      };
      const result = schemas.commandsPublish.safeParse([target, [], snapshot]);
      expect(result.success).toBe(true);
      if (result.success)
        expect(result.data[2]?.workspaces[0]?.panes[0]).toEqual({ id: 'p', type, path: '/tmp' });
    },
  );
  it('accepts a scratch plane, by its type and folder only', () => {
    const snapshot = {
      activeWorkspace: 'w',
      workspaces: [
        {
          id: 'w',
          name: 'Work',
          roots: ['s'],
          panes: [{ id: 's', type: 'scratch', path: '/Users/someone/Desktop' }],
        },
      ],
    };
    const target = {
      workspaceID: 'w',
      rootID: 's',
      paneID: 's',
      directory: '/Users/someone/Desktop',
      selection: [],
    };
    expect(schemas.commandsPublish.safeParse([target, [], snapshot]).success).toBe(true);
  });
});
describe('desktop-issued per-request agent dispatch IDs', () => {
  it('isolates person actions from concurrent agent commands and never lets a tagged or expired dispatch elevate', async () => {
    const desktop = Object.create(Desktop.prototype) as Desktop;
    const sent: { id?: string; type?: string }[] = [];
    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        id: 1,
        isDestroyed: () => false,
        send: (_channel: string, event: { id?: string; type?: string }) => sent.push(event),
      },
    };
    const notesRequest = vi.fn(async () => ({ kind: 'list' as const, notes: [] }));
    const operationsStart = vi.fn(() => 'job-1');
    const executionsStart = vi.fn(async () => 'exec-1');
    Reflect.set(desktop, 'windows', new Map([[1, { role: 'viewer', window: windowStub }]]));
    Reflect.set(desktop, 'agentCommands', new Map());
    Reflect.set(desktop, 'issuedDispatches', new Map());
    Reflect.set(desktop, 'requestDispatch', new AsyncLocalStorage());
    Reflect.set(desktop, 'activity', { within: (_ctx: unknown, work: () => unknown) => work() });
    Reflect.set(desktop, 'notes', { request: notesRequest });
    Reflect.set(desktop, 'receipts', { request: vi.fn() });
    Reflect.set(desktop, 'flushes', { request: vi.fn() });
    Reflect.set(desktop, 'operations', {
      start: operationsStart,
      load: vi.fn(),
      all: vi.fn(() => []),
      dismiss: vi.fn(),
      cancel: vi.fn(),
      resolve: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
    });
    Reflect.set(desktop, 'fabrication', { rememberOperation: vi.fn(async () => {}) });
    Reflect.set(desktop, 'executions', {
      start: executionsStart,
      startManual: vi.fn(),
      list: vi.fn(),
      cancel: vi.fn(),
    });
    Reflect.set(desktop, 'options', { openSettings: vi.fn() });
    Reflect.set(desktop, 'settings', { snapshot: vi.fn() });

    const dispatchAgentEvent = Reflect.get(desktop, 'dispatchAgentEvent') as (
      owner: number,
      payload: unknown,
    ) => Promise<void>;
    const call = Reflect.get(desktop, 'call') as (
      method: string,
      args: unknown,
      senderID: number,
      dispatchID?: unknown,
    ) => unknown;

    // Start a pending agent command on window 1; capture the desktop-issued dispatch ID.
    const pending = dispatchAgentEvent.call(desktop, 1, {
      type: 'agent-command',
      command: 'duplicate',
      target: {
        workspaceID: 'w',
        rootID: 'r',
        paneID: 'p',
        directory: '/Granted',
        selection: [],
      },
    });
    const issuedID = sent.find((event) => event.type === 'agent-command')?.id;
    expect(typeof issuedID).toBe('string');

    // 1. Person's own actions without a dispatch ID succeed and are attributed to 'person' despite the pending agent command.
    await expect(call.call(desktop, 'notes', [{ kind: 'list' }], 1)).resolves.toEqual({
      kind: 'list',
      notes: [],
    });
    await call.call(desktop, 'operate', [{ kind: 'duplicate', sources: ['/Granted/a.txt'] }], 1);
    expect(operationsStart).toHaveBeenLastCalledWith(
      { kind: 'duplicate', sources: ['/Granted/a.txt'] },
      'person',
    );

    // 2. Agent command's calls echoing the desktop-issued dispatch ID are attributed to 'agent' and refused for private/program APIs.
    await expect(call.call(desktop, 'notes', [{ kind: 'list' }], 1, issuedID)).rejects.toThrow(
      'Notes are private to the person.',
    );
    await call.call(
      desktop,
      'operate',
      [{ kind: 'duplicate', sources: ['/Granted/a.txt'] }],
      1,
      issuedID,
    );
    expect(operationsStart).toHaveBeenLastCalledWith(
      { kind: 'duplicate', sources: ['/Granted/a.txt'] },
      'agent',
    );
    await expect(
      call.call(
        desktop,
        'customExecute',
        [
          'action-1',
          { workspaceID: 'w', rootID: 'r', paneID: 'p', directory: '/Granted', selection: [] },
          {},
        ],
        1,
        issuedID,
      ),
    ).rejects.toThrow('Agents cannot run programs or shell scripts.');

    // 3. Unissued or wrong-window dispatch IDs are rejected before reaching any handler.
    expect(() =>
      call.call(
        desktop,
        'operate',
        [{ kind: 'duplicate', sources: ['/Granted/a.txt'] }],
        1,
        'forged-id',
      ),
    ).toThrow('dispatch');

    // 4. After the agent command finishes, a late call echoing its expired desktop-issued ID STILL lowers authority to 'agent'.
    call.call(desktop, 'agentCommandResult', [issuedID], 1);
    await pending;
    await expect(call.call(desktop, 'notes', [{ kind: 'list' }], 1, issuedID)).rejects.toThrow(
      'Notes are private to the person.',
    );
    await call.call(
      desktop,
      'operate',
      [{ kind: 'duplicate', sources: ['/Granted/a.txt'] }],
      1,
      issuedID,
    );
    expect(operationsStart).toHaveBeenLastCalledWith(
      { kind: 'duplicate', sources: ['/Granted/a.txt'] },
      'agent',
    );
  });

  it('retains actor agent past the 25-second timeout when a late tagged IPC call arrives', async () => {
    vi.useFakeTimers();
    try {
      const desktop = Object.create(Desktop.prototype) as Desktop;
      const sent: { id?: string; type?: string }[] = [];
      const windowStub = {
        isDestroyed: () => false,
        webContents: {
          id: 7,
          isDestroyed: () => false,
          send: (_channel: string, event: { id?: string; type?: string }) => sent.push(event),
        },
      };
      const operationsStart = vi.fn(() => 'job-1');
      Reflect.set(desktop, 'windows', new Map([[7, { role: 'viewer', window: windowStub }]]));
      Reflect.set(desktop, 'agentCommands', new Map());
      Reflect.set(desktop, 'issuedDispatches', new Map());
      Reflect.set(desktop, 'requestDispatch', new AsyncLocalStorage());
      Reflect.set(desktop, 'activity', { within: (_ctx: unknown, work: () => unknown) => work() });
      Reflect.set(desktop, 'operations', {
        start: operationsStart,
        load: vi.fn(),
        all: vi.fn(() => []),
        dismiss: vi.fn(),
        cancel: vi.fn(),
        resolve: vi.fn(),
        undo: vi.fn(),
        redo: vi.fn(),
      });
      Reflect.set(desktop, 'fabrication', { rememberOperation: vi.fn(async () => {}) });
      Reflect.set(desktop, 'options', { openSettings: vi.fn() });
      Reflect.set(desktop, 'settings', { snapshot: vi.fn() });

      const dispatchAgentEvent = Reflect.get(desktop, 'dispatchAgentEvent') as (
        owner: number,
        payload: unknown,
      ) => Promise<void>;
      const call = Reflect.get(desktop, 'call') as (
        method: string,
        args: unknown,
        senderID: number,
        dispatchID?: unknown,
      ) => unknown;

      const pending = dispatchAgentEvent.call(desktop, 7, {
        type: 'agent-command',
        command: 'duplicate',
        target: {
          workspaceID: 'w',
          rootID: 'r',
          paneID: 'p',
          directory: '/Granted',
          selection: [],
        },
      });
      const issuedID = sent.find((event) => event.type === 'agent-command')?.id;
      expect(typeof issuedID).toBe('string');

      const settled = pending.catch((error) => error);
      await vi.advanceTimersByTimeAsync(25_001);
      expect(await settled).toBeInstanceOf(Error);

      await call.call(
        desktop,
        'operate',
        [{ kind: 'duplicate', sources: ['/Granted/a.txt'] }],
        7,
        issuedID,
      );
      expect(operationsStart).toHaveBeenLastCalledWith(
        { kind: 'duplicate', sources: ['/Granted/a.txt'] },
        'agent',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
