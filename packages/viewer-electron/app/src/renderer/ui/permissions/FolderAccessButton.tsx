import { useEffect, useState } from 'react';
import {
  folderPrivacyPane,
  isSystemPermissionRefusal,
  privacySettingsReason,
} from '../../../domain/files/access';
import { getState, report } from '../../state/store';
import { requestRefresh } from '../../state/refresh';

export { needsFolderAccess } from '../../../domain/files/access';

const refusedAfterChoice = new Set<string>();

/** Clears remembered post-choice refusals between isolated tests. */
export function resetFolderAccessAttempts(): void {
  refusedAfterChoice.clear();
}

export function FolderAccessButton({
  folder,
  onGranted,
}: {
  folder: string;
  onGranted?(folder: string): void;
}) {
  const [busy, setBusy] = useState<'choose' | 'privacy' | null>(null);
  const [stillRefused, setStillRefused] = useState(() => refusedAfterChoice.has(folder));
  useEffect(() => {
    setStillRefused(refusedAfterChoice.has(folder));
  }, [folder]);
  const pane = folderPrivacyPane(folder);
  const onMac = (getState()?.bootstrap.platform ?? 'darwin') === 'darwin';
  const showPrivacy = stillRefused && onMac;

  const choose = async () => {
    setBusy('choose');
    try {
      const selected = await window.viewer.chooseFolder(folder, true);
      if (!selected) return;
      if (typeof window.viewer.list === 'function') {
        try {
          await window.viewer.list(selected);
        } catch (error) {
          if (isSystemPermissionRefusal((error as { code?: string }).code)) {
            refusedAfterChoice.add(folder);
            refusedAfterChoice.add(selected);
            setStillRefused(true);
            return;
          }
          throw error;
        }
      }
      refusedAfterChoice.delete(folder);
      refusedAfterChoice.delete(selected);
      setStillRefused(false);
      requestRefresh();
      onGranted?.(selected);
    } catch (error) {
      if (isSystemPermissionRefusal((error as { code?: string }).code)) {
        refusedAfterChoice.add(folder);
        setStillRefused(true);
        return;
      }
      report(error);
    } finally {
      setBusy(null);
    }
  };

  const openPrivacy = async () => {
    setBusy('privacy');
    try {
      await window.viewer.fileAccessPrivacySettings(pane);
    } catch (error) {
      report(error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <button type="button" disabled={busy !== null} onClick={() => void choose()}>
        {busy === 'choose' ? 'Choosing folder…' : 'Allow Folder Access…'}
      </button>
      {showPrivacy && (
        <button type="button" disabled={busy !== null} onClick={() => void openPrivacy()}>
          {busy === 'privacy' ? 'Opening Privacy Settings…' : 'Open Privacy Settings…'}
        </button>
      )}
      {showPrivacy && (
        <p className="folder-access-note" role="status">
          {privacySettingsReason(pane)}
        </p>
      )}
    </>
  );
}
