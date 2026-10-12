import { useState } from 'react';
import { report } from '../state/store';

export const needsFolderAccess = (code?: string) =>
  ['FILE_ACCESS_REQUIRED', 'EACCES', 'EPERM'].includes(code ?? '');

export function FolderAccessButton({
  folder,
  onGranted,
}: {
  folder: string;
  onGranted?(folder: string): void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void window.viewer
          .chooseFolder(folder)
          .then((selected) => {
            if (selected) {
              window.dispatchEvent(new Event('viewer:refresh'));
              onGranted?.(selected);
            }
          })
          .catch(report)
          .finally(() => setBusy(false));
      }}
    >
      {busy ? 'Choosing folder…' : 'Allow folder access…'}
    </button>
  );
}
