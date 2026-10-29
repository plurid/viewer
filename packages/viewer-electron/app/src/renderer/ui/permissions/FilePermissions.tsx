import { useEffect, useState } from 'react';
import type { ViewerAPI } from '../../../domain/contracts';
import { Icon } from '../Icon';
import { errorMessage } from '../../../domain/errors';
type Grant = Awaited<ReturnType<ViewerAPI['fileAccessList']>>[number];
export function FilePermissions({ error }: { error(message: string): void }) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(50);
  const load = async () => {
    setGrants(await window.viewer.fileAccessList());
  };
  useEffect(() => {
    let live = true;
    void window.viewer
      .fileAccessList()
      .then((grants) => {
        if (live) setGrants(grants);
      })
      .catch((value) => {
        if (live) error(errorMessage(value));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // Loads once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const choose = async (path?: string) => {
    setBusy(path || 'choose');
    try {
      await window.viewer.chooseFolder(path);
      await load();
    } catch (value) {
      error(errorMessage(value));
    } finally {
      setBusy('');
    }
  };
  return (
    <>
      <p className="settings-note">
        Choose folders the App Store edition can use. Saved permissions survive relaunch. Revoking
        stops dependent work and clears cached previews and indexed data; a separately allowed
        parent folder may still provide access. Clipboard and drag permissions last until Quit.
      </p>
      <div className="settings-actions">
        <button disabled={!!busy} onClick={() => void choose()}>
          Allow a folder…
        </button>
        <button
          disabled={!!busy || loading}
          onClick={() => void load().catch((value) => error(value.message))}
        >
          Refresh permissions
        </button>
      </div>
      {loading && (
        <p role="status" className="settings-note">
          Loading saved permissions…
        </p>
      )}
      {!loading && !grants.length && (
        <p className="settings-note">
          No folder permissions. Direct-download editions use your macOS file permissions.
        </p>
      )}
      <div className="file-permissions">
        {grants.slice(0, visible).map((grant) => (
          <div className="file-permission" key={grant.path}>
            <Icon name={grant.directory ? 'folder' : 'file'} />
            <div>
              <strong className="model-endpoint">{grant.path}</strong>
              <small className="muted">
                {grant.session && grant.status !== 'revoking'
                  ? 'Clipboard or drag permission · until Quit'
                  : grant.status === 'active'
                    ? 'In use'
                    : grant.status === 'revoking'
                      ? 'Access stopped; revoke needs saving'
                      : grant.status === 'unavailable'
                        ? 'Location unavailable; choose it again to repair access'
                        : 'Saved permission'}
              </small>
            </div>
            <div className="settings-actions">
              <button
                disabled={!!busy}
                onClick={() =>
                  void choose(
                    grant.directory ? grant.path : grant.path.slice(0, grant.path.lastIndexOf('/')),
                  )
                }
              >
                Choose again…
              </button>
              <button
                disabled={!!busy}
                onClick={async () => {
                  setBusy(grant.path);
                  try {
                    await window.viewer.fileAccessRevoke(grant.path);
                    await load();
                  } catch (value) {
                    error(errorMessage(value));
                    await load().catch(() => {});
                  } finally {
                    setBusy('');
                  }
                }}
              >
                {busy === grant.path ? 'Stopping work…' : 'Revoke'}
              </button>
            </div>
          </div>
        ))}
      </div>
      {visible < grants.length && (
        <div className="settings-actions">
          <button onClick={() => setVisible((count) => count + 50)}>
            Show more permissions ({grants.length - visible} remaining)
          </button>
        </div>
      )}
    </>
  );
}
