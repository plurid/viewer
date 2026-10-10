import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { Resource } from '../../domain/contracts';
import { formatBytes } from '../../domain/files';
import { Empty, ErrorBoundary, IconButton, Loading } from '../ui/primitives';
import { report, useViewer } from '../state/store';
import type { PreviewContext, PreviewModule } from './contracts';
import { choosePreview } from './registry';

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
  read: (id, limit) => window.viewer.read(id, limit),
  archive: (id) => window.viewer.archive(id),
  archiveEntry: (id, name) => window.viewer.archiveEntry(id, name),
  release: (id) => window.viewer.release(id),
};
export function PreviewHost({
  path,
  active = true,
  interactive = true,
  resource: supplied,
}: {
  path?: string;
  active?: boolean;
  interactive?: boolean;
  resource?: Resource;
}) {
  const [resource, setResource] = useState<Resource | null>(supplied ?? null);
  const [error, setError] = useState('');
  const [activated, setActivated] = useState(active);
  useEffect(() => {
    if (active) setActivated(true);
  }, [active]);
  const look = useViewer((state) => state.saved.look);
  const abort = useMemo(() => new AbortController(), [path, supplied?.id]);
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
          if (!abort.signal.aborted) setError(String(error.message || error));
        });
    return () => {
      abort.abort();
      if (owned) void window.viewer.release(owned.id);
    };
  }, [path, supplied, abort]);
  if (error) return <Empty icon="warning" title="File unavailable" detail={error} />;
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
              active={active}
              interactive={interactive}
              signal={abort.signal}
              services={services}
              look={look}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
      <footer className="preview-info">
        <span title={resource.entry.path}>{resource.entry.name}</span>
        <span>
          {module.label} <span className="separator">·</span> {formatBytes(resource.entry.size)}
        </span>
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
    </div>
  );
}
