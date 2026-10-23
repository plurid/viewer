/** Argument schemas for every IPC method. The bridge validates each call against these
 * before it reaches a handler, and `ApiCall` carries the inferred argument types. */
import { z } from 'zod';
import type { ApiMethod, DesktopEvent } from '../domain/contracts';
import { modelDataLevels } from '../domain/model-permissions';
import { operationPlanRequestSchema } from '../domain/operation-plan';
import { sourceVersionSchema } from '../domain/inspection';
import { agentCapabilities, agentClientInputSchema } from '../domain/agent-clients';
import { watchRuleRequestSchema } from '../domain/watch-rules';
import { workflowDefinitionSchema } from '../domain/workflows';
import { projectDefinitionSchema } from '../domain/project';
import { lensGroupIDSchema, lensOpSchema } from '../domain/lenses';
import { stateSchema } from './storage';
import { informationPatchSchema } from './file-information';
import { localPath, id } from './schemas';
import { textBufferSchema } from './text-buffers';
import { MAX_TEXT_BYTES, textVersionSchema } from '../domain/text-documents';

/** Text an editor saves: at most what Viewer reads, counted in bytes. */
const editedText = z.string().refine((text) => Buffer.byteLength(text, 'utf8') <= MAX_TEXT_BYTES, {
  message: 'Viewer saves text up to 4 MiB.',
});

const indexedQuerySchema = z
  .object({
    query: z.string().max(300),
    root: localPath.optional(),
    offset: z.number().int().min(0).max(1000000).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    showHidden: z.boolean().optional(),
    content: z.boolean().optional(),
    recursive: z.boolean().optional(),
  })
  .strict();
const workspaceSnapshotSchema = z.object({
  activeWorkspace: id,
  workspaces: z
    .array(
      z.object({
        id,
        name: z.string().min(1).max(100),
        roots: z.array(id).max(200),
        panes: z
          .array(
            z.object({
              id,
              type: z.enum(['folder', 'preview', 'search', 'terminal', 'collection', 'scratch']),
              path: localPath,
              mode: z.enum(['list', 'grid', 'columns', 'gallery', 'map']).optional(),
              allLocations: z.boolean().optional(),
            }),
          )
          .max(200),
      }),
    )
    .min(1)
    .max(30),
});
const contextSchema = z.object({
  workspaceID: id,
  rootID: id,
  paneID: id,
  sources: z.array(localPath).max(2000),
  actor: z.enum(['user', 'agent']),
  recursive: z.boolean().optional(),
});
const targetSchema = z.object({
  workspaceID: id,
  rootID: id,
  paneID: id,
  directory: localPath,
  panePath: localPath.optional(),
  selection: z
    .array(
      z.object({
        path: localPath,
        name: z.string().max(32768),
        parent: localPath,
        extension: z.string().max(100),
        kind: z.enum(['directory', 'file', 'symlink', 'other']),
        directory: z.boolean(),
        size: z.number(),
        modified: z.number(),
        created: z.number(),
        hidden: z.boolean(),
        mime: z.string().max(100),
        identity: z.string().max(300),
        linkTarget: z.string().optional(),
        error: z.string().optional(),
      }),
    )
    .max(2000),
});
export const schemas = {
  watchRules: z.tuple([watchRuleRequestSchema]),
  relationships: z.tuple([
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('read'), file: localPath, content: z.boolean() }).strict(),
      z
        .object({
          kind: z.literal('note'),
          from: localPath,
          to: localPath,
          note: z.string().trim().min(1).max(4000),
        })
        .strict(),
      z.object({ kind: z.literal('remove-note'), id: z.uuid() }).strict(),
    ]),
  ]),
  workflow: z.tuple([
    z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('choose'),
          mode: z.enum(['open', 'create']),
          defaultPath: localPath.optional(),
        })
        .strict(),
      z.object({ kind: z.literal('read'), file: localPath }).strict(),
      z
        .object({
          kind: z.literal('save'),
          file: localPath,
          revision: z.string().max(100),
          definition: workflowDefinitionSchema,
        })
        .strict(),
      z.object({ kind: z.literal('list') }).strict(),
      z.object({ kind: z.literal('get'), id: z.uuid() }).strict(),
      z
        .object({
          kind: z.literal('start'),
          file: localPath,
          revision: z.string().max(100),
          bindings: z.record(z.string().max(100), localPath),
          context: contextSchema,
        })
        .strict(),
      z.object({ kind: z.literal('resume'), id: z.uuid() }).strict(),
      z.object({ kind: z.literal('cancel'), id: z.uuid() }).strict(),
      z.object({ kind: z.literal('remove'), id: z.uuid() }).strict(),
    ]),
  ]),
  querySnapshot: z.tuple([indexedQuerySchema]),
  compare: z.tuple([
    z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('run'),
          id: z.uuid(),
          left: localPath,
          right: localPath,
          hashes: z.boolean(),
        })
        .strict(),
      z.object({ kind: z.literal('cancel'), id: z.uuid() }).strict(),
    ]),
  ]),
  duplicates: z.tuple([
    z.discriminatedUnion('kind', [
      z
        .object({ kind: z.literal('run'), id: z.uuid(), roots: z.array(localPath).min(1).max(20) })
        .strict(),
      z.object({ kind: z.literal('cancel'), id: z.uuid() }).strict(),
    ]),
  ]),
  operationPlan: z.tuple([operationPlanRequestSchema]),
  checkpoints: z.tuple([
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('list') }).strict(),
      z
        .object({ kind: z.literal('estimate'), paths: z.array(localPath).min(1).max(2000) })
        .strict(),
      z.object({ kind: z.literal('remove'), id: z.uuid() }).strict(),
      z.object({ kind: z.literal('restore'), id: z.uuid(), destination: localPath }).strict(),
    ]),
  ]),
  inspect: z.tuple([localPath, z.boolean().optional(), z.boolean().optional()]),
  lens: z.tuple([
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('list'), folder: localPath }).strict(),
      z
        .object({
          kind: z.literal('create'),
          folder: localPath,
          name: z.string().trim().min(1).max(100),
          ops: z.array(lensOpSchema).max(5000).optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal('apply'),
          folder: localPath,
          file: localPath,
          ops: z.array(lensOpSchema).max(5000),
        })
        .strict(),
      z.object({ kind: z.literal('trash'), folder: localPath, file: localPath }).strict(),
      z.object({ kind: z.literal('share'), folder: localPath, file: localPath }).strict(),
      z
        .object({
          kind: z.literal('collapse'),
          lens: z.uuid(),
          groups: z.array(lensGroupIDSchema).max(1000),
        })
        .strict(),
    ]),
  ]),
  project: z.tuple([
    z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('choose'),
          mode: z.enum(['open', 'create']),
          defaultPath: localPath.optional(),
        })
        .strict(),
      z.object({ kind: z.literal('read'), file: localPath }).strict(),
      z
        .object({
          kind: z.literal('save'),
          file: localPath,
          revision: z.string().max(200),
          definition: projectDefinitionSchema,
        })
        .strict(),
    ]),
  ]),
  commandsPublish: z.tuple([
    targetSchema,
    z
      .array(
        z.object({
          id,
          label: z.string().max(500),
          group: z.string().max(100),
          aliases: z.array(z.string().max(200)).max(100),
          shortcut: z.string().max(80).optional(),
        }),
      )
      .max(1000),
    workspaceSnapshotSchema.optional(),
  ]),
  agentCommandResult: z.tuple([id, z.string().max(2000).optional()]),
  agentReviewList: z.tuple([]),
  agentReview: z.tuple([id, z.boolean()]),
  agentGrants: z.tuple([]),
  agentClients: z.tuple([
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('list') }).strict(),
      z.object({ kind: z.literal('create'), client: agentClientInputSchema }).strict(),
      z
        .object({
          kind: z.literal('update'),
          id: z.uuid(),
          revision: z.number().int().positive(),
          client: agentClientInputSchema,
        })
        .strict(),
      z
        .object({ kind: z.literal('revoke'), id: z.uuid(), revision: z.number().int().positive() })
        .strict(),
    ]),
  ]),
  agentAudit: z.tuple([id.optional()]),
  agentStop: z.tuple([id]),
  agentGrant: z.tuple([
    id,
    localPath,
    z.enum(['execute', 'terminal-read', 'terminal-write']),
    z.boolean(),
    id.optional(),
  ]),
  configOpen: z.tuple([]),
  configValidate: z.tuple([]),
  configTransfer: z.tuple([z.enum(['import', 'export'])]),
  configRestore: z.tuple([]),
  settingsCategory: z.tuple([z.string().max(40)]),
  agentAccess: z.tuple([
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('state') }).strict(),
      z.object({ kind: z.literal('enable'), enabled: z.boolean() }).strict(),
      z.object({ kind: z.literal('add-folder') }).strict(),
      z.object({ kind: z.literal('allow'), roots: z.array(localPath).max(100) }).strict(),
      z.object({ kind: z.literal('remove-folder'), root: localPath }).strict(),
      z
        .object({
          kind: z.literal('capabilities'),
          capabilities: z.array(z.enum(agentCapabilities)).max(agentCapabilities.length),
        })
        .strict(),
    ]),
  ]),
  terminalApplication: z.tuple([]),
  terminalExternal: z.tuple([localPath, z.boolean()]),
  terminalStart: z.tuple([
    z.object({
      id,
      workspaceID: id,
      rootID: id,
      cwd: localPath,
      profileID: id,
      cols: z.number().int().min(2).max(1000),
      rows: z.number().int().min(1).max(500),
    }),
  ]),
  terminalWrite: z.tuple([id, z.string().max(65536)]),
  terminalResize: z.tuple([
    id,
    z.number().int().min(2).max(1000),
    z.number().int().min(1).max(500),
  ]),
  terminalAck: z.tuple([
    id,
    z
      .number()
      .int()
      .min(0)
      .max(2 * 1024 * 1024),
  ]),
  terminalClose: z.tuple([id]),
  customExecute: z.tuple([
    id,
    z.object({
      workspaceID: id,
      rootID: id,
      paneID: id,
      directory: localPath,
      selection: z
        .array(
          z.object({
            path: localPath,
            name: z.string().max(1024),
            parent: localPath,
            extension: z.string().max(255),
            kind: z.enum(['directory', 'file', 'symlink', 'other']),
            directory: z.boolean(),
            size: z.number(),
            modified: z.number(),
            created: z.number(),
            hidden: z.boolean(),
            mime: z.string().max(255),
            identity: z.string().max(200),
            linkTarget: z.string().max(32768).optional(),
            error: z.string().max(4000).optional(),
          }),
        )
        .max(2000),
    }),
  ]),
  executionList: z.tuple([]),
  executionCancel: z.tuple([id]),
  openSettings: z.tuple([]),
  settingsGet: z.tuple([]),
  settingsPatch: z.tuple([
    z
      .array(
        z.object({
          path: z.string().max(200),
          value: z.unknown(),
          keys: z.array(z.string().max(32768)).max(10).optional(),
        }),
      )
      .max(100),
    z.number().int().min(0),
  ]),
  providerCredential: z.tuple([id, z.string().max(10000)]),
  providerModels: z.tuple([id]),
  providerPermissionGet: z.tuple([id]),
  providerPermissionSet: z.tuple([id, z.url().max(4000), z.enum(modelDataLevels).nullable()]),
  providerPermissionAgents: z.tuple([id, z.url().max(4000), z.boolean()]),
  indexStatus: z.tuple([]),
  indexedQuery: z.tuple([indexedQuerySchema]),
  indexRebuild: z.tuple([]),
  actionStart: z.tuple([
    z.object({
      recipeID: id,
      context: contextSchema,
      instructions: z.string().max(12000).optional(),
      options: z
        .object({
          template: z.string().max(1000).optional(),
          prefix: z.string().max(1000).optional(),
          suffix: z.string().max(1000).optional(),
          find: z.string().max(1000).optional(),
          replace: z.string().max(1000).optional(),
          start: z.number().int().min(0).optional(),
          padding: z.number().int().min(0).max(12).optional(),
          case: z.enum(['keep', 'lower', 'upper', 'title']).optional(),
          regex: z.boolean().optional(),
          ignoreCase: z.boolean().optional(),
          metadata: z.boolean().optional(),
        })
        .optional(),
    }),
  ]),
  actionGet: z.tuple([id]),
  actionList: z.tuple([]),
  actionCancel: z.tuple([id]),
  actionUndo: z.tuple([id]),
  actionRecover: z.tuple([id]),
  actionApply: z.tuple([
    z.object({
      id,
      revision: z.number().int().min(0),
      checkpoint: z.boolean().optional(),
      rows: z.array(z.object({ id, destination: localPath, approved: z.boolean() })).max(4000),
    }),
  ]),
  actionExportSummary: z.tuple([id, localPath]),
  agentToken: z.tuple([]),
  contextPublish: z.tuple([contextSchema]),
  thumbnail: z.tuple([localPath, z.number().int().min(128).max(512)]),
  appIcon: z.tuple([localPath, z.enum(['small', 'large'])]),
  diagnosticReport: z.tuple([z.string().max(8000)]),
  document: z.tuple([id]),
  bootstrap: z.tuple([]),
  list: z.tuple([localPath]),
  stat: z.tuple([localPath]),
  fileInformation: z.tuple([localPath]),
  fileInformationUpdate: z.tuple([localPath, z.string().min(1).max(200), informationPatchSchema]),
  chooseFolder: z.tuple([localPath.optional()]),
  reveal: z.tuple([localPath]),
  openExternal: z.tuple([localPath]),
  connectServer: z.tuple([z.string().min(3).max(2048)]),
  taggedFiles: z.tuple([z.string().trim().min(1).max(255), z.array(localPath).min(1).max(100)]),
  nativeFilePanel: z.tuple([z.enum(['preview', 'share']), z.array(localPath).min(1).max(100)]),
  applications: z.tuple([z.array(localPath).min(1).max(2000)]),
  applicationIcon: z.tuple([id]),
  chooseApplication: z.tuple([]),
  openWith: z.tuple([z.array(localPath).min(1).max(2000), id]),
  folderSizeStart: z.tuple([z.array(localPath).min(1).max(10000)]),
  folderSizeGet: z.tuple([id]),
  folderSizeCancel: z.tuple([id]),
  watch: z.tuple([localPath, id]),
  unwatch: z.tuple([id]),
  search: z.tuple([
    z.object({ id, root: localPath, query: z.string().min(1).max(300), showHidden: z.boolean() }),
  ]),
  cancelSearch: z.tuple([id]),
  operate: z.tuple([
    z.object({
      kind: z.enum([
        'copy',
        'move',
        'transfer',
        'duplicate',
        'alias',
        'rename',
        'mkdir',
        'mkfile',
        'trash',
        'compress',
        'extract',
        'convert',
      ]),
      sources: z.array(localPath).max(10000),
      destination: localPath.optional(),
      name: z.string().max(255).optional(),
      conversion: z.enum(['rotate-left', 'rotate-right', 'jpeg', 'png', 'pdf']).optional(),
      expectedSources: z
        .array(z.object({ path: localPath, version: sourceVersionSchema }).strict())
        .max(10000)
        .optional(),
    }),
  ]),
  jobs: z.tuple([]),
  cancelJob: z.tuple([id]),
  resolveCollision: z.tuple([id, z.enum(['skip', 'keep-both', 'replace', 'cancel']), z.boolean()]),
  undo: z.tuple([id]),
  redo: z.tuple([id]),
  resource: z.tuple([localPath]),
  read: z.tuple([id, z.number().int().positive().optional()]),
  release: z.tuple([id]),
  archive: z.tuple([id]),
  archiveEntry: z.tuple([id, z.string().max(65536)]),
  imageRendition: z.tuple([id]),
  printPDF: z.tuple([id, z.string().min(1).max(1024).optional()]),
  save: z.tuple([stateSchema]),
  flushed: z.tuple([id]),
  clipboardWrite: z.tuple([z.array(localPath).max(10000), z.boolean()]),
  copyPaths: z.tuple([z.array(localPath).min(1).max(10000)]),
  clipboardRead: z.tuple([]),
  fileDropPaths: z.tuple([z.array(localPath).max(10000)]),
  fileDragStart: z.tuple([z.array(localPath).min(1).max(10000)]),
  volumesList: z.tuple([]),
  trashList: z.tuple([
    z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  ]),
  trashConfirmation: z.tuple([z.string().regex(/^[a-f0-9]{64}$/)]),
  trashPreview: z.tuple([z.string().regex(/^[a-f0-9]{64}$/)]),
  trashCopyPaths: z.tuple([
    z
      .array(z.string().regex(/^[a-f0-9]{64}$/))
      .min(1)
      .max(1000),
  ]),
  trashRestore: z.tuple([
    z
      .array(z.string().regex(/^[a-f0-9]{64}$/))
      .min(1)
      .max(1000),
    z.enum(['original', 'choose']),
  ]),
  trashAccess: z.tuple([z.string().regex(/^[a-f0-9]{64}$/)]),
  volumeEject: z.tuple([localPath]),
  fileAccessList: z.tuple([]),
  fileAccessRevoke: z.tuple([localPath]),
  textEdit: z.tuple([z.enum(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])]),
  textOpen: z.tuple([id]),
  textSave: z.tuple([localPath, editedText, textVersionSchema, id, z.boolean()]),
  textSaveAs: z.tuple([editedText, z.string().min(1).max(255), id]),
  textEditEnd: z.tuple([id]),
  textPrompt: z.tuple([z.enum(['close', 'revert']), z.string().min(1).max(255)]),
  bufferList: z.tuple([]),
  bufferRead: z.tuple([z.uuid()]),
  bufferWrite: z.tuple([textBufferSchema]),
  bufferDiscard: z.tuple([z.uuid()]),
} satisfies Record<ApiMethod, z.ZodType>;
/**
 * The events Settings receives, for what it shows: settings, search status, service errors and
 * each provider's model data permission. The workspace window receives every event.
 */
export const settingsEvents: readonly DesktopEvent['type'][] = [
  'settings',
  'index',
  'service-error',
  'model-permission',
];
/**
 * Which window may call each method. Credentials, agent clients and folder revocation belong
 * to Settings; the workspace window's file and workspace methods are unavailable there.
 */
export const methodWindows = {
  watchRules: 'viewer',
  relationships: 'viewer',
  workflow: 'viewer',
  querySnapshot: 'viewer',
  compare: 'viewer',
  duplicates: 'viewer',
  operationPlan: 'viewer',
  checkpoints: 'viewer',
  inspect: 'viewer',
  project: 'viewer',
  lens: 'viewer',
  commandsPublish: 'viewer',
  agentCommandResult: 'viewer',
  agentReviewList: 'viewer',
  agentReview: 'viewer',
  agentGrants: 'both',
  agentClients: 'settings',
  agentAudit: 'settings',
  agentStop: 'settings',
  agentGrant: 'settings',
  configOpen: 'both',
  configValidate: 'both',
  configTransfer: 'settings',
  configRestore: 'settings',
  settingsCategory: 'settings',
  agentAccess: 'settings',
  terminalApplication: 'both',
  terminalExternal: 'viewer',
  terminalStart: 'viewer',
  terminalWrite: 'viewer',
  terminalResize: 'viewer',
  terminalAck: 'viewer',
  terminalClose: 'viewer',
  customExecute: 'viewer',
  executionList: 'viewer',
  executionCancel: 'viewer',
  openSettings: 'viewer',
  settingsGet: 'both',
  settingsPatch: 'both',
  providerCredential: 'settings',
  providerModels: 'both',
  providerPermissionGet: 'both',
  providerPermissionSet: 'both',
  providerPermissionAgents: 'settings',
  indexStatus: 'both',
  indexedQuery: 'viewer',
  indexRebuild: 'both',
  actionStart: 'viewer',
  actionGet: 'viewer',
  actionList: 'viewer',
  actionCancel: 'viewer',
  actionUndo: 'viewer',
  actionRecover: 'viewer',
  actionApply: 'viewer',
  actionExportSummary: 'viewer',
  agentToken: 'settings',
  contextPublish: 'viewer',
  thumbnail: 'viewer',
  appIcon: 'viewer',
  diagnosticReport: 'both',
  document: 'viewer',
  bootstrap: 'viewer',
  list: 'viewer',
  stat: 'viewer',
  fileInformation: 'viewer',
  fileInformationUpdate: 'viewer',
  chooseFolder: 'both',
  reveal: 'viewer',
  openExternal: 'viewer',
  connectServer: 'viewer',
  taggedFiles: 'viewer',
  nativeFilePanel: 'viewer',
  applications: 'viewer',
  applicationIcon: 'viewer',
  chooseApplication: 'viewer',
  openWith: 'viewer',
  folderSizeStart: 'viewer',
  folderSizeGet: 'viewer',
  folderSizeCancel: 'viewer',
  watch: 'viewer',
  unwatch: 'viewer',
  search: 'viewer',
  cancelSearch: 'viewer',
  operate: 'viewer',
  jobs: 'viewer',
  cancelJob: 'viewer',
  resolveCollision: 'viewer',
  undo: 'viewer',
  redo: 'viewer',
  resource: 'viewer',
  read: 'viewer',
  release: 'viewer',
  archive: 'viewer',
  archiveEntry: 'viewer',
  imageRendition: 'viewer',
  printPDF: 'viewer',
  save: 'viewer',
  flushed: 'both',
  clipboardWrite: 'viewer',
  copyPaths: 'viewer',
  clipboardRead: 'viewer',
  fileDropPaths: 'viewer',
  fileDragStart: 'viewer',
  volumesList: 'viewer',
  trashList: 'viewer',
  trashConfirmation: 'viewer',
  trashPreview: 'viewer',
  trashCopyPaths: 'viewer',
  trashRestore: 'viewer',
  trashAccess: 'viewer',
  volumeEject: 'viewer',
  fileAccessList: 'both',
  fileAccessRevoke: 'settings',
  textEdit: 'both',
  textOpen: 'viewer',
  textSave: 'viewer',
  textSaveAs: 'viewer',
  textEditEnd: 'viewer',
  textPrompt: 'viewer',
  bufferList: 'viewer',
  bufferRead: 'viewer',
  bufferWrite: 'viewer',
  bufferDiscard: 'viewer',
} satisfies Record<ApiMethod, 'viewer' | 'settings' | 'both'>;
/** Every IPC method's handler, receiving the arguments its schema produced. */
export type ApiHandlers = {
  [K in ApiMethod]: (args: z.infer<(typeof schemas)[K]>, senderID: number) => unknown;
};
