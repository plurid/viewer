/** Private state only: closing a project never invokes file mutations. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProjectAssociation } from '../src/domain/project';
import { stateSchema } from '../src/desktop/storage';
import {
  activeWorkspace,
  addPane,
  associateProject,
  closeProject,
  flushState,
  getState,
  initialize,
  newWorkspace,
  savePreviewValue,
  setActivePane,
  storageAdapter,
  switchWorkspace,
} from '../src/renderer/state/store';

const save = vi.fn(async (value: unknown) => {
  stateSchema.parse(value);
});
const projectRequest = vi.fn(),
  operate = vi.fn();
function associate() {
  const space = activeWorkspace();
  const project: ProjectAssociation = {
    file: '/fixtures/viewer.project.jsonc',
    root: '/fixtures',
    revision: 'saved',
    dirty: true,
    bindings: {},
    folders: {},
    definition: {
      version: 1,
      id: space.id,
      name: 'Attached ' + space.id,
      bindings: [],
      planes: [],
      folders: [],
      layout: { placements: [] },
      arrangements: {},
    },
  };
  associateProject(project);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('window', {
    dispatchEvent: vi.fn(),
    viewer: { save, project: projectRequest, operate },
  });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(async () => {
  await flushState(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('detaches the definition while preserving panes, layout, active plane, preview notes and engine storage', async () => {
  const child = addPane('/fixtures/Notes.txt', 'preview', false);
  setActivePane(child.id);
  savePreviewValue(child.id, 'notes.text', 'Private unsaved note');
  storageAdapter(activeWorkspace().id).setItem('engine', 'Private layout');
  associate();
  const before = activeWorkspace(),
    previews = getState().saved.previewStates;
  closeProject();
  expect(activeWorkspace()).toEqual({ ...before, project: undefined });
  expect(getState().saved.previewStates).toEqual(previews);
  expect(getState().activePane).toBe(child.id);
  expect(storageAdapter(before.id).getItem('engine')).toBe('Private layout');
  expect(projectRequest).not.toHaveBeenCalled();
  expect(operate).not.toHaveBeenCalled();
  await flushState(false);
  const saved = stateSchema.parse(getState().saved);
  initialize({ ...getState().bootstrap, state: saved });
  expect(activeWorkspace().project).toBeUndefined();
  expect(activeWorkspace().panes).toEqual(before.panes);
  expect(getState().saved.previewStates).toEqual(previews);
});
it('closes only the active association and is harmless in an ordinary workspace', async () => {
  associate();
  const first = activeWorkspace().id;
  await newWorkspace('Other');
  associate();
  const other = activeWorkspace();
  await switchWorkspace(first);
  closeProject();
  expect(getState().saved.workspaces.find((space) => space.id === other.id)).toEqual(other);
  const unchanged = activeWorkspace();
  closeProject();
  expect(activeWorkspace()).toBe(unchanged);
  expect(projectRequest).not.toHaveBeenCalled();
  expect(operate).not.toHaveBeenCalled();
});
