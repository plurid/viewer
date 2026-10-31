import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CheckPane as CheckPaneRecord } from '../../domain/contracts';
import { errorMessage } from '../../domain/errors';
import { Empty } from '../ui/primitives';
import { activeWorkspace } from '../state/store';
import { useWorkspace } from '../workspace/context';
import { activateCheck, checkSession, loadCheck, subscribeCheck } from './check';
import { CheckPanelBody } from './CheckPanel';

/** The saved check owns the work; mounting, culling and closing its view never start or cancel it. */
export default function CheckPlane({ pane, active }: { pane: CheckPaneRecord; active: boolean }) {
  const workspace = useWorkspace();
  const current = useSyncExternalStore(subscribeCheck, () => checkSession(pane.checkID));
  const available = !!current;
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let mounted = true;
    let generation = 0;
    const owner = activeWorkspace().id;
    setError('');
    const read = (refresh: boolean) => {
      const request = ++generation;
      const latest = () => mounted && generation === request;
      void loadCheck(pane.checkID, owner, workspace.parentPaneID(pane.id), pane.id, latest, refresh)
        .then(() => {
          if (latest()) setError('');
        })
        .catch((error: unknown) => {
          if (latest()) setError(errorMessage(error));
        });
    };
    const stop = window.viewer.onEvent((event) => {
      if (
        event.type === 'fabrication' &&
        event.progress.id === pane.checkID &&
        event.progress.step === 'settled'
      )
        read(true);
    });
    read(true);
    return () => {
      mounted = false;
      stop();
    };
  }, [pane.checkID, pane.id, retry, workspace]);
  useEffect(() => {
    if (active && available) activateCheck(pane.checkID);
  }, [active, available, pane.checkID]);
  if (error)
    return (
      <Empty title="The check could not be opened" detail={error}>
        <button type="button" onClick={() => setRetry((value) => value + 1)}>
          Try again
        </button>
      </Empty>
    );
  if (!current) return <Empty title="Opening check…" />;
  return (
    <div className="check-plane-content" data-viewer-check={pane.checkID}>
      <CheckPanelBody current={current} collapsed={false} embedded />
    </div>
  );
}
