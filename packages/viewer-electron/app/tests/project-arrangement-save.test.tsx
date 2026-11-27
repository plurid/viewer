// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pane } from '../src/domain/contracts';
import type { ProjectDefinition, ProjectLayout } from '../src/domain/workspaces/project';
import { initialize, activeWorkspace } from '../src/renderer/state/store';
import { WorkspaceContext } from '../src/renderer/workspace/context';
import { ProjectControls, requestProject } from '../src/renderer/workspace/projects';

const placement = (id: string) => ({
  id,
  location: { translateX: 0, translateY: 0, translateZ: 0, rotateX: 0, rotateY: 0 },
  width: 800,
  height: 600,
  show: true,
});

function initStore(panes: Pane[]) {
  initialize({ home: '/work', platform: 'darwin', state: null, locations: [], openPaths: [] });
  Object.assign(activeWorkspace(), {
    name: 'Project',
    roots: panes.map((p) => p.id),
    activePane: panes[0]?.id,
    arrangement: {},
    panes,
    project: {
      file: '/work/project/viewer.project.jsonc',
      root: '/work/project',
      revision: 'rev-1',
      bindings: {},
      folders: {},
      dirty: false,
      definition: {
        version: 1,
        id: 'proj-1',
        name: 'Project',
        bindings: [],
        planes: [{ id: 'folder-1', type: 'folder', target: { path: '.' } }],
        folders: [],
        layout: { placements: [placement('folder-1')] },
        arrangements: {},
      },
    },
  });
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

afterEach(cleanup);

function runSaveArrangement(panes: Pane[], captured: ProjectLayout) {
  initStore(panes);
  const saved: ProjectDefinition[] = [];
  (window as unknown as { viewer: unknown }).viewer = {
    project: vi.fn(async (req: { kind: string; definition?: ProjectDefinition }) => {
      if (req.kind === 'save' && req.definition) {
        saved.push(req.definition);
        return {
          file: '/work/project/viewer.project.jsonc',
          root: '/work/project',
          revision: 'rev-2',
          definition: req.definition,
        };
      }
      return null;
    }),
  };
  render(
    <WorkspaceContext.Provider value={{ captureLayout: () => captured } as never}>
      <ProjectControls />
    </WorkspaceContext.Provider>,
  );
  requestProject('arrangements');
  return { saved };
}

describe('saving a project arrangement with a non-portable plane drops it', () => {
  it('saving an arrangement with only portable planes persists it in definition.arrangements', async () => {
    const folder: Pane = {
      id: 'folder-1',
      type: 'folder',
      path: '/work/project',
      mode: 'list',
      sort: 'name',
      descending: false,
      showHidden: false,
      history: ['/work/project'],
      historyIndex: 0,
    };
    const { saved } = runSaveArrangement([folder], { placements: [placement('folder-1')] });
    fireEvent.click(await screen.findByRole('button', { name: 'Save Current Arrangement…' }));
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: 'Review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saved.length).toBe(1));
    expect(Object.keys(saved[0]!.arrangements)).toContain('Review');
  });

  it('saving an arrangement while a note plane is open keeps the arrangement for portable planes', async () => {
    const folder: Pane = {
      id: 'folder-1',
      type: 'folder',
      path: '/work/project',
      mode: 'list',
      sort: 'name',
      descending: false,
      showHidden: false,
      history: ['/work/project'],
      historyIndex: 0,
    };
    const note: Pane = {
      id: 'note-1',
      type: 'note',
      path: '/work/project',
      documentID: '11111111-1111-4111-8111-111111111111',
      title: 'Notes',
    };
    const { saved } = runSaveArrangement([folder, note], {
      placements: [placement('folder-1'), placement('note-1')],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Save Current Arrangement…' }));
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: 'Review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saved.length).toBe(1));
    expect(Object.keys(saved[0]!.arrangements)).toContain('Review');
  });
});
