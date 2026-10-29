import { useState } from 'react';
import { report } from '../../state/store';
import { requestRefresh } from '../../state/refresh';

export { needsFolderAccess } from '../../../domain/files/access';

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
              requestRefresh();
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
