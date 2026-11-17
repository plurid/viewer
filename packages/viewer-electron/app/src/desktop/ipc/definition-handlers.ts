import { shell } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { definitionWasRemoved } from '../../domain/workspaces/catalog';
import type { ApiHandlers } from './schemas';
import type { WorkspaceDefinitions } from '../workspaces/definitions';
import type { WorkspaceSessions } from '../windows/workspace-sessions';
import type { DialogAccess } from '../native/dialogs';
import { chooseRemembered } from '../native/dialogs';
import type { DefinedWorkspaces } from '../workspaces/defined-workspaces';

interface DefinitionPorts {
  definitions: Pick<
    WorkspaceDefinitions,
    | 'load'
    | 'snapshot'
    | 'entry'
    | 'opened'
    | 'reload'
    | 'edit'
    | 'refreshRoots'
    | 'checkRoot'
    | 'searchRoots'
    | 'save'
    | 'proposal'
    | 'setProjectManager'
    | 'refreshSourceOffer'
  > &
    Partial<Pick<WorkspaceDefinitions, 'prepareKeys' | 'hideFound' | 'showFound'>>;
  memory: Pick<DefinedWorkspaces, 'get' | 'remember' | 'forget' | 'problem'>;
  sessions: Pick<
    WorkspaceSessions,
    'findByDefinition' | 'owner' | 'reserveDefinition' | 'definitionOwner' | 'snapshot'
  >;
  isAgent(owner: number): boolean;
  window(owner: number): BrowserWindow | undefined;
  fileAccess: DialogAccess;
}

export function createDefinitionHandlers(
  ports: DefinitionPorts,
): Pick<ApiHandlers, 'workspaceDefinitions' | 'workspaceDefinitionFile'> {
  const human = (owner: number) => {
    if (ports.isAgent(owner))
      throw new Error('Workspace definitions are available only to the person.');
  };
  const elsewhere = (owner: number) => {
    const window = ports.window(owner);
    if (window && !window.isDestroyed()) {
      window.show();
      window.focus();
    }
    return { kind: 'elsewhere' as const };
  };
  return {
    workspaceDefinitions: async ([request], owner) => {
      human(owner);
      await ports.definitions.load();
      human(owner);
      await ports.definitions.prepareKeys?.();
      human(owner);
      if (request.kind === 'forget') {
        const reserved = ports.sessions.definitionOwner(request.key);
        if (reserved !== undefined && reserved !== owner)
          throw new Error('Switch to that window to forget its remembered planes.');
        const open = ports.sessions.findByDefinition(request.key);
        if (
          open &&
          ports.sessions.owner(open.id) !== undefined &&
          ports.sessions.owner(open.id) !== owner
        )
          throw new Error('Switch to that window to forget its remembered planes.');
        await ports.memory.forget(request.key);
        return { kind: 'forgotten' };
      }
      if (request.kind !== 'open') {
        const state = ports.sessions.snapshot();
        const workspace = state?.workspaces.find((space) => space.id === request.workspaceID);
        if (!state || !workspace) throw new Error('This workspace is no longer available.');
        const other = ports.sessions.owner(workspace.id);
        if (other !== undefined && other !== owner)
          throw new Error(
            'Switch to that window to ' +
              (request.kind === 'close' ? 'close it.' : 'change its definition.'),
          );
        const key = workspace.definition?.key;
        if (request.kind === 'save-as') {
          if (key && !definitionWasRemoved(workspace, ports.definitions.snapshot()))
            throw new Error('This workspace already has a definition. Use Save to Definition.');
          const proposed = ports.definitions.proposal(workspace);
          if (request.key === undefined && request.name === undefined)
            return { kind: 'proposal', ...proposed };
          if (!request.key || !request.name) throw new Error('Enter a key and name.');
          const existing = ports.sessions.findByDefinition(request.key);
          if (existing)
            throw new Error('This key is already open. Use Save to Definition in that workspace.');
          if (ports.sessions.reserveDefinition(owner, request.key) !== owner)
            throw new Error('This definition is being opened in another window.');
          human(owner);
          return ports.definitions.save(
            workspace,
            request.order,
            true,
            { key: request.key, name: request.name },
            () => human(owner),
          );
        }
        if (!key) throw new Error('This workspace has no definition.');
        if (
          workspace.definition?.source === 'found' &&
          ports.definitions.entry(key)?.source !== undefined &&
          ports.definitions.entry(key)?.source !== 'found'
        )
          throw new Error('Viewer no longer finds this folder. Save it as another definition.');
        if (request.kind === 'close-info')
          return { kind: 'close-info', problem: ports.memory.problem(workspace, state) };
        if (ports.sessions.reserveDefinition(owner, key) !== owner)
          throw new Error('This definition is being changed in another window.');
        human(owner);
        if (request.kind === 'close') {
          const problem = ports.memory.problem(workspace, state);
          if (problem && !request.withoutMemory) return { kind: 'close-info', problem };
          const remembered = {
            ...workspace,
            panes: workspace.panes.map((pane) => {
              if (pane.type === 'scratch') return { ...pane, bufferID: randomUUID() };
              if (pane.type === 'preview' || pane.type === 'diff') {
                const { bufferID: _buffer, ...rest } = pane;
                return rest;
              }
              return pane;
            }),
          };
          if (!problem) await ports.memory.remember(remembered, state);
          else if (ports.memory.get(key)) await ports.memory.forget(key);
          return { kind: 'closed' };
        }
        if (request.kind === 'reset') {
          const definition = ports.definitions.entry(key);
          if (!definition)
            throw new Error(
              'Viewer can’t find this workspace’s definition. It may have been removed from its file.',
            );
          await ports.memory.forget(key);
          return { kind: 'reset', definition: structuredClone(definition) };
        }
        return ports.definitions.save(
          workspace,
          request.order,
          !!request.confirmed,
          undefined,
          () => human(owner),
        );
      }
      let definition = ports.definitions.entry(request.key);
      if (!definition || definition.hidden)
        throw new Error(
          'Viewer can’t find this workspace’s definition. It may have been removed from its file.',
        );
      if (definition.rootState === 'missing')
        throw new Error('The root folder for this workspace is missing.');
      if (definition.rootState === 'unknown') {
        const root = definition.root;
        if ((await ports.definitions.checkRoot(request.key)) === 'missing')
          throw new Error('The root folder for this workspace is missing.');
        definition = ports.definitions.entry(request.key);
        if (!definition || definition.hidden)
          throw new Error(
            'Viewer can’t find this workspace’s definition. It may have been removed from its file.',
          );
        if (definition.root !== root)
          throw new Error('This definition changed while its root was checked. Open it again.');
      }
      human(owner);
      const reservedOwner = ports.sessions.definitionOwner(request.key);
      if (reservedOwner !== undefined && reservedOwner !== owner) return elsewhere(reservedOwner);
      const open = ports.sessions.findByDefinition(request.key);
      if (open && !(open.definition?.source === 'found' && definition.source !== 'found')) {
        const other = ports.sessions.owner(open.id);
        if (other !== undefined && other !== owner) return elsewhere(other);
        return { kind: 'active', workspaceID: open.id };
      }
      const reserved = ports.sessions.reserveDefinition(owner, request.key);
      if (reserved !== owner) return elsewhere(reserved);
      await ports.definitions.opened(request.key);
      human(owner);
      const closed = ports.memory.get(request.key);
      return {
        kind: 'build',
        definition: structuredClone(definition),
        closed:
          closed?.workspace.definition?.source === 'found' && definition.source !== 'found'
            ? undefined
            : closed,
      };
    },
    workspaceDefinitionFile: async ([request], owner) => {
      human(owner);
      await ports.definitions.load();
      human(owner);
      if (request.kind === 'project-manager')
        await ports.definitions.setProjectManager(request.enabled, () => human(owner));
      if (request.kind === 'not-a-workspace') {
        // an open workspace linked to it would lose its definition: it is closed first
        const open = ports.sessions.findByDefinition(request.key);
        if (open) throw new Error(`Close “${open.name}” first.`);
        await ports.definitions.hideFound?.(request.key);
      } else if (request.kind === 'show-found') await ports.definitions.showFound?.(request.root);
      if (request.kind === 'edit') {
        const file = await ports.definitions.edit();
        const error = await shell.openPath(file);
        if (error) throw new Error(error);
      } else if (request.kind === 'validate') await ports.definitions.reload();
      else if (request.kind === 'catalog') {
        await ports.definitions.refreshSourceOffer();
        if (request.keys !== undefined) ports.definitions.refreshRoots(request.keys, owner);
        else if (request.query !== undefined)
          ports.definitions.searchRoots(request.query, owner, request.limit);
        else ports.definitions.refreshRoots();
      }
      if (
        request.kind === 'allow-source' ||
        (request.kind === 'project-manager' &&
          request.enabled &&
          ports.definitions.snapshot().projectManager.state === 'needs-access')
      ) {
        human(owner);
        if (ports.definitions.snapshot().projectManager.enabled !== true)
          throw new Error('Choose Use VS Code Projects before allowing access.');
        const window = ports.window(owner);
        if (!window) throw new Error('This window has closed.');
        await chooseRemembered(
          ports.fileAccess,
          window,
          {
            title: 'Allow access to Project Manager',
            defaultPath: path.dirname(ports.definitions.snapshot().projectManager.path),
            properties: ['openDirectory'],
          },
          true,
        );
        await ports.definitions.reload();
      }
      human(owner);
      return ports.definitions.snapshot();
    },
  };
}
