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
  >;
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
            throw new Error('This workspace already has a definition. Use Save to definition.');
          const proposed = ports.definitions.proposal(workspace);
          if (request.key === undefined && request.name === undefined)
            return { kind: 'proposal', ...proposed };
          if (!request.key || !request.name) throw new Error('Enter a key and name.');
          const existing = ports.sessions.findByDefinition(request.key);
          if (existing)
            throw new Error('This key is already open. Use Save to definition in that workspace.');
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
          if (!definition) throw new Error('This workspace definition is unavailable.');
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
        throw new Error('This workspace definition is unavailable.');
      if (definition.rootState === 'missing')
        throw new Error('The root folder for this workspace is missing.');
      if (definition.rootState === 'unknown') {
        const root = definition.root;
        if ((await ports.definitions.checkRoot(request.key)) === 'missing')
          throw new Error('The root folder for this workspace is missing.');
        definition = ports.definitions.entry(request.key);
        if (!definition || definition.hidden)
          throw new Error('This workspace definition is unavailable.');
        if (definition.root !== root)
          throw new Error('This definition changed while its root was checked. Open it again.');
      }
      human(owner);
      const reservedOwner = ports.sessions.definitionOwner(request.key);
      if (reservedOwner !== undefined && reservedOwner !== owner) return elsewhere(reservedOwner);
      const open = ports.sessions.findByDefinition(request.key);
      if (open) {
        const other = ports.sessions.owner(open.id);
        if (other !== undefined && other !== owner) return elsewhere(other);
        return { kind: 'active', workspaceID: open.id };
      }
      const reserved = ports.sessions.reserveDefinition(owner, request.key);
      if (reserved !== owner) return elsewhere(reserved);
      await ports.definitions.opened(request.key);
      human(owner);
      return {
        kind: 'build',
        definition: structuredClone(definition),
        closed: ports.memory.get(request.key),
      };
    },
    workspaceDefinitionFile: async ([request], owner) => {
      human(owner);
      await ports.definitions.load();
      human(owner);
      if (request.kind === 'edit') {
        const file = await ports.definitions.edit();
        const error = await shell.openPath(file);
        if (error) throw new Error(error);
      } else if (request.kind === 'validate') await ports.definitions.reload();
      else if (request.kind === 'catalog') {
        if (request.keys !== undefined) ports.definitions.refreshRoots(request.keys, owner);
        else if (request.query !== undefined)
          ports.definitions.searchRoots(request.query, owner, request.limit);
        else ports.definitions.refreshRoots();
      } else if (request.kind === 'allow-source') {
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
      return ports.definitions.snapshot();
    },
  };
}
