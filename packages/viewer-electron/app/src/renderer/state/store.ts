// The public store API; the implementation lives in the neighbouring state modules.
export {
  activeWorkspace,
  changeWorkspace,
  dismissNotice,
  announce,
  getState,
  report,
  useViewer,
} from './core';
export {
  changePreferences,
  receiveSettings,
  rememberCommand,
  rememberLine,
  setLook,
} from './preferences';
export { flushState, previewValues, savePreviewValue, storageAdapter } from './persistence';
export {
  addPane,
  addRootFolder,
  addScratchPane,
  addSearchPane,
  addTerminalPane,
  desktopFolder,
  folderPane,
  historyNavigate,
  navigate,
  reconcilePanes,
  removePanes,
  replacePane,
  setActivePane,
  updatePane,
} from './panes';
export {
  deleteWorkspace,
  initialize,
  newWorkspace,
  renameWorkspace,
  restoreWorkspace,
  switchWorkspace,
} from './workspaces';
export {
  needsOperations,
  receiveJob,
  receiveProgress,
  setJobs,
  setOperationsOpen,
  settledJob,
} from './jobs';
export { quickPreview, refreshClipboard, stepQuickPreview, writeFileClipboard } from './ui';
export { addFavorite, favorite, remember, removeFavorite, renameShortcut } from './places';
export {
  addCollectionPane,
  addToBasket,
  basketEntries,
  removeFromBasket,
  saveCollection,
} from './collections';
export {
  associateProject,
  closeProject,
  consumeProjectLayout,
  installProject,
  projectFolderReferences,
} from './projects';
export { receiveFileChanges } from './file-changes';
export {
  applyFolderAsDefaults,
  folderPresentation,
  updateFolderPresentation,
  useFolderPresentation,
} from './presentation';
