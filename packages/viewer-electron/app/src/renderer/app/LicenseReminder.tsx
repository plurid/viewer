import { useEffect } from 'react';
import { getState, report, useViewer } from '../state/store';
import { update } from '../state/core';

export function LicenseReminder() {
  const status = useViewer((state) => state.bootstrap.license);
  useEffect(() => {
    let live = true;
    let received = false;
    const accept = (license: typeof status) => {
      const state = getState();
      update({ ...state, bootstrap: { ...state.bootstrap, license } });
    };
    const stop = window.viewer.onEvent((event) => {
      if (event.type === 'license') {
        received = true;
        accept(event.status);
      }
    });
    // A Settings window may have changed the key before this workspace subscribed.
    void window.viewer
      .license({ kind: 'status' })
      .then((value) => {
        if (live && !received) accept(value);
      })
      .catch((error) => {
        if (live) report(error);
      });
    return () => {
      live = false;
      stop();
    };
  }, []);
  if (status?.kind !== 'trial-ended' || status.reminderHidden) return null;
  return (
    <div className="bar project-file-notice" role="status">
      <span>Your Viewer trial has ended. All features remain available.</span>
      <button onClick={() => void window.viewer.license({ kind: 'buy' }).catch(report)}>
        Buy Viewer
      </button>
      <button onClick={() => void window.viewer.openSettings('license').catch(report)}>
        Enter license…
      </button>
      <button
        onClick={() => {
          void window.viewer.license({ kind: 'status', hideReminder: true }).catch(report);
        }}
      >
        Hide
      </button>
    </div>
  );
}
