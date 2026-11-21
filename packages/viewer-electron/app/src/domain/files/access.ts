/** Native permission failures that can be recovered through a folder picker. */
export const needsFolderAccess = (code?: string) =>
  ['FILE_ACCESS_REQUIRED', 'EACCES', 'EPERM'].includes(code ?? '');

/** Operating-system permission refusals that may still require macOS Privacy & Security approval. */
export const isSystemPermissionRefusal = (code?: string) => code === 'EACCES' || code === 'EPERM';

export type PrivacySettingsPane = 'files' | 'all-files';

/** Which macOS Privacy & Security list governs a folder that stayed refused after choosing it. */
export function folderPrivacyPane(folder: string): PrivacySettingsPane {
  const normalized = folder.replace(/\/+$/, '');
  if (
    /(?:^|\/)(?:\.Trash|\.Trashes)(?:\/|$)/.test(normalized) ||
    /(?:^|\/)Library\/(?:Mail|Messages|Safari|Calendars|Contacts|Cookies|HomeKit|Application Support\/com\.apple\.TCC)(?:\/|$)/.test(
      normalized,
    ) ||
    normalized.startsWith('/private/var/db/')
  )
    return 'all-files';
  return 'files';
}

/** One-line reason shown beside Open Privacy Settings when macOS still refuses a chosen folder. */
export function privacySettingsReason(pane: PrivacySettingsPane): string {
  return pane === 'all-files'
    ? 'macOS still blocks this folder. Allow Viewer in System Settings → Privacy & Security → Full Disk Access, then reopen Viewer.'
    : 'macOS still blocks this folder. Turn Viewer on in System Settings → Privacy & Security → Files & Folders.';
}
