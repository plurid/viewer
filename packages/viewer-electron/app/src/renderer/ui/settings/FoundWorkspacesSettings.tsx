import { useEffect, useState } from 'react';
import type { DefinitionCatalog } from '../../../domain/workspaces/definitions/schema';
import { errorMessage } from '../../../domain/errors';
import { Button } from '../primitives';

/**
 * Under Find workspaces from folders I use: how many workspaces Viewer found and how many were
 * marked Not a Workspace, with Show Hidden Again. Hidden roots stay while finding is off.
 */
export function FoundWorkspacesDetail() {
  const [catalog, setCatalog] = useState<DefinitionCatalog>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let live = true;
    const accept = (next: DefinitionCatalog) => {
      if (live)
        setCatalog((current) => (!current || next.revision >= current.revision ? next : current));
    };
    void window.viewer
      .workspaceDefinitionFile({ kind: 'catalog' })
      .then(accept)
      .catch(() => {});
    const stop = window.viewer.onEvent((event) => {
      if (event.type === 'workspace-definitions') accept(event.catalog);
    });
    return () => {
      live = false;
      stop();
    };
  }, []);
  const found = catalog?.found;
  if (!found) return null;
  const counts = [
    ...(found.state === 'ready' ? [`${found.count} found`] : []),
    ...(found.hidden ? [`${found.hidden} hidden`] : []),
  ];
  if (!counts.length && !message) return null;
  const showHidden = async () => {
    setBusy(true);
    setMessage('');
    try {
      setCatalog(await window.viewer.workspaceDefinitionFile({ kind: 'show-found' }));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-found-workspaces">
      <span role="status">{message || counts.join(' · ')}</span>
      {found.hidden > 0 && (
        <Button variant="secondary" disabled={busy} onClick={() => void showHidden()}>
          Show Hidden Again
        </Button>
      )}
    </div>
  );
}
