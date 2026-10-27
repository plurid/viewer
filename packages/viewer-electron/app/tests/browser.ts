/** Test-only bridge. This entry is never imported or included in production. */
import type { ApiMethod, DesktopEvent, ViewerAPI } from '../src/domain/contracts';
import { copyBrowserPaths } from './browser-clipboard';
const listeners = new Set<(event: DesktopEvent) => void>();
const events = new EventSource('/__test/events');
events.onmessage = (event) => {
  const value = JSON.parse(event.data) as DesktopEvent;
  for (const listener of listeners) listener(value);
};
async function invoke<T>(method: ApiMethod, ...args: unknown[]): Promise<T> {
  // JSON represents undefined array members as null; omit optional trailing arguments.
  while (args.length && args.at(-1) === undefined) args.pop();
  const response = await fetch('/__test/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args }),
  });
  const result = await response.json();
  if (!result.ok) throw Object.assign(new Error(result.error), { code: result.code });
  return result.value;
}
const api: ViewerAPI = {
  optimization: async () => {
    throw new Error('Optimization requires the desktop app.');
  },
  notes: (request) => invoke('notes', request),
  receipts: (request) => invoke('receipts', request),
  runCommand: async () => {
    throw new Error('Commands require the desktop app.');
  },
  commandDraft: async () => undefined,
  pdfInspect: async () => {
    throw new Error('PDF tools require the desktop app.');
  },
  choosePDFs: async () => {
    throw new Error('PDF tools require the desktop app.');
  },
  imageInspect: async () => {
    throw new Error('Image tools require the desktop app.');
  },
  media: async () => {
    throw new Error('Media tools require the desktop app.');
  },
  browser: async () => {
    throw new Error('Live browser planes require the desktop app.');
  },
  journalQuery: (query) => invoke('journalQuery', query),
  journalExportPreview: (query) => invoke('journalExportPreview', query),
  journalExport: (id) => invoke('journalExport', id),
  journalClear: () => invoke('journalClear'),
  htmlPreview: (resourceID) => invoke('htmlPreview', resourceID),
  htmlPreviewClose: (id) => invoke('htmlPreviewClose', id),
  localServerStart: (root, paneID, sourceIdentity) =>
    invoke('localServerStart', root, paneID, sourceIdentity),
  localServers: () => invoke('localServers'),
  localServerInspect: (id) => invoke('localServerInspect', id),
  localServerAction: async (id, action) => {
    if (action === 'copy-url' || action === 'open-browser') {
      const { server } = await api.localServerInspect(id);
      if (server.state !== 'running') throw new Error('Start the local server first.');
      if (action === 'copy-url') await navigator.clipboard.writeText(server.url);
      else window.open(server.url, '_blank', 'noopener,noreferrer');
    }
    return invoke('localServerAction', id, action);
  },
  chat: (request) => invoke('chat', request),
  shellCommand: (action) => invoke('shellCommand', action),
  hotkeyStatus: () => invoke('hotkeyStatus'),
  restoreWindow: () => invoke('restoreWindow'),
  workspaceClaim: (id) => invoke('workspaceClaim', id),
  newWindow: () => invoke('newWindow'),
  git: (request) => invoke('git', request),
  gitWorktrees: (request) => invoke('gitWorktrees', request),
  gitReview: (request) => invoke('gitReview', request),
  agentSessions: (request) => invoke('agentSessions', request),
  gitResource: (source) => invoke('gitResource', source),
  gitAction: (request) => invoke('gitAction', request),
  watchRules: (request) => invoke('watchRules', request),
  relationships: (request) => invoke('relationships', request),
  workflow: (request) => invoke('workflow', request),
  querySnapshot: (query) => invoke('querySnapshot', query),
  compare: (request) => invoke('compare', request),
  duplicates: (request) => invoke('duplicates', request),
  operationPlan: (request) => invoke('operationPlan', request),
  project: (request) => invoke('project', request),
  lens: (request) => invoke('lens', request),
  checkpoints: (request) => invoke('checkpoints', request),
  inspect: (file, content, ocr) => invoke('inspect', file, content, ocr),
  commandsPublish: (target, commands, workspaces, owners) =>
    invoke('commandsPublish', target, commands, workspaces, owners),
  agentCommandResult: (id, error) => invoke('agentCommandResult', id, error),
  agentReviewList: () => invoke('agentReviewList'),
  agentReview: (id, approve) => invoke('agentReview', id, approve),
  agentGrants: () => invoke('agentGrants'),
  agentClients: (request) => invoke('agentClients', request),
  agentAudit: (clientID) => invoke('agentAudit', clientID),
  agentStop: (clientID) => invoke('agentStop', clientID),
  agentGrant: (actionID, root, capability, allow, clientID) =>
    invoke('agentGrant', actionID, root, capability, allow, clientID),

  configOpen: () => invoke('configOpen'),
  configValidate: () => invoke('configValidate'),
  configTransfer: (kind) => invoke('configTransfer', kind),
  backup: (request) => invoke('backup', request),
  configRestore: () => invoke('configRestore'),
  providerPermissionAgents: (id, endpoint, allow) =>
    invoke('providerPermissionAgents', id, endpoint, allow),
  settingsCategory: (category) => invoke('settingsCategory', category),
  agentAccess: (request) => invoke('agentAccess', request),
  terminalApplication: () => invoke('terminalApplication'),
  terminalExternal: (cwd, tmux) => invoke('terminalExternal', cwd, tmux),
  terminalStart: (request) => invoke('terminalStart', request),
  terminalWrite: (id, data) => invoke('terminalWrite', id, data),
  terminalResize: (id, cols, rows) => invoke('terminalResize', id, cols, rows),
  terminalAck: (id, bytes) => invoke('terminalAck', id, bytes),
  terminalClose: (id) => invoke('terminalClose', id),
  customExecute: (actionID, target) => invoke('customExecute', actionID, target),
  executionList: () => invoke('executionList'),
  executionCancel: (id) => invoke('executionCancel', id),

  openSettings: (focus) => {
    window.open(
      location.pathname + '?window=settings' + (focus ? '&focus=' + encodeURIComponent(focus) : ''),
      'viewer-fixture-settings',
      'width=900,height=640',
    );
    return invoke('openSettings');
  },
  settingsGet: () => invoke('settingsGet'),
  settingsPatch: (patches, revision) => invoke('settingsPatch', patches, revision),
  promptLine: (request) => invoke('promptLine', request),
  promptCancel: (id) => invoke('promptCancel', id),
  sessionKeys: () => invoke('sessionKeys'),
  sessionKeysSet: (session) => invoke('sessionKeysSet', session),
  sessionKeysKeep: () => invoke('sessionKeysKeep'),
  sessionKeysDiscard: () => invoke('sessionKeysDiscard'),
  providerCredential: (id, key) => invoke('providerCredential', id, key),
  providerModels: (id) => invoke('providerModels', id),
  providerCheck: (request) => invoke('providerCheck', request),
  providerPermissionGet: (id) => invoke('providerPermissionGet', id),
  providerPermissionSet: (id, endpoint, level) =>
    invoke('providerPermissionSet', id, endpoint, level),
  indexStatus: () => invoke('indexStatus'),
  indexedQuery: (query) => invoke('indexedQuery', query),
  indexRebuild: () => invoke('indexRebuild'),
  actionStart: (request) => invoke('actionStart', request),
  actionGet: (id) => invoke('actionGet', id),
  actionList: () => invoke('actionList'),
  actionApply: (approval) => invoke('actionApply', approval),
  actionCancel: (id) => invoke('actionCancel', id),
  actionUndo: (id) => invoke('actionUndo', id),
  actionRecover: (id) => invoke('actionRecover', id),
  actionExportSummary: (id, destination) => invoke('actionExportSummary', id, destination),
  agentToken: () => invoke('agentToken'),
  contextPublish: (context) => invoke('contextPublish', context),
  thumbnail: (path, size) => invoke('thumbnail', path, size),
  appIcon: (path, size) => invoke('appIcon', path, size),
  diagnosticReport: (detail) => invoke('diagnosticReport', detail),
  document: (id, request) => (request ? invoke('document', id, request) : invoke('document', id)),
  cancelDocument: (id, requestID) => invoke('cancelDocument', id, requestID),
  bootstrap: () => invoke('bootstrap'),
  list: (path) => invoke('list', path),
  stat: (path) => invoke('stat', path),
  fileInformation: (path) => invoke('fileInformation', path),
  fileInformationUpdate: (path, revision, patch) =>
    invoke('fileInformationUpdate', path, revision, patch),
  chooseFolder: (defaultPath) => invoke('chooseFolder', defaultPath),
  reveal: (path) => invoke('reveal', path),
  openExternal: (path) => invoke('openExternal', path),
  connectServer: (address) => invoke('connectServer', address),
  taggedFiles: (tag, roots) => invoke('taggedFiles', tag, roots),
  nativeFilePanel: (kind, files) => invoke('nativeFilePanel', kind, files),
  applications: (paths) => invoke('applications', paths),
  applicationIcon: (id) => invoke('applicationIcon', id),
  windowButtons: (visible) => invoke('windowButtons', visible),
  chooseApplication: () => invoke('chooseApplication'),
  openWith: (paths, id) => invoke('openWith', paths, id),
  folderSizeStart: (paths) => invoke('folderSizeStart', paths),
  folderSizeGet: (id) => invoke('folderSizeGet', id),
  folderSizeCancel: (id) => invoke('folderSizeCancel', id),
  watch: (path, subscriber) => invoke('watch', path, subscriber),
  unwatch: (subscriber) => invoke('unwatch', subscriber),
  search: (request) => invoke('search', request),
  cancelSearch: (id) => invoke('cancelSearch', id),
  operate: (request) => invoke('operate', request),
  jobs: () => invoke('jobs'),
  cancelJob: (id) => invoke('cancelJob', id),
  resolveCollision: (id, decision, all) => invoke('resolveCollision', id, decision, all),
  undo: (id) => invoke('undo', id),
  redo: (id) => invoke('redo', id),
  resource: (path) => invoke('resource', path),
  read: (id, limit) => invoke('read', id, limit),
  release: (id) => invoke('release', id),
  archive: (id) => invoke('archive', id),
  archiveEntry: (id, name) => invoke('archiveEntry', id, name),
  imageRendition: (id, request) => invoke('imageRendition', id, request),
  videoRendition: (id, requestID) => invoke('videoRendition', id, requestID),
  officeLayout: (id, request) => invoke('officeLayout', id, request),
  officeImage: (id, part, requestID) => invoke('officeImage', id, part, requestID),
  printPDF: (id, password) => invoke('printPDF', id, password),
  save: (state) => invoke('save', state),
  flushed: (token, result) => invoke('flushed', token, result),
  clipboardWrite: (paths, cut) => invoke('clipboardWrite', paths, cut),
  copyPaths: (paths) =>
    copyBrowserPaths(paths, () => invoke('copyPaths', paths), navigator.clipboard),
  clipboardRead: () => invoke('clipboardRead'),
  fileDropPaths: async () => [],
  volumesList: () => invoke('volumesList'),
  trashList: (folderID) => invoke('trashList', folderID),
  trashConfirmation: () => Promise.reject(new Error('Empty Trash requires the desktop app.')),
  trashPreview: (itemID) => invoke('trashPreview', itemID),
  trashCopyPaths: async (itemIDs) => {
    const paths = await invoke<string[]>('trashCopyPaths', itemIDs);
    await copyBrowserPaths(paths, () => invoke('copyPaths', paths), navigator.clipboard);
  },
  trashRestore: () => Promise.reject(new Error('Restore requires the desktop app.')),
  trashAccess: () => Promise.reject(new Error('Trash permissions require the desktop app.')),
  volumeEject: (path) => invoke('volumeEject', path),
  fileAccessList: () => invoke('fileAccessList'),
  fileAccessRevoke: (path) => invoke('fileAccessRevoke', path),
  fileDragStart: async () => {
    throw new Error('Native file dragging is only available in the installed app.');
  },
  textEdit: (command) => {
    document.execCommand(command);
    return Promise.resolve();
  },
  textOpen: (resourceID) => invoke('textOpen', resourceID),
  textSave: (file, text, expected, session, bom) =>
    invoke('textSave', file, text, expected, session, bom),
  textSaveAs: (text, name, session) => invoke('textSaveAs', text, name, session),
  textEditEnd: (session) => invoke('textEditEnd', session),
  textPrompt: (kind, name) => invoke('textPrompt', kind, name),
  bufferList: () => invoke('bufferList'),
  bufferRead: (id) => invoke('bufferRead', id),
  bufferWrite: (buffer) => invoke('bufferWrite', buffer),
  bufferDiscard: (id) => invoke('bufferDiscard', id),
  onEvent: (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
window.viewer = api;
await import('../src/renderer');
