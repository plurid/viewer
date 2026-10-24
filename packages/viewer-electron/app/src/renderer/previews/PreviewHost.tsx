import {
  memo,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { WorkspaceContext } from '../workspace/context';
import { effectiveWindowLook } from '../state/effective-ui';
import type { FileEntry, Resource } from '../../domain/contracts';
import { formatBytes } from '../../domain/files/entries';
import { Empty, ErrorBoundary, IconButton, Loading } from '../ui/primitives';
import { activeWorkspace, getState, report, useViewer } from '../state/store';
import { useCommands } from '../commands/context';
import { usePreviewControlsSlot } from './controls';
import type { PreviewContext, PreviewModule } from './contracts';
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

const components = new Map<string, ReturnType<typeof lazy<React.ComponentType<PreviewContext>>>>();
function componentFor(module: PreviewModule) {
  let component = components.get(module.id);
  if (!component) {
    component = lazy(module.load);
    components.set(module.id, component);
  }
  return component;
}
const services: PreviewContext['services'] = {
  htmlPreview: (id) => window.viewer.htmlPreview(id),
  htmlPreviewClose: (id) => window.viewer.htmlPreviewClose(id),
  thumbnail: (file, size) => window.viewer.thumbnail(file, size),
  document: (id) => window.viewer.document(id),
  read: (id, limit) => window.viewer.read(id, limit),
  archive: (id) => window.viewer.archive(id),
  archiveEntry: (id, name) => window.viewer.archiveEntry(id, name),
  rendition: (id) => window.viewer.imageRendition(id),
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
  renderFooter?(resource: Resource, module: PreviewModule): ReactNode;
}) {
  const [resource, setResource] = useState<Resource | null>(supplied ?? null);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [retry, setRetry] = useState(0);
  const [activated, setActivated] = useState(active);
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
  // A PREVIEW PLANE FOLLOWS ITS FILE (2026-10-23): saved in another app, it shows the new version.
  // Its folder is watched; a change there is the file's only when the file's version changed.
  const seen = useRef<SourceVersion | undefined>(undefined);
  // the file as it is now, for the footer: a save changes its size after the preview opened
  const [current, setCurrent] = useState<FileEntry | undefined>(undefined);
  useEffect(() => {
    seen.current = entry ? sourceVersion(entry) : undefined;
    setCurrent(undefined);
  }, [entry]);
  useEffect(() => {
    if (!paneID || !path || supplied) return;
    const folder = parentPath(path);
    const subscriber = `preview:${paneID}`;
    void window.viewer.watch(folder, subscriber).catch(() => {});
    let checking = false,
      again = false;
    const check = async (): Promise<void> => {
      const latest = await window.viewer.stat(path);
      const version = sourceVersion(latest);
      if (!seen.current || sameSourceVersion(version, seen.current)) return;
      seen.current = version;
      // a link's own entry is not its file's
      if (latest.kind === 'file') setCurrent(latest);
      // a text plane reads it again in place, and an edited one asks before losing edits
      const plane = editingPlane(paneID);
      if (plane?.changedOnDisk) plane.changedOnDisk();
      else setRetry((value) => value + 1);
    };
    const off = window.viewer.onEvent((event) => {
      if (event.type !== 'folder-changed' || event.path !== folder) return;
      if (checking) {
        again = true;
        return;
      }
      checking = true;
      const run = (): Promise<void> =>
        check()
          .catch(() => {
            // gone or unreadable: the preview keeps what it shows
          })
          .then(() => {
            if (!again) return;
            again = false;
            return run();
          });
      void run().finally(() => {
        checking = false;
      });
    });
    return () => {
      off();
      void window.viewer.unwatch(subscriber).catch(() => {});
    };
  }, [paneID, path, supplied]);
  const viewState = useMemo(
    () => previewState(paneID || path || supplied?.id || 'temporary', entry),
    [paneID, path, supplied?.id, entry],
  );
  const limits = useViewer((state) => state.settings.settings.previews);
  const editing = useMemo(
    () => (editable && paneID && !supplied ? { paneID } : undefined),
    [editable, paneID, supplied],
  );
  const look = useViewer(effectiveWindowLook);
  // One controller per resource effect run: a new `supplied` object re-runs that effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const abort = useMemo(() => new AbortController(), [path, supplied, retry]);
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
        abort.abort();
        setResource(null);
        if (supplied) {
          setError('This preview is no longer available.');
          setErrorCode('');
        } else setRetry((value) => value + 1);
      }),
    [path, supplied, resource?.id, abort],
  );
  const commands = useMemo<PreviewContext['commands']>(
    () =>
      !paneID || !resource
        ? undefined
        : {
            header,
            register: (definitions) =>
              registry.register(`preview:${paneID}`, {
                context: () => ({
                  scope: 'preview',
                  workspaceID: activeWorkspace().id,
                  paneID,
                  path: resource.entry.path,
                  resourceID: resource.id,
                  selection: [],
                  jobs: getState().jobs,
                  clipboard: getState().clipboard,
                }),
                definitions: () =>
                  definitions.map((command) => ({
                    ...command,
                    id: `preview.${command.id}`,
                    group: 'Preview',
                    icon: 'eye' as const,
                    when: (context) =>
                      ['window', 'preview'].includes(context.scope) &&
                      command.available !== false &&
                      active,
                  })),
                valid: (invocation) =>
                  !abort.signal.aborted &&
                  invocation.resourceID === resource.id &&
                  activeWorkspace().panes.some(
                    (pane) => pane.id === paneID && pane.path === resource.entry.path,
                  ),
              }),
          },
    [paneID, resource, header, registry, abort, active],
  );
  useEffect(() => {
    let owned: Resource | undefined;
    if (supplied) {
      setResource(supplied);
      return () => {
        abort.abort();
      };
    }
    setResource(null);
    setError('');
    setErrorCode('');
    if (path)
      void window.viewer
        .resource(path)
        .then((value) => {
          if (abort.signal.aborted) {
            void window.viewer.release(value.id);
            return;
          }
          owned = value;
          setResource(value);
        })
        .catch((error) => {
          if (!abort.signal.aborted) {
            setError(String(error.message || error));
            setErrorCode(error.code || '');
          }
        });
    return () => {
      abort.abort();
      if (owned) void window.viewer.release(owned.id);
    };
  }, [path, supplied, abort]);
  if (error)
    return (
      <Empty icon="warning" title="File unavailable" detail={error}>
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
  const Viewer = componentFor(module);
  return (
    <div className="preview-host" data-preview-module={module.id}>
      <div className="preview-body">
        <ErrorBoundary key={resource.id}>
          <Suspense fallback={<Loading label={`Loading ${module.label.toLowerCase()}…`} />}>
            <Viewer
              resource={resource}
              evidence={
                evidence && sameSourceVersion(sourceVersion(resource.entry), evidence.version)
                  ? evidence
                  : undefined
              }
              active={active}
              interactive={interactive}
              signal={abort.signal}
              services={services}
              look={look}
              commands={commands}
              state={viewState}
              limits={limits}
              openRelated={openRelated}
              editing={editing}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
      {renderFooter ? (
        renderFooter(resource, module)
      ) : (
        <footer className="preview-info">
          <div className="preview-file-info">
            <span className="preview-filename" title={resource.entry.path}>
              {(current ?? resource.entry).name}
            </span>
            <span className="preview-file-details">
              <span className="separator">·</span> {module.label}{' '}
              <span className="separator">·</span> {formatBytes((current ?? resource.entry).size)}
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
