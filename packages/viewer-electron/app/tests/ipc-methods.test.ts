import { describe, expect, it } from 'vitest';
import { methodWindows, schemas, settingsEvents } from '../src/desktop/ipc/schemas';

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
  it('keeps credentials in Settings and file changes in the workspace window', () => {
    for (const method of [
      'providerCredential',
      'agentToken',
      'agentClients',
      'fileAccessRevoke',
      // imports replace the whole configuration, agents and providers included (2026-10-20)
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
      // text a person edits or keeps unsaved, and the saves that write it (2026-10-23)
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
