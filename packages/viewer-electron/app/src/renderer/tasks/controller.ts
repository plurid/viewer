import type { RefObject } from 'react';
import type { PluridApplicationHandle } from '@plurid/plurid-react';
import type { Pane } from '../../domain/contracts';
import type { CapturedTarget } from '../../domain/automation/actions';
import {
  taskReference,
  taskReferenceKey,
  type TaskArea,
  type TaskReference,
} from '../../domain/workspaces/tasks';
import { activeWorkspace, changeWorkspace, getState } from '../state/store';
import { folderPane } from '../state/panes';
import { setTiling } from '../state/workspaces';
import { applyTiling } from '../workspace/tiling';
import { allowTerminalStart, deferTerminalStart } from '../terminals/sessions';
import { localServerSessions } from '../local-servers/runtime';
import type { WorkspaceController } from '../workspace/context';
import { browserAddress } from '../../domain/previews/browser';
import { attachTaskPlane, attachTaskReference, changeTaskArea } from './state';
import { initializeTaskNote } from '../notes/sessions';
import { sendWindowEvent } from '../app/window-events';

type Methods = Pick<
  WorkspaceController,
  | 'newTaskArea'
  | 'installTaskArea'
  | 'setupTaskArea'
  | 'openTaskArea'
  | 'openTaskMember'
  | 'addTaskTool'
  | 'attachTaskPlane'
  | 'arrangeTaskArea'
  | 'refreshTaskArea'
  | 'openReceipt'
  | 'runTaskCommand'
>;
type TaskContent = Extract<Pane, { type: TaskReference['kind'] | 'task' }>;
export function taskController(ports: {
  controller(): WorkspaceController;
  register(pane: TaskContent, parentID?: string): void;
  waitFor(paneIDs: readonly string[], workspaceID: string): Promise<void>;
  engine: RefObject<PluridApplicationHandle | null>;
  surface: RefObject<HTMLDivElement | null>;
}): Methods {
  const area = (id: string) => {
    const value = activeWorkspace().taskAreas?.find((area) => area.id === id);
    if (!value) throw new Error('This task area is unavailable.');
    return value;
  };
  const check = (spaceID: string) => {
    if (activeWorkspace().id !== spaceID)
      throw new Error('The workspace changed. Reopen the task area.');
  };
  const overview = (id: string) =>
    activeWorkspace().panes.find((pane) => pane.type === 'task' && pane.areaID === id);
  const checkout = async (directory: string) => {
    let catalogID: string | undefined;
    try {
      const reply = await window.viewer.gitWorktrees({ kind: 'list', directory });
      if (reply.kind === 'catalog') {
        catalogID = reply.catalog.id;
        const current = reply.catalog.worktrees.find(
          (tree) => tree.path === reply.catalog.currentPath,
        );
        if (current?.available) {
          const source = await window.viewer.stat(current.path);
          return {
            path: current.path,
            identity: source.identity,
            branch: current.branch,
            commit: current.commit,
            observed: Date.now(),
          };
        }
      }
    } catch {
      /* Ordinary folders can anchor tasks without claiming Git metadata. */
    } finally {
      if (catalogID)
        void window.viewer.gitWorktrees({ kind: 'release', catalogID }).catch(() => {});
    }
    const source = await window.viewer.stat(directory);
    if (!source.directory || source.kind === 'symlink')
      throw new Error('Choose an ordinary folder for this task.');
    return { path: source.path, identity: source.identity, observed: Date.now() };
  };
  const methods: Methods = {
    async installTaskArea(bundle) {
      check(bundle.workspaceID);
      const space = activeWorkspace();
      const existing = space.taskAreas?.find((area) => area.id === bundle.area.id);
      if (existing && existing.checkout.identity !== bundle.area.checkout.identity)
        throw new Error('A different task already uses this ID.');
      const note = bundle.panes.find((pane) => pane.type === 'note');
      if (
        !note ||
        note.documentID !== bundle.note.id ||
        bundle.note.directory !== bundle.area.checkout.path
      )
        throw new Error('The task note does not match its checkout.');
      initializeTaskNote(note.id, bundle.note);
      if (!existing) {
        if ((space.taskAreas?.length ?? 0) >= 50)
          throw new Error('A workspace supports up to 50 task areas.');
        changeWorkspace((space) => ({
          ...space,
          taskAreas: [...(space.taskAreas ?? []), bundle.area],
        }));
      }
      // Restored and agent-created terminals never acquire a start capability.
      deferTerminalStart(
        bundle.panes.filter((pane) => pane.type === 'terminal').map((pane) => pane.id),
      );
      const overview = bundle.panes.find((pane) => pane.type === 'task');
      if (!overview) throw new Error('The task overview is missing.');
      if (!activeWorkspace().panes.some((pane) => pane.id === overview.id))
        ports.register(overview);
      // Root views mount on a later frame. Linking children before that frame
      // makes the canvas reject a parent that exists in saved state only.
      await ports.waitFor([overview.id], bundle.workspaceID);
      check(bundle.workspaceID);
      for (const pane of bundle.panes.filter((pane) => pane.type !== 'task')) {
        if (!activeWorkspace().panes.some((existing) => existing.id === pane.id))
          ports.register(pane, overview.id);
      }
      await ports.waitFor(
        bundle.panes.map((pane) => pane.id),
        bundle.workspaceID,
      );
      check(bundle.workspaceID);
      methods.arrangeTaskArea(bundle.area.id);
      methods.openTaskArea(bundle.area.id);
    },
    async setupTaskArea(id) {
      const owner = activeWorkspace().id;
      // Retry reopens the same durable references rather than creating another
      // note or logical terminal after a partially completed setup.
      for (const kind of ['folder', 'note', 'terminal', 'git-changes'] as const) {
        check(owner);
        const member = area(id).members.find((member) => member.reference.kind === kind);
        if (member) await methods.openTaskMember(id, member.id);
        else await methods.addTaskTool(id, kind);
      }
      check(owner);
      methods.openTaskArea(id);
      methods.arrangeTaskArea(id);
    },
    async newTaskArea(target, name) {
      const space = activeWorkspace(),
        source = space.panes.find((pane) => pane.id === target.paneID);
      if (source?.type !== 'folder' || source.path !== target.panePath)
        throw new Error('The originating folder changed.');
      if ((space.taskAreas?.length ?? 0) >= 50)
        throw new Error('A workspace supports up to 50 task areas.');
      const observed = await checkout(target.directory);
      check(space.id);
      if (activeWorkspace().panes.find((pane) => pane.id === source.id)?.path !== source.path)
        throw new Error('The originating folder changed.');
      const now = Date.now(),
        id = crypto.randomUUID();
      const value: TaskArea = {
        id,
        name: name.trim().slice(0, 100) || 'Untitled task',
        checkout: observed,
        members: [],
        created: now,
        updated: now,
      };
      changeWorkspace((space) => ({ ...space, taskAreas: [...(space.taskAreas ?? []), value] }));
      attachTaskReference(
        id,
        { kind: 'folder', path: observed.path },
        'Checkout',
        source.path === observed.path ? source.id : undefined,
      );
      methods.openTaskArea(id);
      return id;
    },
    openTaskArea(id) {
      const value = area(id),
        existing = overview(id);
      if (existing) {
        ports.controller().focusPane(existing.id, { activate: true });
        return;
      }
      const pane: Pane = {
        id: crypto.randomUUID(),
        type: 'task',
        path: value.checkout.path,
        areaID: id,
        title: value.name,
      };
      ports.register(pane);
      ports.controller().focusPane(pane.id, { activate: true });
    },
    async refreshTaskArea(id) {
      const value = area(id),
        owner = activeWorkspace().id,
        next = await checkout(value.checkout.path);
      check(owner);
      if (value.checkout.identity && next.identity !== value.checkout.identity)
        throw new Error(
          'The checkout folder was replaced. Create a new task area for that folder.',
        );
      changeTaskArea(id, (area) => ({ ...area, checkout: next, updated: Date.now() }));
    },
    attachTaskPlane(id, paneID) {
      const pane = activeWorkspace().panes.find((pane) => pane.id === paneID);
      if (!pane) throw new Error('The source plane closed.');
      attachTaskPlane(id, pane);
    },
    async openTaskMember(id, memberID) {
      const value = area(id),
        owner = activeWorkspace().id,
        member = value.members.find((member) => member.id === memberID);
      if (!member) throw new Error('This tool is unavailable.');
      const ref = member.reference,
        key = taskReferenceKey(ref);
      const existing = activeWorkspace().panes.find(
        (pane) =>
          member.views.includes(pane.id) &&
          taskReference(pane) &&
          taskReferenceKey(taskReference(pane)!) === key,
      );
      if (existing) {
        ports.controller().focusPane(existing.id, { activate: true });
        return existing.id;
      }
      if (
        (ref.kind === 'terminal' || ref.kind === 'server') &&
        ref.path === value.checkout.path &&
        value.checkout.identity
      ) {
        const source = await window.viewer.stat(ref.path);
        if (!source.directory || source.identity !== value.checkout.identity)
          throw new Error('The checkout folder was replaced.');
      }
      let pane: TaskContent;
      const paneID = crypto.randomUUID();
      switch (ref.kind) {
        case 'folder': {
          const source = await window.viewer.stat(ref.path);
          if (!source.directory) throw new Error('This checkout folder is unavailable.');
          if (
            ref.path === value.checkout.path &&
            value.checkout.identity &&
            source.identity !== value.checkout.identity
          )
            throw new Error('The checkout folder was replaced.');
          pane = { ...folderPane(ref.path), id: paneID };
          break;
        }
        case 'preview':
          pane = { id: paneID, type: 'preview', path: ref.path };
          break;
        case 'note': {
          const result = await window.viewer.notes({ kind: 'read', id: ref.documentID });
          if (result.kind !== 'document') throw new Error('Note unavailable.');
          pane = {
            id: paneID,
            type: 'note',
            path: result.document.directory,
            documentID: ref.documentID,
            title: result.document.title,
          };
          break;
        }
        case 'chat': {
          if (ref.externalSessionID) {
            const reply = await window.viewer.agentSessions({
              kind: 'read',
              id: ref.externalSessionID,
            });
            if (reply.kind !== 'session') throw new Error('Agent session unavailable.');
            pane = {
              id: paneID,
              type: 'chat',
              path: reply.session.directory,
              conversationID: ref.conversationID,
              externalSessionID: ref.externalSessionID,
            };
            break;
          }
          const result = await window.viewer.chat({ kind: 'open', id: ref.conversationID });
          if (Array.isArray(result)) throw new Error('Conversation unavailable.');
          pane = {
            id: paneID,
            type: 'chat',
            path: result.path,
            conversationID: ref.conversationID,
          };
          break;
        }
        case 'terminal':
          pane = {
            id: paneID,
            type: 'terminal',
            path: ref.path,
            profileID: ref.profileID,
            taskSessionID: ref.sessionID,
          };
          allowTerminalStart(paneID);
          break;
        case 'git-changes':
          pane = { id: paneID, type: 'git-changes', path: ref.path };
          break;
        case 'diff':
          pane = { id: paneID, type: 'diff', path: ref.path, left: ref.left, right: ref.right };
          break;
        case 'browser':
          pane = {
            id: paneID,
            type: 'browser',
            path: ref.path,
            url: ref.url,
            serverRuntimeID: ref.serverRuntimeID,
            serverPath: ref.serverPath,
          };
          break;
        case 'server': {
          const live = ref.runtimeID && localServerSessions().descriptor(ref.runtimeID);
          pane = live
            ? { ...live, id: paneID, runtimeID: ref.runtimeID }
            : { id: paneID, type: 'server', path: ref.path, runtimeID: ref.runtimeID };
          break;
        }
        case 'receipt':
          pane = { id: paneID, type: 'receipt', path: ref.path, receiptID: ref.receiptID };
          break;
      }
      check(owner);
      area(id);
      ports.register(pane, overview(id)?.id);
      attachTaskReference(
        id,
        taskReference(pane)!,
        pane.type === 'note' ? pane.title : member.title,
        pane.id,
      );
      ports.controller().focusPane(pane.id, { activate: true });
      return pane.id;
    },
    async addTaskTool(id, kind, url) {
      const value = area(id),
        owner = activeWorkspace().id;
      let reference: TaskReference, title: string;
      if (kind === 'note' || kind === 'checklist') {
        const result = await window.viewer.notes({
          kind: 'create',
          format: kind,
          directory: value.checkout.path,
        });
        if (result.kind !== 'document') throw new Error('Note creation failed.');
        reference = {
          kind: 'note',
          path: result.document.directory,
          documentID: result.document.id,
        };
        title = result.document.title;
      } else if (kind === 'chat') {
        const document = await window.viewer.chat({ kind: 'create', paths: [value.checkout.path] });
        if (Array.isArray(document)) throw new Error('Conversation creation failed.');
        reference = { kind: 'chat', path: document.path, conversationID: document.id };
        title = 'Conversation';
      } else if (kind === 'terminal') {
        reference = {
          kind: 'terminal',
          path: value.checkout.path,
          profileID: getState().settings.settings.terminals.profileID,
          sessionID: crypto.randomUUID(),
        };
        title = 'Terminal';
      } else if (kind === 'browser') {
        if (!url) throw new Error('Enter a website address.');
        const address = browserAddress(url);
        const server = localServerSessions()
          .all()
          .find((server) => new URL(server.url).origin === new URL(address).origin);
        const location = new URL(address);
        reference = {
          kind: 'browser',
          path: value.checkout.path,
          url: address,
          ...(server
            ? {
                serverRuntimeID: server.paneID,
                serverPath: location.pathname + location.search + location.hash,
              }
            : {}),
        };
        title = new URL(address).hostname;
      } else if (kind === 'server') {
        reference = { kind: 'server', path: value.checkout.path, runtimeID: crypto.randomUUID() };
        title = 'Local server';
      } else {
        reference = { kind, path: value.checkout.path };
        title = kind === 'folder' ? 'Checkout' : 'Git changes';
      }
      check(owner);
      attachTaskReference(id, reference, title);
      const added = area(id).members.find(
        (member) => taskReferenceKey(member.reference) === taskReferenceKey(reference),
      )!;
      return methods.openTaskMember(id, added.id);
    },
    arrangeTaskArea(id) {
      const value = area(id),
        space = activeWorkspace(),
        ids = [overview(id)?.id, ...value.members.flatMap((member) => member.views)].filter(
          (id): id is string => !!id && space.panes.some((pane) => pane.id === id),
        );
      const panes = [...new Set(ids)].slice(0, 30);
      if (!panes.length) return;
      setTiling({ panes, layout: 'tiled', main: 0.5 });
      applyTiling(ports.engine, ports.surface);
    },
    openReceipt(receiptID, directory) {
      const existing = activeWorkspace().panes.find(
        (pane) => pane.type === 'receipt' && pane.receiptID === receiptID,
      );
      if (existing) {
        ports.controller().focusPane(existing.id, { activate: true });
        return;
      }
      const pane: Pane = {
        id: crypto.randomUUID(),
        type: 'receipt',
        receiptID,
        path: directory ?? getState().bootstrap.home,
      };
      ports.register(pane);
      ports.controller().focusPane(pane.id, { activate: true });
    },
    async runTaskCommand(id) {
      const value = area(id),
        member = value.members.find(
          (member) =>
            member.reference.kind === 'folder' && member.reference.path === value.checkout.path,
        );
      if (!member) throw new Error('Attach the checkout folder first.');
      const paneID = await methods.openTaskMember(id, member.id);
      const pane = activeWorkspace().panes.find((pane) => pane.id === paneID);
      if (pane?.type !== 'folder') throw new Error('Checkout unavailable.');
      const rootID = ports.controller().rootID(paneID);
      if (!rootID) throw new Error('The checkout is still opening. Try again.');
      const target: CapturedTarget = {
        workspaceID: activeWorkspace().id,
        rootID,
        paneID,
        panePath: pane.path,
        directory: value.checkout.path,
        selection: [],
      };
      sendWindowEvent('viewer:run-command', target);
    },
  };
  return methods;
}
