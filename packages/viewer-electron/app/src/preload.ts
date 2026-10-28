import { contextBridge, ipcRenderer, webUtils, sharedTexture } from 'electron';
import type { ApiMethod, ApiResult, DesktopEvent, ViewerAPI } from './domain/contracts';

const eventListeners = new Set<(event: DesktopEvent) => void>();
const publish = (_event: Electron.IpcRendererEvent, event: DesktopEvent) => {
  for (const listener of [...eventListeners]) {
    try {
      listener(event);
    } catch (error) {
      console.error('Viewer event listener failed', error);
    }
  }
};
async function invoke<T>(method: ApiMethod, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke('viewer:request', method, args)) as ApiResult<T>;
  // Electron drops custom Error properties when crossing contextBridge. A
  // plain rejection envelope preserves the code; the renderer restores Error.
  if (!result.ok) return Promise.reject({ message: result.error, code: result.code });
  return result.value;
}
const api: ViewerAPI = {
  speech: (request) => invoke('speech', request),
  optimization: (request) => invoke('optimization', request),
  notes: (request) => invoke('notes', request),
  receipts: (request) => invoke('receipts', request),
  pdfInspect: (file) => invoke('pdfInspect', file),
  choosePDFs: () => invoke('choosePDFs'),
  imageInspect: (file) => invoke('imageInspect', file),
  media: (request) => invoke('media', request),
  browser: (request) =>
    invoke(
      'browser',
      request.kind === 'open'
        ? {
            ...request,
            texture:
              request.texture !== false &&
              typeof sharedTexture?.setSharedTextureReceiver === 'function',
          }
        : request,
    ),
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
  localServerAction: (id, action) => invoke('localServerAction', id, action),
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
  project: (request) => invoke('project', request),
  lens: (request) => invoke('lens', request),
  checkpoints: (request) => invoke('checkpoints', request),
  inspect: (file, content, ocr) => invoke('inspect', file, content, ocr),
  terminalApplication: () => invoke('terminalApplication'),
  terminalExternal: (cwd, tmux) => invoke('terminalExternal', cwd, tmux),
  terminalStart: (request) => invoke('terminalStart', request),
  terminalWrite: (id, data) => invoke('terminalWrite', id, data),
  terminalResize: (id, cols, rows) => invoke('terminalResize', id, cols, rows),
  terminalAck: (id, bytes) => invoke('terminalAck', id, bytes),
  terminalClose: (id) => invoke('terminalClose', id),
  customExecute: (actionID, target, values) => invoke('customExecute', actionID, target, values),
  runCommand: (script, target) => invoke('runCommand', script, target),
  commandDraft: (request) => (request ? invoke('commandDraft', request) : invoke('commandDraft')),
  executionList: () => invoke('executionList'),
  executionCancel: (id) => invoke('executionCancel', id),
  openSettings: (focus) => (focus ? invoke('openSettings', focus) : invoke('openSettings')),
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
  list: (file) => invoke('list', file),
  stat: (file) => invoke('stat', file),
  fileInformation: (file) => invoke('fileInformation', file),
  fileInformationUpdate: (file, revision, patch) =>
    invoke('fileInformationUpdate', file, revision, patch),
  chooseFolder: (defaultPath) => invoke('chooseFolder', defaultPath),
  reveal: (file) => invoke('reveal', file),
  openExternal: (file) => invoke('openExternal', file),
  connectServer: (address) => invoke('connectServer', address),
  taggedFiles: (tag, roots) => invoke('taggedFiles', tag, roots),
  nativeFilePanel: (kind, files) => invoke('nativeFilePanel', kind, files),
  applications: (paths) => invoke('applications', paths),
  applicationIcon: (id) => invoke('applicationIcon', id),
  windowButtons: (visible) => invoke('windowButtons', visible),
  chooseApplication: () => invoke('chooseApplication'),
  openWith: (paths, applicationID) => invoke('openWith', paths, applicationID),
  folderSizeStart: (paths) => invoke('folderSizeStart', paths),
  folderSizeGet: (id) => invoke('folderSizeGet', id),
  folderSizeCancel: (id) => invoke('folderSizeCancel', id),
  watch: (file, subscriber) => invoke('watch', file, subscriber),
  unwatch: (subscriber) => invoke('unwatch', subscriber),
  search: (request) => invoke('search', request),
  cancelSearch: (id) => invoke('cancelSearch', id),
  operate: (request) => invoke('operate', request),
  jobs: () => invoke('jobs'),
  cancelJob: (id) => invoke('cancelJob', id),
  resolveCollision: (id, decision, all) => invoke('resolveCollision', id, decision, all),
  undo: (id) => invoke('undo', id),
  redo: (id) => invoke('redo', id),
  resource: (file, requestID) => invoke('resource', file, requestID),
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
  flushed: (token) => invoke('flushed', token),
  clipboardWrite: (files, cut) => invoke('clipboardWrite', files, cut),
  copyPaths: (files) => invoke('copyPaths', files),
  clipboardRead: () => invoke('clipboardRead'),
  fileDropPaths: (files) =>
    invoke('fileDropPaths', files.map((file) => webUtils.getPathForFile(file)).filter(Boolean)),
  fileDragStart: (paths) => invoke('fileDragStart', paths),
  volumesList: () => invoke('volumesList'),
  trashList: (folderID) => invoke('trashList', folderID),
  trashConfirmation: (revision) => invoke('trashConfirmation', revision),
  trashPreview: (itemID) => invoke('trashPreview', itemID),
  trashCopyPaths: (itemIDs) => invoke('trashCopyPaths', itemIDs),
  trashRestore: (itemIDs, destination) => invoke('trashRestore', itemIDs, destination),
  trashAccess: (locationID) => invoke('trashAccess', locationID),
  volumeEject: (path) => invoke('volumeEject', path),
  fileAccessList: () => invoke('fileAccessList'),
  fileAccessRevoke: (path) => invoke('fileAccessRevoke', path),
  textEdit: (command) => invoke('textEdit', command),
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
    if (!eventListeners.size) ipcRenderer.on('viewer:event', publish);
    const subscription = (event: DesktopEvent) => listener(event);
    eventListeners.add(subscription);
    return () => {
      eventListeners.delete(subscription);
      if (!eventListeners.size) ipcRenderer.removeListener('viewer:event', publish);
    };
  },
};
// Frames never cross contextBridge proxies. Transfer VideoFrames into the app's
// main world; its permanent receiver closes even frames for an unmounted plane.
sharedTexture?.setSharedTextureReceiver(async ({ importedSharedTexture }, id: string) => {
  const frame = importedSharedTexture.getVideoFrame();
  importedSharedTexture.release();
  try {
    window.postMessage({ type: 'viewer-browser-frame', id, frame }, '*', [frame]);
  } catch {
    frame.close();
  }
});
ipcRenderer.on(
  'viewer:browser-bitmap',
  (_event, value: { id: string; width: number; height: number; pixels: Uint8Array }) => {
    const pixels = new Uint8Array(value.pixels);
    window.postMessage(
      {
        type: 'viewer-browser-frame',
        id: value.id,
        width: value.width,
        height: value.height,
        pixels,
      },
      '*',
      [pixels.buffer],
    );
  },
);
contextBridge.exposeInMainWorld('viewerNative', Object.freeze(api));
