import type { ChatPane } from '../../domain/contracts';
import type { ChatDocument } from '../../domain/models/chat';
import { modelPermissionCovers } from '../../domain/models/permissions';
import { sameSourceVersion, sourceVersion } from '../../domain/files/inspection';
import { browserAddress } from '../../domain/previews/browser';
import { activeWorkspace, getState, updatePane } from '../state/store';
import { parentPath } from '../../domain/workspaces/planes';
import { addContentPane } from '../state/panes';
import { localServerSessions } from '../local-servers/runtime';
import type { WorkspaceController } from './context';

type ContentPlaneActions = Pick<
  WorkspaceController,
  | 'openMedia'
  | 'openLayout'
  | 'openBrowser'
  | 'openServer'
  | 'openJournal'
  | 'openOverview'
  | 'newChat'
  | 'openAgentSession'
  | 'openChat'
  | 'openDiff'
  | 'openGitDiff'
  | 'openGitChanges'
  | 'openEvidence'
>;
interface ContentPlanePorts {
  controller(): Pick<WorkspaceController, 'focusPane' | 'rootID' | 'openDiff' | 'open'>;
  registerContent(pane: Parameters<typeof addContentPane>[0], parentID?: string): void;
}

/** Sends a conversation's first message when its model may already receive what it needs;
 * otherwise the message waits as the draft until the person allows it. */
async function startChat(document: ChatDocument, text: string): Promise<void> {
  const providers = getState().settings.settings.providers;
  const provider = providers.find((item) => item.id === document.providerID) ?? providers[0];
  if (!provider) return;
  const permission = await window.viewer.providerPermissionGet(provider.id);
  if (!modelPermissionCovers(permission, provider, document.level)) return;
  await window.viewer.chat({ kind: 'send', id: document.id, text, providerID: provider.id });
}

/** Opens or reuses content views within the captured workspace. The Plurid adapter owns placement. */
export function contentPlaneActions({
  controller,
  registerContent,
}: ContentPlanePorts): ContentPlaneActions {
  return {
    async openMedia(paths, parentID, fresh = false, preset) {
      const space = activeWorkspace(),
        existing =
          !fresh &&
          paths.length === 1 &&
          space.panes.find(
            (pane) =>
              pane.type === 'media' &&
              pane.path === paths[0] &&
              (!parentID || controller().rootID(pane.id) === controller().rootID(parentID)),
          );
      if (existing) {
        controller().focusPane(existing.id, { activate: true });
        return;
      }
      const value = await window.viewer.media({
        kind: 'create',
        paths,
        ...(preset ? { preset } : {}),
      });
      if (!value || !('plan' in value)) throw new Error('The media draft could not be created.');
      if (
        activeWorkspace().id !== space.id ||
        (parentID && !activeWorkspace().panes.some((pane) => pane.id === parentID))
      )
        throw new Error('The originating workspace changed. Open media tools again.');
      const pane = {
        id: crypto.randomUUID(),
        type: 'media' as const,
        path: value.sources[0]!.path,
        draftID: value.id,
      };
      registerContent(pane, parentID);
      controller().focusPane(pane.id, { activate: true });
    },
    openLayout(paths, parentID, mode, opening) {
      const space = activeWorkspace();
      // Pieces of the files opened only, each a whole count.
      const given = Object.entries(opening?.quantities ?? {}).filter(
        ([file, count]) => paths.includes(file) && Number.isInteger(count) && count >= 0,
      );
      const quantities = given.length ? Object.fromEntries(given) : undefined;
      const read = Object.entries(opening?.thicknesses ?? {}).filter(
        ([file, millimetres]) => paths.includes(file) && Number.isFinite(millimetres),
      );
      const thicknesses = read.length ? Object.fromEntries(read) : undefined;
      const wanted = [...paths].sort().join('\n');
      const existing = space.panes.find(
        (pane) =>
          pane.type === 'layout' &&
          [...pane.sources].sort().join('\n') === wanted &&
          (!parentID || controller().rootID(pane.id) === controller().rootID(parentID)),
      );
      if (existing) {
        if (mode && existing.type === 'layout' && existing.mode !== mode)
          updatePane(existing.id, { mode });
        if (quantities) updatePane(existing.id, { quantities });
        if (thicknesses) updatePane(existing.id, { thicknesses });
        controller().focusPane(existing.id, { activate: true });
        return;
      }
      const pane = {
        id: crypto.randomUUID(),
        type: 'layout' as const,
        path: parentPath(paths[0]!),
        sources: [...paths],
        ...(mode ? { mode } : {}),
        ...(quantities ? { quantities } : {}),
        ...(thicknesses ? { thicknesses } : {}),
      };
      registerContent(pane, parentID);
      controller().focusPane(pane.id, { activate: true });
    },
    openBrowser(address, parentID, serverRuntimeID) {
      const url = browserAddress(address);
      const space = activeWorkspace();
      const existing = space.panes.find(
        (pane) =>
          pane.type === 'browser' &&
          (serverRuntimeID ? pane.serverRuntimeID === serverRuntimeID : pane.url === url),
      );
      if (existing) {
        controller().focusPane(existing.id, { activate: true });
        return;
      }
      const parent = space.panes.find((pane) => pane.id === parentID);
      const pane = {
        id: crypto.randomUUID(),
        type: 'browser' as const,
        path: parent?.path ?? getState().bootstrap.home,
        url,
        ...(serverRuntimeID ? { serverRuntimeID, serverPath: '/' } : {}),
      };
      registerContent(pane, parentID);
      controller().focusPane(pane.id, { activate: true });
    },
    openServer(runtimeID) {
      const sessions = localServerSessions();
      const descriptor = sessions.descriptor(runtimeID);
      if (!descriptor) throw new Error('This server is no longer available.');
      const existing = activeWorkspace().panes.find(
        (pane) => pane.type === 'server' && (pane.runtimeID ?? pane.id) === runtimeID,
      );
      if (existing) {
        controller().focusPane(existing.id, { activate: true });
        return;
      }
      const pane = { ...descriptor, id: crypto.randomUUID(), runtimeID };
      registerContent(pane, getState().activePane);
      sessions.retain(
        getState().saved.workspaces.flatMap((space) =>
          space.panes.filter((pane) => pane.type === 'server'),
        ),
      );
      controller().focusPane(pane.id, { activate: true });
    },
    openJournal(filter) {
      const existing = activeWorkspace().panes.find(
        (pane) => pane.type === 'journal' && JSON.stringify(pane.filter) === JSON.stringify(filter),
      );
      const id = existing?.id ?? crypto.randomUUID();
      if (!existing)
        addContentPane({ id, type: 'journal', path: getState().bootstrap.home, filter });
      controller().focusPane(id, { activate: true });
    },
    openOverview() {
      const existing = activeWorkspace().panes.find((pane) => pane.type === 'overview');
      const id = existing?.id ?? crypto.randomUUID();
      if (!existing) addContentPane({ id, type: 'overview', path: getState().bootstrap.home });
      controller().focusPane(id, { activate: true });
    },
    async newChat(paths, draft, send) {
      const owner = activeWorkspace().id;
      const document = await window.viewer.chat({ kind: 'create', paths });
      if (Array.isArray(document)) throw new Error('The conversation could not be created.');
      if (draft)
        await window.viewer.chat({ kind: 'draft', id: document.id, text: draft, revision: 1 });
      if (draft && send) await startChat(document, draft);
      if (owner !== activeWorkspace().id) return;
      const id = crypto.randomUUID();
      addContentPane({ id, type: 'chat', path: document.path, conversationID: document.id });
      controller().focusPane(id, { activate: true });
    },
    async openAgentSession(id, parentPaneID) {
      const owner = activeWorkspace().id;
      const existing = activeWorkspace().panes.find(
        (pane) => pane.type === 'chat' && pane.externalSessionID === id,
      );
      if (existing) {
        controller().focusPane(existing.id, { activate: true });
        return existing.id;
      }
      const reply = await window.viewer.agentSessions({ kind: 'read', id });
      if (reply.kind !== 'session' || activeWorkspace().id !== owner)
        throw new Error('The workspace changed. Reopen the session.');
      const pane: ChatPane = {
        id: crypto.randomUUID(),
        type: 'chat',
        path: reply.session.directory,
        conversationID: id,
        externalSessionID: id,
      };
      registerContent(pane, parentPaneID);
      controller().focusPane(pane.id, { activate: true });
      return pane.id;
    },
    async openChat(conversationID) {
      const owner = activeWorkspace().id;
      const existing = activeWorkspace().panes.find(
        (pane) => pane.type === 'chat' && pane.conversationID === conversationID,
      );
      if (existing) {
        controller().focusPane(existing.id, { activate: true });
        return;
      }
      const document = await window.viewer.chat({ kind: 'open', id: conversationID });
      if (Array.isArray(document)) throw new Error('The conversation could not be opened.');
      if (owner !== activeWorkspace().id) return;
      const id = crypto.randomUUID();
      addContentPane({ id, type: 'chat', path: document.path, conversationID });
      controller().focusPane(id, { activate: true });
    },
    openDiff(left, right, parentPaneID) {
      const id = crypto.randomUUID();
      const sourcePath = (source: typeof left): string | undefined => {
        if (source.kind === 'file') return source.path;
        if (source.kind === 'git') return source.repository.replace(/\/$/, '') + '/' + source.path;
        return undefined;
      };
      const path = sourcePath(right) ?? sourcePath(left) ?? getState().bootstrap.home;
      registerContent({ id, type: 'diff', path, left, right, mode: 'split' }, parentPaneID);
      controller().focusPane(id);
    },
    async openGitDiff(file, parentPaneID) {
      const owner = activeWorkspace().id;
      const result = await window.viewer.git({ kind: 'head', path: file });
      if (owner !== activeWorkspace().id) return;
      if (result.kind !== 'head') throw new Error('Git comparison is unavailable.');
      let exists = true;
      try {
        await window.viewer.stat(file);
      } catch {
        exists = false;
      }
      if (owner !== activeWorkspace().id) return;
      controller().openDiff(
        result.source ?? { kind: 'empty', name: 'Absent at HEAD' },
        exists ? { kind: 'file', path: file } : { kind: 'empty', name: 'Deleted working file' },
        parentPaneID,
      );
    },
    openGitChanges(path, parentPaneID) {
      const existing = activeWorkspace().panes.find(
        (pane) => pane.type === 'git-changes' && pane.path === path,
      );
      const id = existing?.id ?? crypto.randomUUID();
      if (!existing) registerContent({ id, type: 'git-changes', path }, parentPaneID);
      controller().focusPane(id);
    },
    async openEvidence(evidence, parentPaneID) {
      const origin = activeWorkspace().id;
      const entry = await window.viewer.stat(evidence.path);
      if (origin !== activeWorkspace().id)
        throw new Error('The workspace changed. Open the result again.');
      if (!sameSourceVersion(sourceVersion(entry), evidence.version))
        throw new Error(
          'This search evidence is stale. Refresh the index before opening its location.',
        );
      // Search hits also carry transient coverage metadata. Persist only the
      // navigation contract so one result cannot block all workspace saves.
      controller().open(entry, parentPaneID, {
        evidence: {
          path: evidence.path,
          version: evidence.version,
          anchor: evidence.anchor,
          quote: evidence.quote,
        },
      });
    },
  };
}
