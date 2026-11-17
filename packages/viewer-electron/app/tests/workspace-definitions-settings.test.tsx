// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DesktopEvent } from '../src/domain/contracts';
import type { DefinitionCatalog } from '../src/domain/workspaces/definitions/schema';
import { WorkspaceDefinitionsSettings } from '../src/renderer/ui/settings/WorkspaceDefinitionsSettings';

const catalog: DefinitionCatalog = {
  revision: 1,
  file: { path: '/data/workspaces.jsonc', state: 'last-valid' },
  projectManager: {
    path: '/source/projects.json',
    state: 'needs-access',
    projects: 324,
    missing: 4,
    disabled: 1,
    remote: 2,
    duplicateKeys: 3,
  },
  definitions: [],
  diagnostics: [
    {
      source: 'workspaces.jsonc',
      key: 'sample/site',
      level: 'error',
      line: 7,
      message: 'Unknown root token.',
    },
  ],
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('workspace definitions in Settings', () => {
  it.each([
    ['absent', "VS Code Project Manager's list was not found."],
    ['off', 'VS Code Project Manager is off.'],
    ['unreadable', "VS Code Project Manager's list could not be read."],
    ['read', '0 VS Code projects.'],
  ] as const)('explains %s in plain sentences and omits zero counters', async (state, expected) => {
    const next = {
      ...catalog,
      projectManager: {
        ...catalog.projectManager,
        state,
        projects: 0,
        missing: 0,
        disabled: 0,
        remote: 0,
        duplicateKeys: 0,
      },
    };
    vi.stubGlobal('viewer', { workspaceDefinitionFile: async () => next, onEvent: () => () => {} });
    render(<WorkspaceDefinitionsSettings />);
    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
    expect(screen.queryByText(/0 disabled/)).toBeNull();
  });
  it('says whether validation still has errors', async () => {
    const request = vi.fn(async () => structuredClone(catalog));
    vi.stubGlobal('viewer', { workspaceDefinitionFile: request, onEvent: () => () => {} });
    render(<WorkspaceDefinitionsSettings />);
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
    await waitFor(() =>
      expect(screen.getByText('1 error remains. Fix the diagnostics below.')).toBeTruthy(),
    );
    request.mockResolvedValueOnce({ ...catalog, diagnostics: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
    await waitFor(() => expect(screen.getByText('No errors found.')).toBeTruthy());
  });
  it('shows the file, source counts, line diagnostics and access recovery and receives live events', async () => {
    let receive!: (event: DesktopEvent) => void;
    const stop = vi.fn();
    const request = vi.fn(async () => structuredClone(catalog));
    vi.stubGlobal('viewer', {
      workspaceDefinitionFile: request,
      onEvent: (listener: typeof receive) => {
        receive = listener;
        return stop;
      },
    });
    const view = render(<WorkspaceDefinitionsSettings />);
    await waitFor(() =>
      expect(screen.getByText("Allow access to read VS Code Project Manager's list.")).toBeTruthy(),
    );
    expect(
      screen.getByText(
        'The last valid definitions remain in effect until workspaces.jsonc is fixed.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('workspaces.jsonc:7 (sample/site): Unknown root token.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Allow access…' }));
    await waitFor(() => expect(request).toHaveBeenLastCalledWith({ kind: 'allow-source' }));
    receive({
      type: 'workspace-definitions',
      catalog: {
        ...catalog,
        revision: 2,
        projectManager: { ...catalog.projectManager, state: 'read', projects: 325 },
      },
    });
    await waitFor(() =>
      expect(
        screen.getByText(
          '325 VS Code projects, 4 folders missing, 1 disabled, 2 remote, 3 duplicate keys.',
        ),
      ).toBeTruthy(),
    );
    expect(screen.queryByRole('button', { name: 'Allow access…' })).toBeNull();
    view.unmount();
    expect(stop).toHaveBeenCalledOnce();
  });
  it('opens and validates the definition file and reports failures inline', async () => {
    const request = vi.fn(async () => structuredClone(catalog));
    vi.stubGlobal('viewer', { workspaceDefinitionFile: request, onEvent: () => () => {} });
    render(<WorkspaceDefinitionsSettings />);
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Open workspaces.jsonc' }));
    await waitFor(() => expect(request).toHaveBeenLastCalledWith({ kind: 'edit' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Validate' }).hasAttribute('disabled')).toBe(false),
    );
    request.mockRejectedValueOnce(new Error('Editor unavailable.'));
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
    await waitFor(() =>
      expect(screen.getByText('Editor unavailable.').getAttribute('role')).toBe('status'),
    );
  });
});
