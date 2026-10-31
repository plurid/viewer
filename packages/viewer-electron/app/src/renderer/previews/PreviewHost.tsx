import {
  memo,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { WorkspaceContext } from '../workspace/context';
import {
  effectiveWindowLook,
  effectiveWindowSettings,
  effectiveWindowUI,
} from '../state/effective-ui';
import type { FileEntry, Resource } from '../../domain/contracts';
import { Empty, ErrorBoundary, IconButton, Loading } from '../ui/primitives';
import {
  activeWorkspace,
  getState,
  quickPreview,
  report,
  useViewer,
  updatePane,
} from '../state/store';
import { useCommands } from '../commands/context';
import { usePreviewControlsSlot } from './controls';
import type {
  AttachmentSave,
  PreviewCommand,
  PreviewContext,
  PreviewModule,
  PreviewToolbarSet,
} from './contracts';
import { previewState } from './state';
import { choosePreview } from './registry';
import { FolderAccessButton, needsFolderAccess } from '../ui/permissions/FolderAccessButton';
import {
  sameSourceVersion,
  sourceVersion,
  type EvidenceNavigation,
  type SourceVersion,
} from '../../domain/files/inspection';
import { parentPath } from '../../domain/workspaces/planes';
import { editingPlane } from '../editing/planes';
import { useResource } from './useResource';
import { PreviewRecovery } from './PreviewRecovery';
import { documentServices } from './document-cache';
import { PreviewSize } from './PreviewSize';
import { saveAttachments } from './attachments';
import { loadedPreviewModule, preloadPreviewModule } from './module-loading';
import { useDarkPages } from './dark-pages';

const components = new Map<string, ReturnType<typeof lazy<React.ComponentType<PreviewContext>>>>();
/** One stable component per module. Once its code has loaded, the loader settles in the same call,
 * so React renders it without suspending (`module-loading.ts` says why that matters). */
function componentFor(module: PreviewModule) {
  let component = components.get(module.id);
  if (!component) {
    component = lazy(() => {
      const ready = loadedPreviewModule(module);
      if (!ready) return preloadPreviewModule(module).then((value) => ({ default: value }));
      const settled = {
        then: (resolve: (value: { default: React.ComponentType<PreviewContext> }) => void) =>
          resolve({ default: ready }),
      };
      return settled as unknown as Promise<{ default: React.ComponentType<PreviewContext> }>;
    });
    components.set(module.id, component);
  }
  return component;
}
/** Any file's bytes, which the host shows in place of its module with Show as hex. */
const hexModule: PreviewModule = {
  id: 'hex',
  label: 'Hex',
  formats: [],
  detect: () => 0,
  load: () => import('./modules/HexPreview'),
};
/** Show as hex, which a footer of the caller's own may offer, as Quick Preview's does. */
export interface HexToggle {
  shown: boolean;
  toggle(): void;
}
const services: PreviewContext['services'] = {
  htmlPreview: (id, message) => window.viewer.htmlPreview(id, message),
  htmlPreviewClose: (id) => window.viewer.htmlPreviewClose(id),
  thumbnail: (file, size) => window.viewer.thumbnail(file, size),
  document: (id, request) => window.viewer.document(id, request),
  cancelDocument: (id, requestID) => window.viewer.cancelDocument(id, requestID),
  read: (id, limit) => window.viewer.read(id, limit),
  archive: (id) => window.viewer.archive(id),
  archiveEntry: (id, name) => window.viewer.archiveEntry(id, name),
  sqlite: (id, request) => window.viewer.sqlite(id, request),
  rendition: (id, request) => window.viewer.imageRendition(id, request),
  videoRendition: (id, requestID) => window.viewer.videoRendition(id, requestID),
  officeLayout: (id, request) => window.viewer.officeLayout(id, request),
  officeImage: (id, part, requestID) => window.viewer.officeImage(id, part, requestID),
  list: (folder) => window.viewer.list(folder),
  resource: (file) => window.viewer.resource(file),
  release: (id) => window.viewer.release(id),
};
export const PreviewHost = memo(function PreviewHost({
  path,
  evidence,
  active = true,
  interactive = true,
  resource: supplied,
  paneID,
  editable = false,
  renderFooter,
}: {
  path?: string;
  evidence?: EvidenceNavigation;
  active?: boolean;
  interactive?: boolean;
  resource?: Resource;
  paneID?: string;
  /** A workspace preview plane, whose text may be edited where it is. */
  editable?: boolean;
  renderFooter?(resource: Resource, module: PreviewModule, hex?: HexToggle): ReactNode;
}) {
  const [retry, setRetry] = useState(0);
  const [activated, setActivated] = useState(active);
  const {
    resource,
    signal,
    error,
    code: errorCode,
    cancel,
  } = useResource(path, supplied, activated, retry);
  const [subscriber] = useState(() => `preview:${paneID || crypto.randomUUID()}`);
  const registry = useCommands();
  const header = usePreviewControlsSlot(paneID);
  const workspace = useContext(WorkspaceContext);
  const openRelated = useMemo(
    () =>
      paneID && workspace
        ? (file: string) =>
            void workspace.openPath(file, { paneID, linked: true, activate: true }).catch(report)
        : undefined,
    [paneID, workspace],
  );
  useEffect(() => {
    if (active) setActivated(true);
  }, [active]);
  const entry = resource?.entry;
  const owner = useViewer((state) => state.saved.activeWorkspace);
  const scopedServices = useMemo(
    () => (resource ? documentServices(services, owner, resource, signal) : services),
    [owner, resource, signal],
  );
  // A PREVIEW PLANE FOLLOWS ITS FILE: saved in another app, it shows the new version.
  // Its folder is watched; a change there is the file's only when the file's version changed.
  const seen = useRef<SourceVersion | undefined>(undefined);
  // the file as it is now, for the footer: a save changes its size after the preview opened
  const [current, setCurrent] = useState<FileEntry | undefined>(undefined);
  const [sourceIssue, setSourceIssue] = useState<{ path: string; detail: string }>();
  const [recheck, setRecheck] = useState(0);
  useEffect(() => {
    seen.current = entry ? sourceVersion(entry) : undefined;
    setCurrent(undefined);
    setSourceIssue(undefined);
  }, [entry]);
  useEffect(() => {
    if (!path || supplied || !activated) return;
    const folder = parentPath(path);
    void window.viewer.watch(folder, subscriber).catch(() => {});
    let live = true;
    let checking = false,
      again = false;
    const check = async (): Promise<void> => {
      const latest = await window.viewer.stat(path);
      if (!live) return;
      setSourceIssue(undefined);
      const version = sourceVersion(latest);
      if (!seen.current || sameSourceVersion(version, seen.current)) return;
      seen.current = version;
      // a link's own entry is not its file's
      if (latest.kind === 'file') setCurrent(latest);
      // a text plane reads it again in place, and an edited one asks before losing edits
      const plane = paneID ? editingPlane(paneID) : undefined;
      if (plane?.changedOnDisk) plane.changedOnDisk();
      else setRetry((value) => value + 1);
    };
    const changed = () => {
      if (checking) {
        again = true;
        return;
      }
      checking = true;
      const run = (): Promise<void> =>
        check()
          .catch(() => {
            if (live)
              setSourceIssue({
                path,
                detail: 'The file has moved or its location is unavailable.',
              });
          })
          .then(() => {
            if (!again || !live) return;
            again = false;
            return run();
          });
      void run().finally(() => {
        checking = false;
      });
    };
    const off = window.viewer.onEvent((event) => {
      if (event.type === 'folder-changed' && event.path === folder) changed();
    });
    window.addEventListener('focus', changed);
    if (recheck) changed();
    return () => {
      live = false;
      off();
      window.removeEventListener('focus', changed);
      void window.viewer.unwatch(subscriber).catch(() => {});
    };
  }, [paneID, path, supplied, activated, subscriber, recheck]);
  const viewState = useMemo(
    () => previewState(paneID || path || supplied?.id || 'temporary', entry),
    [paneID, path, supplied?.id, entry],
  );
  const limits = useViewer((state) => state.settings.settings.previews);
  const fontSize = useViewer((state) => effectiveWindowSettings(state).previews.textFontSize);
  const editing = useMemo(
    () => (editable && paneID && !supplied ? { paneID } : undefined),
    [editable, paneID, supplied],
  );
  const look = useViewer(effectiveWindowLook);
  const pages = useDarkPages();
  // a workspace plane's header shows a format's main tools, unless the person wants every one
  const formatTools = useViewer(
    (state) => effectiveWindowUI(state).space.headerControls.formatTools,
  );
  const toolbar: PreviewToolbarSet | undefined =
    paneID && !supplied ? (formatTools ? 'all' : 'essential') : undefined;
  useEffect(
    () =>
      window.viewer.onEvent((event) => {
        if (event.type !== 'file-access') return;
        const file = path || supplied?.entry.path;
        const within =
          file &&
          (file === event.path ||
            file.startsWith(event.path.endsWith('/') ? event.path : event.path + '/'));
        if (!within && !event.resources?.includes(resource?.id || supplied?.id || '')) return;
        // Dispose decoded bytes, media and GPU state as soon as access stops. The
        // completion event can retry the owned path after an unsuccessful eject.
        if (supplied) cancel('This preview is no longer available.');
        else {
          cancel();
          setRetry((value) => value + 1);
        }
      }),
    [path, supplied, resource?.id, cancel],
  );
  // A module and the views inside it register commands here: one registry source holds them
  // all, with the host's own Show as hex.
  const registered = useRef(new Set<readonly PreviewCommand[]>());
  const [hexFor, setHexFor] = useState<string>();
  const hexShown = !!resource && hexFor === resource.id;
  const offersHex = !!resource && (hexShown || choosePreview(resource.entry).hex !== 'own');
  const resourceID = resource?.id;
  const toggleHex = useCallback(
    () => setHexFor((current) => (current === resourceID ? undefined : resourceID)),
    [resourceID],
  );
  const hostCommands = useMemo<readonly PreviewCommand[]>(
    () =>
      offersHex
        ? [
            {
              id: 'hex',
              label: hexShown ? 'Show preview' : 'Show as hex',
              aliases: ['hex', 'bytes'],
              run: toggleHex,
            },
          ]
        : [],
    [offersHex, hexShown, toggleHex],
  );
  const commandSource = paneID ? `preview:${paneID}` : undefined;
  const commands = useMemo<PreviewContext['commands']>(
    () =>
      !commandSource || !resource
        ? undefined
        : {
            header,
            register: (definitions) => {
              registered.current.add(definitions);
              registry.touch(commandSource);
              return () => {
                registered.current.delete(definitions);
                registry.touch(commandSource);
              };
            },
          },
    [commandSource, resource, header, registry],
  );
  useEffect(() => {
    if (!commandSource || !paneID || !resource) return;
    return registry.register(commandSource, {
      context: () => ({
        scope: 'preview',
        workspaceID: activeWorkspace().id,
        paneID,
        path: resource.entry.path,
        resourceID: resource.id,
        selection: [],
        // what this plane's file tools act on: the plane's own file, never borrowed elsewhere
        subject: resource.entry,
        jobs: getState().jobs,
        clipboard: getState().clipboard,
      }),
      definitions: () =>
        [...[...registered.current].flat(), ...hostCommands].map((command) => ({
          ...command,
          id: `preview.${command.id}`,
          group: 'Preview',
          icon: 'eye' as const,
          when: (context) =>
            ['window', 'preview'].includes(context.scope) && command.available !== false && active,
        })),
      valid: (invocation) =>
        !signal.aborted &&
        invocation.resourceID === resource.id &&
        activeWorkspace().panes.some(
          (pane) => pane.id === paneID && pane.path === resource.entry.path,
        ),
    });
  }, [commandSource, paneID, resource, registry, signal, active, hostCommands]);
  // stable, so a message's commands are not registered again on every render
  const message = supplied ? undefined : resource?.entry;
  const saveMessageAttachments = useMemo(
    () => (message ? (request: AttachmentSave) => saveAttachments(message, request) : undefined),
    [message],
  );
  const locate =
    !supplied && (paneID || workspace)
      ? async (target: FileEntry) => {
          // A dirty editor stays attached to its original draft. A located copy opens
          // separately; Save As remains the person's explicit choice.
          if (paneID && !editingPlane(paneID)?.dirty())
            updatePane(paneID, { path: target.path, evidence: undefined });
          else if (workspace) {
            await workspace.openPath(target.path, { paneID, linked: true, another: true });
            quickPreview(null);
          }
        }
      : undefined;
  if (error)
    return (
      <Empty icon="warning" title="File unavailable" detail={error}>
        {!supplied && path && (
          <PreviewRecovery
            path={path}
            retry={() => setRetry((value) => value + 1)}
            locate={locate}
          />
        )}
        {path && (
          <button onClick={() => void window.viewer.openExternal(path).catch(report)}>
            Open in default app
          </button>
        )}
        {path && needsFolderAccess(errorCode) && (
          <FolderAccessButton
            folder={path.replace(/[/\\][^/\\]+$/, '') || '/'}
            onGranted={() => setRetry((value) => value + 1)}
          />
        )}
      </Empty>
    );
  if (!resource) return <Loading label="Opening preview…" />;
  if (!activated)
    return (
      <Empty
        icon="eye"
        title="Preview paused"
        detail="Bring this plane into view to load its preview."
      />
    );
  const module = choosePreview(resource.entry);
  const invokeFile = (id: string) => () => {
    const owner = paneID || getState().quickPreview?.paneID || getState().activePane;
    const invocation = {
      paneID: owner,
      context: {
        scope: 'preview' as const,
        workspaceID: activeWorkspace().id,
        paneID: owner,
        path: resource.entry.path,
        selection: [resource.entry],
        jobs: getState().jobs,
        clipboard: getState().clipboard,
      },
    };
    quickPreview(null);
    void registry.invoke(id, invocation).catch(report);
  };
  const Viewer = componentFor(hexShown ? hexModule : module);
  const hex = offersHex ? { shown: hexShown, toggle: toggleHex } : undefined;
  return (
    <div className="preview-host" data-preview-module={module.id}>
      {path && sourceIssue?.path === path && (
        <PreviewRecovery
          path={path}
          entry={resource.entry}
          detail={sourceIssue.detail}
          retry={() => setRecheck((value) => value + 1)}
          locate={locate}
        />
      )}
      <div className="preview-body">
        <ErrorBoundary key={`${resource.id}:${hexShown}`}>
          <Suspense fallback={<Loading label={`Loading ${module.label.toLowerCase()}…`} />}>
            <Viewer
              key={resource.id}
              resource={resource}
              evidence={
                evidence && sameSourceVersion(sourceVersion(resource.entry), evidence.version)
                  ? evidence
                  : undefined
              }
              active={active}
              interactive={interactive}
              signal={signal}
              services={scopedServices}
              look={look}
              pages={pages}
              toolbar={toolbar}
              commands={commands}
              state={viewState}
              limits={limits}
              reading={{ fontSize }}
              openRelated={openRelated}
              editing={editing}
              optimize={!supplied ? invokeFile('optimize-files') : undefined}
              editPDF={!supplied ? invokeFile('pdf-tools') : undefined}
              editImage={!supplied ? invokeFile('image-tools') : undefined}
              editMedia={
                !supplied && workspace
                  ? () =>
                      void workspace
                        .openMedia(
                          [resource.entry.path],
                          paneID || getState().quickPreview?.paneID || getState().activePane,
                        )
                        .then(() => quickPreview(null))
                        .catch(report)
                  : undefined
              }
              retry={!supplied ? () => setRetry((value) => value + 1) : undefined}
              showHex={() => setHexFor(resource.id)}
              saveAttachments={saveMessageAttachments}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
      {renderFooter ? (
        renderFooter(resource, hexShown ? hexModule : module, hex)
      ) : (
        <footer className="preview-info">
          <div className="preview-file-info">
            <span className="preview-filename" title={resource.entry.path}>
              {(current ?? resource.entry).name}
            </span>
            <span className="preview-file-details">
              <span className="separator">·</span> {hexShown ? hexModule.label : module.label}{' '}
              <span className="separator">·</span> <PreviewSize entry={current ?? resource.entry} />
            </span>
          </div>
          {!supplied && (
            <IconButton
              icon="external"
              label="Open file in default app"
              onClick={() => {
                void window.viewer.openExternal(resource.entry.path).catch(report);
              }}
            />
          )}
        </footer>
      )}
    </div>
  );
});
