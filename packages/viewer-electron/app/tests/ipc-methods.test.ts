import { describe, expect, it, vi } from 'vitest';
import {
  methodWindows,
  schemas,
  settingsEvents,
  type ApiHandlers,
} from '../src/desktop/ipc/schemas';
import { Desktop } from '../src/desktop/bridge';
import { paneTypes } from '../src/domain/contracts';

describe('IPC method table', () => {
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
