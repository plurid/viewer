// @vitest-environment jsdom
import { useState } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { DefinitionCatalog } from '../src/domain/workspaces/definitions/schema';
import { WindowDialogs } from '../src/renderer/app/WindowDialogs';
import type { WindowDialog } from '../src/renderer/app/WindowDialogs';
import { savePatch, useViewer } from '../src/renderer/state/core';
import { receiveDefinitions } from '../src/renderer/state/definitions';
import { flushState } from '../src/renderer/state/persistence';
import { activeWorkspace, initialize } from '../src/renderer/state/store';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import type { Connection } from '../tools/docs/record';
import { ReviewPage } from '../tools/review/page';
import { reviewAreas } from '../tools/review/scenes';
import { standardVariants } from '../tools/review/variants';
import type { ownedApp } from './owned-app';
import { deferred } from './support/deferred';
import { sampleDefinition } from './workspace-definition-fixtures';

function WorkspaceWindow() {
  const [dialog, setDialog] = useState<WindowDialog>();
  const workspace = useViewer(() => activeWorkspace());
  const manage = () => setDialog({ type: 'workspace', kind: 'manage', id: workspace.id });
  return (
    <>
      <button aria-label={'Workspace: ' + workspace.name}>{workspace.name}</button>
      <button onClick={() => setDialog({ type: 'workspace', kind: 'save-as', id: workspace.id })}>
        Save as Definition…
      </button>
      <button onClick={manage}>Manage Workspaces…</button>
      <WindowDialogs
        dialog={dialog}
        onChange={setDialog}
        onClose={(request) =>
          setDialog((current) => {
            if (request !== current) return current;
            return request?.type === 'workspace' && request.returnToManager
              ? { type: 'workspace', kind: 'manage', id: activeWorkspace().id }
              : undefined;
          })
        }
        workspace={{} as WorkspaceController}
        transitionWorkspace={(change) => change()}
      />
    </>
  );
}

it('reaches Forget Remembered Planes when saving the replacement outlives the close dialog', async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const key = 'review-field-work';
  const definition = sampleDefinition(key, { name: 'Field work' });
  const catalog: DefinitionCatalog = {
    revision: 1,
    definitions: [],
    diagnostics: [],
    file: { path: '/fixture/workspaces.jsonc', state: 'read' },
    projectManager: {
      path: '/fixture/projects.json',
      state: 'read',
      projects: 0,
      missing: 0,
      disabled: 0,
      duplicateKeys: 0,
      remote: 0,
    },
  };
  const saving = deferred();
  const release = deferred();
  Object.assign(window, {
    viewer: {
      terminalCount: async () => 0,
      workspaceDefinitionFile: async () => catalog,
      workspaceDefinitions: async (request: { kind: string; key?: string }) => {
        if (request.kind === 'save-as' && !request.key)
          return { kind: 'proposal', key, name: definition.name };
        if (request.kind === 'save-as') {
          receiveDefinitions({ ...catalog, definitions: [definition] });
          return {
            kind: 'saved',
            key,
            basis: definition.basis,
            planes: {},
            commandPlanes: [],
            skipped: [],
            literalPaths: [],
          };
        }
        if (request.kind === 'close-info') return { kind: 'close-info' };
        if (request.kind === 'close') {
          receiveDefinitions({
            ...catalog,
            revision: 2,
            definitions: [
              { ...definition, remembered: { at: 1, basis: definition.basis, planes: 1 } },
            ],
          });
          return { kind: 'closed' };
        }
        throw new Error('Unexpected workspace request ' + request.kind);
      },
      save: async (state: { activeWorkspace: string }) => {
        if (state.activeWorkspace === 'other') {
          saving.resolve();
          await release.promise;
        }
      },
    },
  });
  initialize({
    home: '/fixture',
    platform: 'darwin',
    openPaths: [],
    locations: [],
    state: null,
    definitions: catalog,
  });
  const folder = activeWorkspace();
  expect(folder.panes.map((pane) => pane.type)).toEqual(['folder']);
  savePatch({
    activeWorkspace: 'review',
    workspaces: [
      { ...folder, id: 'review', name: 'Field work' },
      { ...folder, id: 'other', name: 'Projects' },
    ],
  });
  const view = render(<WorkspaceWindow />);
  const connection = { evaluate: (source: string) => window.eval(source) } as unknown as Connection;
  const page = new ReviewPage(
    {} as Awaited<ReturnType<typeof ownedApp>>,
    connection,
    '/fixture',
    standardVariants[0]!,
  );
  vi.spyOn(page, 'settle').mockImplementation(async () => {
    await act(async () => {});
  });
  const until = page.until.bind(page);
  vi.spyOn(page, 'until').mockImplementation((read, accept, label) =>
    until(read, accept, label, 1600),
  );
  const palette = vi.spyOn(page, 'palette').mockImplementation(async (label) => {
    fireEvent.click(view.getByRole('button', { name: label }));
  });
  vi.spyOn(page, 'type').mockImplementation(async (selector, value) => {
    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Save Definition' }).hasAttribute('disabled')).toBe(
        false,
      ),
    );
    fireEvent.change(document.querySelector(selector)!, { target: { value } });
  });
  const scene = reviewAreas
    .flatMap((area) => area.scenes)
    .find((scene) => scene.id === 'dialog-forget-remembered-planes')!;
  try {
    const steps = scene.steps(page, standardVariants[0]!);
    await Promise.race([saving.promise, steps]);
    await waitFor(() => expect(document.querySelector('dialog.definition-dialog')).toBeNull());
    expect(activeWorkspace().id).toBe('other');
    release.resolve();
    await steps;
    expect(palette.mock.calls.filter(([label]) => label === 'Manage Workspaces…')).toHaveLength(2);
    expect(view.getByRole('dialog', { name: 'Forget remembered planes?' }).textContent).toContain(
      'Field work',
    );
  } finally {
    release.resolve();
    view.unmount();
    await flushState(false);
    vi.restoreAllMocks();
  }
});
