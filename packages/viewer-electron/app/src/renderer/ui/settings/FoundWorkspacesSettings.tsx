import { useEffect, useRef, useState } from 'react';
import type {
  DefinitionCatalog,
  WorkspaceDefinitionFileRequest,
} from '../../../domain/workspaces/definitions/schema';
import { errorMessage } from '../../../domain/errors';
import { plural } from '../../../domain/plural';
import { Button } from '../primitives';

const undoTime = 8000;
/** The finding switch this line sits under, which takes focus when the line has no button. */
const findingSwitch = '[data-setting-path="settings.browsing.findWorkspaces"] input';

/**
 * Under Suggest workspaces from folders you open: how many workspaces Viewer found and how many were
 * marked Not a Workspace, with a button that shows them all again and, for eight seconds, Undo.
 * Hidden roots stay while finding is off.
 */
export function FoundWorkspacesDetail() {
  const [catalog, setCatalog] = useState<DefinitionCatalog>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [shown, setShown] = useState(0);
  const row = useRef<HTMLDivElement>(null);
  // Undo and the button it brings back take each other's place, and Undo leaves after eight
  // seconds: focus they held moves on once the row has rendered, never to the page
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const element = row.current;
    (
      element?.querySelector('button') ??
      document.querySelector<HTMLElement>(findingSwitch) ??
      element
    )?.focus();
  });
  // a reply and a pass's event can cross: the newest catalog wins, so counts never step back
  const accept = (next: DefinitionCatalog) =>
    setCatalog((current) => (!current || next.revision >= current.revision ? next : current));
  useEffect(() => {
    let live = true;
    void window.viewer
      .workspaceDefinitionFile({ kind: 'catalog' })
      .then((next) => {
        if (live) accept(next);
      })
      .catch(() => {});
    const stop = window.viewer.onEvent((event) => {
      if (live && event.type === 'workspace-definitions') accept(event.catalog);
    });
    return () => {
      live = false;
      stop();
    };
  }, []);
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => {
      refocus.current = !!row.current?.contains(document.activeElement);
      setShown(0);
    }, undoTime);
    return () => clearTimeout(timer);
  }, [shown]);
  const run = async (request: WorkspaceDefinitionFileRequest, then: (changed: number) => void) => {
    setBusy(true);
    setMessage('');
    try {
      const next = await window.viewer.workspaceDefinitionFile(request);
      accept(next);
      then(next.changed ?? 0);
      refocus.current = true;
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const found = catalog?.found;
  if (!found) return null;
  const counts = [
    ...(found.state === 'ready' ? [`${found.count} found`] : []),
    ...(found.hidden ? [`${found.hidden} hidden`] : []),
    ...(shown ? [`${shown} shown again`] : []),
  ];
  if (!counts.length && !message) return null;
  return (
    <div ref={row} className="settings-found-workspaces" tabIndex={-1}>
      <span role="status">{message || counts.join(' · ')}</span>
      {shown > 0 ? (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void run({ kind: 'hide-found-again' }, (changed) => {
              setShown(0);
              if (!changed) setMessage('Those folders are hidden already.');
            })
          }
        >
          Undo
        </Button>
      ) : (
        found.hidden > 0 && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void run({ kind: 'show-found' }, setShown)}
          >
            Show {plural(found.hidden, 'Hidden Workspace')}
          </Button>
        )
      )}
    </div>
  );
}
