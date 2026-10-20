import { describe, expect, it } from 'vitest';
import { methodWindows, schemas, settingsEvents } from '../src/desktop/ipc-schemas';

describe('IPC method table', () => {
  it('assigns every method a window', () => {
    expect(Object.keys(methodWindows).sort()).toEqual(Object.keys(schemas).sort());
  });
  it('keeps credentials in Settings and file changes in the workspace window', () => {
    for (const method of ['providerCredential', 'agentToken', 'agentClients', 'fileAccessRevoke'])
      expect(methodWindows[method as keyof typeof methodWindows]).toBe('settings');
    for (const method of ['operate', 'save', 'trashConfirmation', 'printPDF', 'clipboardWrite'])
      expect(methodWindows[method as keyof typeof methodWindows]).toBe('viewer');
  });
  it('sends Settings the permission changes its provider controls show', () => {
    // A permission granted or revoked in the workspace window reaches an open Settings window.
    expect(methodWindows.providerPermissionSet).toBe('both');
    expect(settingsEvents).toContain('model-permission');
    expect(settingsEvents).not.toContain('open');
  });
});
