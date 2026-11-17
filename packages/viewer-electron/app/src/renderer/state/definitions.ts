import type {
  DefinitionCatalog,
  WorkspaceDefinition,
  WorkspaceDefinitionReply,
} from '../../domain/workspaces/definitions/schema';
import type { Workspace } from '../../domain/contracts';
import type { WorkspaceController } from '../workspace/context';
import { closePlanes, rootPlanes } from '../commands/closing';
import { prepareClose } from '../editing/unsaved';
import { closeTerminal } from '../terminals/sessions';
import { buildDefinition } from '../../domain/workspaces/definitions/build';
import {
  isPristineWorkspace,
  maximumWorkspaces,
  mergeWorkspaceVisits,
  withDefinitionOrigins,
} from '../../domain/workspaces/catalog';
import { scratchPaneRecord } from '../../domain/workspaces/pane-records';
import { languageFor } from '../../domain/editing/languages';
import { panePresentation } from '../../domain/preferences/folder-presentation';
import { scopedPresentation } from './folder-presentation';
import {
  activeWorkspace,
  announce,
  dismissNotice,
  getState,
  savePatch,
  update,
  uuid,
} from './core';
import { adapters, closedPanes, flushState } from './persistence';
import { folderPane } from './panes';
import { switchWorkspace } from './workspaces';
import { effectiveWindowSettings } from './effective-ui';
import { stopTour } from '../workspace/tour';
import { newPlaneFolder } from '../../domain/services';

export function receiveDefinitions(catalog: DefinitionCatalog): void {
  if ((getState().bootstrap.definitions?.revision ?? -1) > catalog.revision) return;
  update({
    ...getState(),
    saved: {
      ...getState().saved,
      workspaces: withDefinitionOrigins(getState().saved.workspaces, catalog),
    },
    bootstrap: { ...getState().bootstrap, definitions: catalog },
  });
}

let opening: Promise<void> = Promise.resolve();
export function openDefinition(key: string): Promise<void> {
  const work = opening.catch(() => {}).then(() => open(key));
  opening = work;
  return work;
}

async function open(key: string): Promise<void> {
  const reply = await window.viewer.workspaceDefinitions({ kind: 'open', key });
  if (reply.kind === 'elsewhere') return;
  if (reply.kind === 'active') {
    await switchWorkspace(reply.workspaceID);
    return;
  }
  if (reply.kind !== 'build') throw new Error('The workspace could not be opened.');
  await flushState();
  const before = getState();
  const settings = effectiveWindowSettings(before);
  const pristine = isPristineWorkspace(
    activeWorkspace(),
    before.bootstrap.home,
    newPlaneFolder(settings.browsing, before.bootstrap.home, undefined, true),
  );
  if (!pristine && before.saved.workspaces.length >= maximumWorkspaces)
    throw new Error('Close a workspace before opening another.');
  const workspace = reply.closed
    ? {
        ...reply.closed.workspace,
        definition: { ...reply.closed.workspace.definition!, source: reply.definition.source },
        epoch: (reply.closed.workspace.epoch ?? 0) + 1,
        panes: reply.closed.workspace.panes.map((pane) =>
          pane.type === 'terminal' ? { ...pane, startOnOpen: false } : pane,
        ),
      }
    : freshWorkspace(reply.definition);
  stopTour();
  adapters.set(workspace.id, new Map(Object.entries(workspace.arrangement)));
  const workspaces = [
    ...before.saved.workspaces.filter(
      (space) => !pristine || space.id !== before.saved.activeWorkspace,
    ),
    workspace,
  ];
  savePatch({
    workspaces,
    activeWorkspace: workspace.id,
    profile: undefined,
    ...(reply.closed
      ? {
          previewStates: { ...before.saved.previewStates, ...reply.closed.previewStates },
          previewHistory: {
            ...before.saved.previewHistory,
            [workspace.id]: reply.closed.previewHistory,
          },
        }
      : {}),
    workspaceVisits: mergeWorkspaceVisits(workspaces, before.saved.workspaceVisits, {
      [workspace.id]: Date.now(),
    }),
  });
  update({ ...getState(), activePane: workspace.activePane ?? '', quickPreview: null });
  try {
    await flushState(false);
  } catch (error) {
    adapters.delete(workspace.id);
    savePatch(before.saved);
    update({ ...getState(), activePane: before.activePane, quickPreview: before.quickPreview });
    throw error;
  }
  if (pristine) adapters.delete(before.saved.activeWorkspace);
  if (getState().definitionNotice) dismissNotice();
  const problems =
    getState().bootstrap.definitions?.diagnostics.filter(
      (problem) =>
        (problem.key === key && problem.message.includes('left out')) ||
        problem.source === 'defined-workspaces-v1.json',
    ) ?? [];
  if (problems.length) announce(problems.map((problem) => problem.message).join('\n'));
  if (reply.closed && reply.closed.basis !== reply.definition.basis) {
    announce(
      [
        'Remembered planes opened. Definition changed.',
        ...problems.map((problem) => problem.message),
      ].join('\n'),
    );
    update({ ...getState(), definitionNotice: workspace.id });
  }
}

function freshWorkspace(definition: WorkspaceDefinition): Workspace {
  const before = getState();
  const settings = effectiveWindowSettings(before);
  let untitled = 0;
  const workspace = buildDefinition(definition, {
    id: uuid,
    home: before.bootstrap.home,
    terminalProfile: settings.terminals.profileID,
    folder: (path) => folderPane(path),
    scratch: (path) =>
      scratchPaneRecord(uuid(), path, {
        bufferID: uuid(),
        title: `Untitled ${++untitled}`,
        language:
          languageFor({ name: '', extension: settings.browsing.newFileExtension })?.id ??
          'plaintext',
      }),
  });
  workspace.panes = workspace.panes.map((pane) =>
    pane.type === 'folder'
      ? {
          ...pane,
          ...panePresentation(
            scopedPresentation(pane.path, before.settings.settings, before.saved.ui, workspace),
          ),
        }
      : pane,
  );
  return workspace;
}

export const workspaceShells = (workspace: Workspace) => window.viewer.terminalCount(workspace.id);

export interface DefinitionCloseProblem {
  kind: 'close-info';
  problem: string;
}
export type DefinitionCloseResult = boolean | DefinitionCloseProblem;

export async function closeDefinedWorkspace(
  id: string,
  withoutMemory = false,
): Promise<DefinitionCloseResult> {
  if (id !== activeWorkspace().id && getState().saved.openWindows?.includes(id))
    throw new Error('Switch to that window to close it.');
  const space = getState().saved.workspaces.find((item) => item.id === id);
  if (!space?.definition) throw new Error('This workspace has no definition.');
  const commit = await prepareClose(
    space.panes.map((pane) => pane.id),
    space.panes,
  );
  if (!commit) return false;
  await flushState();
  const before = getState();
  const reply = await window.viewer.workspaceDefinitions({
    kind: 'close',
    workspaceID: id,
    ...(withoutMemory ? { withoutMemory } : {}),
  });
  if (reply.kind === 'close-info')
    return { kind: 'close-info', problem: reply.problem ?? 'the memory file is unavailable' };
  if (reply.kind !== 'closed') throw new Error('The workspace could not be closed.');
  const workspaces = before.saved.workspaces.filter((item) => item.id !== id);
  let replacement = workspaces
    .filter((item) => !before.saved.openWindows?.includes(item.id))
    .sort(
      (a, b) =>
        (before.saved.workspaceVisits?.[b.id] ?? 0) - (before.saved.workspaceVisits?.[a.id] ?? 0),
    )[0];
  if (id !== before.saved.activeWorkspace) replacement = activeWorkspace();
  if (!replacement) {
    const settings = effectiveWindowSettings(before);
    const pane = folderPane(
      newPlaneFolder(settings.browsing, before.bootstrap.home, undefined, true),
    );
    replacement = {
      id: uuid(),
      name: 'Workspace',
      panes: [pane],
      roots: [pane.id],
      arrangement: {},
    };
    workspaces.push(replacement);
    adapters.set(replacement.id, new Map());
  }
  savePatch({
    workspaces,
    activeWorkspace: replacement.id,
    profile: undefined,
    workspaceVisits: mergeWorkspaceVisits(workspaces, before.saved.workspaceVisits, {
      [replacement.id]: Date.now(),
    }),
    previewStates: Object.fromEntries(
      Object.entries(before.saved.previewStates ?? {}).filter(([key]) => !key.startsWith(id + ':')),
    ),
    previewHistory: Object.fromEntries(
      Object.entries(before.saved.previewHistory ?? {}).filter(([key]) => key !== id),
    ),
  });
  update({
    ...getState(),
    activePane: replacement.activePane ?? replacement.panes[0]?.id ?? '',
    quickPreview: null,
  });
  try {
    await flushState(false);
  } catch (error) {
    savePatch(before.saved);
    update({ ...getState(), activePane: before.activePane });
    if (!before.saved.workspaces.some((space) => space.id === replacement.id))
      adapters.delete(replacement.id);
    throw error;
  }
  await commit();
  adapters.delete(id);
  if (getState().definitionNotice === id) dismissNotice();
  closedPanes.delete(id);
  for (const pane of space.panes) if (pane.type === 'terminal') closeTerminal(pane.id);
  return true;
}

export async function resetDefinition(
  controller: WorkspaceController,
  workspaceID = activeWorkspace().id,
): Promise<boolean> {
  const space = activeWorkspace();
  if (space.id !== workspaceID) throw new Error('Switch to this workspace to reset it.');
  if (!space.definition) throw new Error('This workspace has no definition.');
  let reply: WorkspaceDefinitionReply | undefined;
  const before = getState();
  const closed = await closePlanes(controller, rootPlanes(controller), false, async () => {
    await flushState();
    reply = await window.viewer.workspaceDefinitions({ kind: 'reset', workspaceID: space.id });
    if (reply.kind !== 'reset') throw new Error('The workspace could not be reset.');
  });
  if (!closed || reply?.kind !== 'reset') return false;
  const workspace = {
    ...freshWorkspace(reply.definition),
    id: space.id,
    epoch: (space.epoch ?? 0) + 1,
  };
  adapters.set(space.id, new Map());
  savePatch({
    workspaces: getState().saved.workspaces.map((item) =>
      item.id === space.id ? workspace : item,
    ),
    previewStates: Object.fromEntries(
      Object.entries(getState().saved.previewStates ?? {}).filter(
        ([key]) => !key.startsWith(space.id + ':'),
      ),
    ),
    previewHistory: Object.fromEntries(
      Object.entries(getState().saved.previewHistory ?? {}).filter(([key]) => key !== space.id),
    ),
  });
  update({ ...getState(), activePane: workspace.activePane ?? '', quickPreview: null });
  try {
    await flushState(false);
  } catch (error) {
    adapters.set(space.id, new Map(Object.entries(space.arrangement)));
    savePatch(before.saved);
    update({ ...getState(), activePane: before.activePane });
    throw error;
  }
  if (getState().definitionNotice === space.id) dismissNotice();
  return true;
}

export async function saveDefinition(
  id: string,
  confirmed = false,
  create?: { key: string; name: string },
): Promise<WorkspaceDefinitionReply> {
  await flushState();
  const space = getState().saved.workspaces.find((item) => item.id === id);
  if (!space) throw new Error('This workspace is no longer available.');
  const order = [...(space.tiling?.panes ?? []), ...space.panes.map((pane) => pane.id)].filter(
    (value, index, all) => all.indexOf(value) === index,
  );
  const reply = await window.viewer.workspaceDefinitions(
    create
      ? { kind: 'save-as', workspaceID: id, order, ...create }
      : { kind: 'save', workspaceID: id, order, confirmed },
  );
  if (reply.kind === 'saved') {
    savePatch({
      workspaces: getState().saved.workspaces.map((item) =>
        item.id !== id
          ? item
          : {
              ...item,
              definition: {
                key: reply.key,
                basis: reply.basis,
                planes: reply.planes,
                source:
                  reply.source ??
                  getState().bootstrap.definitions?.definitions.find(
                    (definition) => definition.key === reply.key,
                  )?.source,
              },
              panes: item.panes.map((pane) => {
                if (pane.type !== 'terminal') return pane;
                const { definitionPlane: _previous, ...rest } = pane;
                return reply.commandPlanes.includes(pane.id)
                  ? { ...rest, definitionPlane: reply.planes[pane.id] }
                  : rest;
              }),
            },
      ),
    });
    await flushState(false);
    if (getState().definitionNotice === id) dismissNotice();
    if (reply.skipped.length || reply.literalPaths.length)
      announce(
        [
          reply.skipped.length ? reply.skipped.length + ' planes stay only in this workspace.' : '',
          reply.literalPaths.length
            ? reply.literalPaths.length + ' paths could not use a root or Home token.'
            : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
  }
  return reply;
}
