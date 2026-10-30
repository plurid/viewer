import { useCallback, useMemo, useState } from 'react';
import type { PreviewContext } from '../contracts';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import { useOfficeDocument } from '../useOfficeDocument';
import { useHtmlPreview } from '../web/useHtmlPreview';
import { Empty, Loading } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';
import './mail.css';

/** A Safari web archive: the saved page, with the subresources it holds, served without scripts.
 * Nothing loads from the network. */
export default function WebArchivePreview(context: PreviewContext) {
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const { document } = useOfficeDocument(context);
  const capability = useHtmlPreview(context, revision);
  const saved = document?.webArchive;
  usePreviewCommands(
    context,
    useMemo(
      () => [{ id: 'reload-web-archive', label: 'Reload saved page', run: reload }],
      [reload],
    ),
  );
  return (
    <div className="html-preview">
      <PreviewToolbar context={context}>
        <span className="saved-page-address" title={saved?.url}>
          {saved?.title || saved?.url || context.resource.entry.name}
          {saved?.title && saved.url && <span className="muted"> · {saved.url}</span>}
        </span>
        <button
          className="html-preview-reload"
          type="button"
          title="Reload the page from the archive"
          disabled={capability.status === 'loading' || capability.status === 'closed'}
          onClick={reload}
        >
          <Icon name="refresh" />
          Reload
        </button>
      </PreviewToolbar>
      {capability.status === 'ready' && !!capability.preview.blocked && (
        <p className="inline-warning" role="status">
          Content not saved in the archive is not loaded.
        </p>
      )}
      <div className="html-preview-panel">
        {capability.status === 'ready' ? (
          <iframe
            key={`${capability.preview.id}:${revision}`}
            className="html-preview-frame"
            title={`Saved page ${context.resource.entry.name}`}
            src={capability.preview.url}
            sandbox=""
            referrerPolicy="no-referrer"
            allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
            tabIndex={context.interactive ? 0 : -1}
            style={{ pointerEvents: context.interactive ? 'auto' : 'none' }}
          />
        ) : capability.status === 'loading' ? (
          <Loading label="Opening saved page…" />
        ) : (
          <Empty
            icon="code"
            title="The saved page could not be shown"
            detail={capability.status === 'error' ? capability.message : 'This preview is closed.'}
          />
        )}
      </div>
    </div>
  );
}
