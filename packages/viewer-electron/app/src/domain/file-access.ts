/** Native permission failures that can be recovered through a folder picker. */
export const needsFolderAccess = (code?: string) =>
  ['FILE_ACCESS_REQUIRED', 'EACCES', 'EPERM'].includes(code ?? '');
