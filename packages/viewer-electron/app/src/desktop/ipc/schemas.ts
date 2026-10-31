/** Argument schemas for every IPC method. The bridge validates each call against these
 * before it reaches a handler, and `ApiCall` carries the inferred argument types. */
import { z } from 'zod';
import { backupRequestSchema } from '../../domain/persistence/backup';
import { officeLayoutRequestSchema } from '../../domain/previews/documents/layout';
import type { ApiMethod, DesktopEvent, ViewerAPI } from '../../domain/contracts';
import {
  imageConversions,
  paneTypes,
  rendererOperationKinds,
  viewModes,
} from '../../domain/contracts';
import { modelDataLevels } from '../../domain/models/permissions';
import { operationPlanRequestSchema } from '../../domain/operations/operation-plan';
import { sourceVersionSchema } from '../../domain/files/inspection';
import { agentCapabilities, agentClientInputSchema } from '../../domain/agents/clients';
import { watchRuleRequestSchema } from '../../domain/automation/watch-rules';
import { workflowDefinitionSchema } from '../../domain/automation/workflows';
import { projectDefinitionSchema } from '../../domain/workspaces/project';
import { tourDefinitionSchema, tourPathSchema } from '../../domain/tours/tour';
import { fabricationRequestSchema } from '../../domain/fabrication/check';
import { lensGroupIDSchema, lensOpSchema } from '../../domain/files/lenses';
import { maxQueryLength } from '../../domain/search/query';
import { rootKey, validKeymapKey } from '../../domain/preferences/keymap';
import { lineSchema } from '../preferences/keymap-schema';
import { gitSourceSchema, commitPattern } from '../../domain/comparison/git';
import { gitActionKinds, gitCommitMessageLimit } from '../../domain/comparison/git-actions';
import { receiptRequestSchema } from '../../domain/automation/receipts';
import { chatRequestSchema } from '../../domain/models/chat';
import { modelSuggestionRequestSchema } from '../../domain/suggestions/model';
import { providerCheckKinds } from '../../domain/models/provider-checks';
import { flushResultSchema } from '../../domain/persistence/flush';
import { journalQuerySchema } from '../../domain/journal/events';
import { browserRequestSchema } from '../../domain/previews/browser';
import { transformPlanSchema } from '../../domain/operations/transforms';
import { mediaRequestSchema } from '../../domain/media/documents';
import { optimizationRequestSchema } from '../../domain/operations/optimization-review';
import {
  documentRequestSchema,
  mailboxMessageSchema,
} from '../../domain/previews/documents/requests';
import { sqliteRequestSchema } from '../../domain/previews/data/sqlite';
import { noteRequestSchema } from '../../domain/editing/notes';
import { speechRequestSchema } from '../../domain/speech/recognition';
import { taskWorkflowInputSchema } from '../../domain/agents/task-workflow';
import { stateSchema } from '../persistence/storage';
import { informationPatchSchema } from '../files/file-information';
import { fileEntrySchema, localPath, id } from '../schemas';
import { textBufferSchema } from '../editing/text-buffers';
import { MAX_TEXT_BYTES, textVersionSchema } from '../../domain/editing/documents';
import { executionCapabilities } from '../../domain/agents/requests';
import { requestActors } from '../../domain/services';
import { reviewModes } from '../../domain/comparison/review';

/** A `>` prompt: the words, and where they were typed (domain/command-line/prompt.ts). */
const promptRequestSchema = z
  .object({
    id,
    prompt: z.string().trim().min(1).max(1000),
    context: z
      .object({
        folder: localPath.optional(),
        selection: z.array(z.string().max(255)).max(50),
        workspace: z.string().max(100),
        workspaces: z.array(z.string().max(100)).max(30),
        commands: z
          .array(z.object({ id: z.string().max(200), label: z.string().max(200) }).strict())
          .max(600),
        userCommands: z.array(z.string().regex(/^[A-Z][A-Za-z0-9]{0,30}$/)).max(200),
      })
      .strict(),
  })
  .strict();
/** A spoken request: the words as transcribed, and the commands where they were spoken
 * (domain/command-line/spoken.ts). */
const spokenRequestSchema = z
  .object({
    id,
    transcript: z.string().trim().min(1).max(2000),
    context: z
      .object({
        folder: localPath.optional(),
        selection: z.array(z.string().max(255)).max(50),
        commands: z
          .array(
            z
              .object({
                id: z.string().max(200),
                label: z.string().max(200),
                subject: z.string().max(255).optional(),
                after: z.array(z.string().max(200)).max(8).optional(),
              })
              .strict(),
          )
          .max(600),
      })
      .strict(),
  })
  .strict();
/** What `:bind` and `:alias` changed this session (domain/preferences/session-keys.ts). */
const sessionKeysSchema = z
  .object({
    bindings: z
      .array(
        z
          .object({
            table: z.string().regex(/^(prefix|root|[a-z][a-z0-9-]{0,30})$/),
            keys: z.array(z.string().max(40).refine(validKeymapKey)).min(1).max(4),
            line: lineSchema.nullable(),
            repeat: z.boolean().optional(),
          })
          .strict()
          .refine((binding) => binding.table !== 'root' || binding.keys.every(rootKey)),
      )
      .max(200),
    aliases: z
      .array(
        z
          .object({
            name: z.string().regex(/^[A-Z][A-Za-z0-9]{0,30}$/),
            line: lineSchema.nullable(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

/** Text an editor saves: at most what Viewer reads, counted in bytes. */
const editedText = z.string().refine((text) => Buffer.byteLength(text, 'utf8') <= MAX_TEXT_BYTES, {
  message: 'Viewer saves text up to 4 MiB.',
});

const indexedQuerySchema = z
  .object({
    query: z.string().max(maxQueryLength),
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
        tasks: z
          .array(
            z.object({
              id,
              name: z.string().min(1).max(100),
              path: localPath,
              branch: z.string().max(1024).optional(),
              commit: z.string().regex(commitPattern).optional(),
            }),
          )
          .max(50)
          .optional(),
        panes: z
          .array(
            z.object({
              id,
              type: z.enum(paneTypes),
              path: localPath,
              mode: z.enum(viewModes).optional(),
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
  actor: z.enum(requestActors),
  recursive: z.boolean().optional(),
});
const targetSchema = z.object({
  originID: z.uuid().optional(),
  workspaceID: id,
  rootID: id,
  paneID: id,
  directory: localPath,
  panePath: localPath.optional(),
  selection: z.array(fileEntrySchema).max(2000),
});
const gitActionTargetSchema = z.object({
  id,
  target: targetSchema.strict(),
  cols: z.number().int().min(2).max(1000).optional(),
  rows: z.number().int().min(2).max(500).optional(),
});
const gitActionRequestSchema = z.discriminatedUnion('kind', [
  gitActionTargetSchema
    .extend({
      kind: z.literal('commit'),
      message: z.string().min(1).max(gitCommitMessageLimit),
    })
    .strict(),
  gitActionTargetSchema
    .extend({ kind: z.enum(gitActionKinds.filter((kind) => kind !== 'commit')) })
    .strict(),
]);
export const schemas = {
  speech: z.tuple([speechRequestSchema]),
  createTask: z.tuple([taskWorkflowInputSchema]),
  optimization: z.tuple([optimizationRequestSchema]),
  receipts: z.tuple([receiptRequestSchema]),
  notes: z.tuple([noteRequestSchema]),
  imageInspect: z.tuple([localPath]),
  pdfInspect: z.tuple([localPath]),
  choosePDFs: z.tuple([]),
  media: z.tuple([mediaRequestSchema]),
  browser: z.tuple([browserRequestSchema]),
  journalQuery: z.tuple([journalQuerySchema]),
  journalExportPreview: z.tuple([journalQuerySchema]),
  journalExport: z.tuple([z.uuid()]),
  journalClear: z.tuple([]),
  htmlPreview: z.tuple([id, mailboxMessageSchema.optional()]),
  htmlPreviewClose: z.tuple([id]),
  localServerStart: z.tuple([
    localPath,
    id,
    z
      .string()
      .max(100)
      .regex(/^\d+:\d+$/)
      .optional(),
  ]),
  localServers: z.tuple([]),
  localServerInspect: z.tuple([id]),
  localServerAction: z.tuple([
    id,
    z.enum(['stop', 'restart', 'clear-log', 'open-browser', 'copy-url', 'close']),
  ]),
  chat: z.tuple([chatRequestSchema]),
  shellCommand: z.tuple([z.enum(['status', 'install', 'uninstall'])]),
  hotkeyStatus: z.tuple([]),
  restoreWindow: z.tuple([]),
  workspaceClaim: z.tuple([id]),
  newWindow: z.tuple([]),
  git: z.tuple([
    z.discriminatedUnion('kind', [
      z
        .object({ kind: z.literal('status'), path: localPath, refresh: z.boolean().optional() })
        .strict(),
      z.object({ kind: z.literal('head'), path: localPath }).strict(),
    ]),
  ]),
  gitResource: z.tuple([gitSourceSchema.extend({ repository: localPath })]),
  gitWorktrees: z.tuple([
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('list'), directory: localPath }).strict(),
      z.object({ kind: z.literal('inspect'), catalogID: z.uuid(), worktreeID: z.uuid() }).strict(),
      z.object({ kind: z.literal('open'), catalogID: z.uuid(), worktreeID: z.uuid() }).strict(),
      z
        .object({
          kind: z.literal('create'),
          catalogID: z.uuid(),
          target: targetSchema.strict(),
          destination: localPath,
          checkout: z.discriminatedUnion('kind', [
            z
              .object({
                kind: z.literal('new'),
                name: z.string().min(1).max(200),
                baseID: z.uuid(),
              })
              .strict(),
            z.object({ kind: z.literal('existing'), branchID: z.uuid() }).strict(),
          ]),
        })
        .strict(),
      z.object({ kind: z.literal('release'), catalogID: z.uuid() }).strict(),
    ]),
  ]),
  gitReview: z.tuple([
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('open'), target: targetSchema.strict() }).strict(),
      z
        .object({
          kind: z.literal('read'),
          reviewID: z.uuid(),
          mode: z.enum(reviewModes),
          baseID: z.uuid().optional(),
          baseCommit: z.string().regex(commitPattern).optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal('file'),
          reviewID: z.uuid(),
          snapshotID: z.uuid(),
          fileID: z.uuid(),
        })
        .strict(),
      z
        .object({
          kind: z.literal('apply'),
          reviewID: z.uuid(),
          fileID: z.uuid(),
          hunks: z.array(z.uuid()).min(1).max(2000),
        })
        .strict(),
      z.object({ kind: z.literal('release'), reviewID: z.uuid() }).strict(),
    ]),
  ]),
  agentSessions: z.tuple([
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('list'), directory: localPath.optional() }).strict(),
      z.object({ kind: z.literal('read'), id: z.uuid() }).strict(),
    ]),
  ]),
  gitAction: z.tuple([gitActionRequestSchema]),
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
  tour: z.tuple([
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('read'), file: localPath }).strict(),
      z
        .object({
          kind: z.literal('save'),
          file: localPath,
          revision: z.string().max(200),
          definition: tourDefinitionSchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal('stat'),
          root: localPath,
          path: tourPathSchema,
          hash: z.boolean().optional(),
        })
        .strict(),
    ]),
  ]),
  fabrication: z.tuple([fabricationRequestSchema]),
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
    z
      .record(id, id)
      .refine((owners) => Object.keys(owners).length <= 200)
      .optional(),
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
      z
        .object({ kind: z.literal('remove'), id: z.uuid(), revision: z.number().int().positive() })
        .strict(),
    ]),
  ]),
  agentAudit: z.tuple([id.optional()]),
  agentStop: z.tuple([id]),
  agentGrant: z.tuple([id, localPath, z.enum(executionCapabilities), z.boolean(), id.optional()]),
  configOpen: z.tuple([]),
  configValidate: z.tuple([]),
  configTransfer: z.tuple([z.enum(['import', 'export'])]),
  backup: z.tuple([backupRequestSchema]),
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
      panePath: localPath.optional(),
      directory: localPath,
      selection: z.array(fileEntrySchema).max(2000),
    }),
    z
      .record(
        z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
        z
          .string()
          .max(4000)
          .refine((value) => !value.includes('\0')),
      )
      .refine((values) => Object.keys(values).length <= 20)
      .optional(),
  ]),
  executionList: z.tuple([]),
  runCommand: z.tuple([
    z
      .string()
      .trim()
      .min(1)
      .max(16000)
      .refine((value) => !value.includes('\0')),
    targetSchema.strict(),
  ]),
  commandDraft: z.tuple([
    z
      .object({
        script: z
          .string()
          .min(1)
          .max(16000)
          .refine((value) => !value.includes('\0')),
        name: z.string().trim().min(1).max(100),
      })
      .strict()
      .optional(),
  ]),
  executionCancel: z.tuple([id]),
  openSettings: z.tuple([
    z
      .string()
      .max(200)
      .regex(/^[A-Za-z0-9.]+$/)
      .optional(),
  ]),
  settingsGet: z.tuple([]),
  promptLine: z.tuple([promptRequestSchema]),
  promptPlan: z.tuple([spokenRequestSchema]),
  promptCancel: z.tuple([id]),
  modelSuggestions: z.tuple([modelSuggestionRequestSchema]),
  sessionKeys: z.tuple([]),
  sessionKeysSet: z.tuple([sessionKeysSchema]),
  sessionKeysKeep: z.tuple([]),
  sessionKeysDiscard: z.tuple([]),
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
  providerCheck: z.tuple([z.object({ providerID: id, kind: z.enum(providerCheckKinds) }).strict()]),
  providerPermissionGet: z.tuple([id]),
  identifyFile: z.tuple([localPath]),
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
  thumbnail: z.tuple([localPath, z.number().int().min(128).max(2048)]),
  appIcon: z.tuple([localPath, z.enum(['small', 'large'])]),
  diagnosticReport: z.tuple([z.string().max(8000)]),
  document: z.tuple([id, documentRequestSchema.optional()]),
  cancelDocument: z.tuple([id, id]),
  resourceFormat: z.tuple([id, z.string().regex(/^[a-z0-9]{1,8}$/)]),
  bootstrap: z.tuple([]),
  list: z.tuple([localPath]),
  stat: z.tuple([localPath]),
  fileInformation: z.tuple([localPath]),
  fileInformationUpdate: z.tuple([localPath, z.string().min(1).max(200), informationPatchSchema]),
  chooseFolder: z.tuple([localPath.optional()]),
  reveal: z.tuple([localPath]),
  openExternal: z.tuple([localPath]),
  openAddress: z.tuple([z.string().min(1).max(8192)]),
  fileIdentity: z.tuple([localPath]),
  connectServer: z.tuple([z.string().min(3).max(2048)]),
  taggedFiles: z.tuple([z.string().trim().min(1).max(255), z.array(localPath).min(1).max(100)]),
  nativeFilePanel: z.tuple([z.enum(['preview', 'share']), z.array(localPath).min(1).max(100)]),
  applications: z.tuple([z.array(localPath).min(1).max(2000)]),
  applicationIcon: z.tuple([id]),
  windowButtons: z.tuple([z.boolean()]),
  chooseApplication: z.tuple([]),
  openWith: z.tuple([z.array(localPath).min(1).max(2000), id]),
  folderSizeStart: z.tuple([z.array(localPath).min(1).max(10000)]),
  folderSizeGet: z.tuple([id]),
  folderSizeCancel: z.tuple([id]),
  watch: z.tuple([localPath, id]),
  unwatch: z.tuple([id]),
  search: z.tuple([
    z.object({
      id,
      root: localPath,
      query: z.string().min(1).max(maxQueryLength),
      showHidden: z.boolean(),
    }),
  ]),
  cancelSearch: z.tuple([id]),
  operate: z.tuple([
    z.object({
      kind: z.enum(rendererOperationKinds),
      sources: z.array(localPath).max(10000),
      destination: localPath.optional(),
      name: z.string().max(255).optional(),
      conversion: z.enum(imageConversions).optional(),
      transform: transformPlanSchema.optional(),
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
  resource: z.tuple([localPath, id.optional()]),
  read: z.tuple([id, z.number().int().positive().optional()]),
  release: z.tuple([id]),
  archive: z.tuple([id]),
  archiveEntry: z.tuple([id, z.string().max(65536)]),
  sqlite: z.tuple([id, sqliteRequestSchema]),
  imageRendition: z.tuple([
    id,
    z
      .object({ requestID: id, mode: z.enum(['camera', 'raw']) })
      .strict()
      .optional(),
  ]),
  videoRendition: z.tuple([id, id]),
  officeLayout: z.tuple([id, officeLayoutRequestSchema]),
  officeWarm: z.tuple([]),
  officeImage: z.tuple([
    id,
    z
      .string()
      .min(1)
      .max(1000)
      .refine((value) => !value.includes('\0')),
    id,
  ]),
  printPDF: z.tuple([id, z.string().min(1).max(1024).optional()]),
  save: z.tuple([stateSchema]),
  flushed: z.tuple([id, flushResultSchema.optional()]),
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
  // a name, or a whole path where the dialog opens (`:w path`)
  textSaveAs: z.tuple([editedText, z.string().min(1).max(1024), id]),
  textEditEnd: z.tuple([id]),
  textPrompt: z.tuple([z.enum(['close', 'revert']), z.string().min(1).max(255)]),
  bufferList: z.tuple([]),
  bufferRead: z.tuple([z.uuid()]),
  bufferWrite: z.tuple([textBufferSchema]),
  bufferDiscard: z.tuple([z.uuid()]),
} satisfies Record<ApiMethod, z.ZodType>;
/**
 * The events Settings receives, for what it shows: settings, search status, service errors, each
 * provider's model data permission and the ⌘Q hint. The workspace window receives every event.
 */
export const settingsEvents: readonly DesktopEvent['type'][] = [
  'speech-changed',
  'settings',
  'index',
  'service-error',
  'model-permission',
  'settings-focus',
  'quit-hint',
];
/**
 * Which window may call each method. Credentials, agent clients and folder revocation belong
 * to Settings; the workspace window's file and workspace methods are unavailable there.
 */
export const methodWindows = {
  speech: 'both',
  createTask: 'viewer',
  optimization: 'viewer',
  gitReview: 'viewer',
  agentSessions: 'viewer',
  receipts: 'viewer',
  notes: 'viewer',
  browser: 'viewer',
  media: 'viewer',
  imageInspect: 'viewer',
  pdfInspect: 'viewer',
  choosePDFs: 'viewer',
  journalQuery: 'viewer',
  journalExportPreview: 'viewer',
  journalExport: 'viewer',
  journalClear: 'viewer',
  htmlPreview: 'viewer',
  htmlPreviewClose: 'viewer',
  localServerStart: 'viewer',
  localServers: 'viewer',
  localServerInspect: 'viewer',
  localServerAction: 'viewer',
  chat: 'viewer',
  shellCommand: 'both',
  hotkeyStatus: 'both',
  restoreWindow: 'viewer',
  workspaceClaim: 'viewer',
  newWindow: 'viewer',
  git: 'viewer',
  gitResource: 'viewer',
  gitWorktrees: 'viewer',
  gitAction: 'viewer',
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
  tour: 'viewer',
  fabrication: 'viewer',
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
  backup: 'viewer',
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
  runCommand: 'viewer',
  commandDraft: 'both',
  executionCancel: 'viewer',
  openSettings: 'viewer',
  settingsGet: 'both',
  settingsPatch: 'both',
  promptLine: 'viewer',
  promptPlan: 'viewer',
  promptCancel: 'viewer',
  modelSuggestions: 'viewer',
  sessionKeys: 'both',
  // the window binds for its session; only Settings writes them to config.jsonc
  sessionKeysSet: 'viewer',
  sessionKeysKeep: 'settings',
  sessionKeysDiscard: 'both',
  providerCredential: 'settings',
  providerModels: 'both',
  providerCheck: 'both',
  providerPermissionGet: 'both',
  identifyFile: 'viewer',
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
  cancelDocument: 'viewer',
  resourceFormat: 'viewer',
  bootstrap: 'viewer',
  list: 'viewer',
  stat: 'viewer',
  fileInformation: 'viewer',
  fileInformationUpdate: 'viewer',
  chooseFolder: 'both',
  reveal: 'viewer',
  openExternal: 'viewer',
  openAddress: 'viewer',
  fileIdentity: 'viewer',
  connectServer: 'viewer',
  taggedFiles: 'viewer',
  nativeFilePanel: 'viewer',
  applications: 'viewer',
  applicationIcon: 'viewer',
  windowButtons: 'viewer',
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
  sqlite: 'viewer',
  imageRendition: 'viewer',
  videoRendition: 'viewer',
  officeLayout: 'viewer',
  officeWarm: 'viewer',
  officeImage: 'viewer',
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
  [K in ApiMethod]: (
    args: z.infer<(typeof schemas)[K]>,
    senderID: number,
  ) => Awaited<ReturnType<ViewerAPI[K]>> | Promise<Awaited<ReturnType<ViewerAPI[K]>>>;
};

/**
 * Every method's schema accepts what `ViewerAPI` lets a renderer send, checked when compiling.
 * `fileDropPaths` is the exception: the preload turns its `File`s into paths.
 */
type PreloadAdapted = 'fileDropPaths';
type Accepts<K extends ApiMethod> =
  Parameters<ViewerAPI[K]> extends z.input<(typeof schemas)[K]> ? K : never;
type Disagreeing = Exclude<ApiMethod, PreloadAdapted | { [K in ApiMethod]: Accepts<K> }[ApiMethod]>;
export const schemasAgreeWithAPI: [Disagreeing] extends [never] ? true : { [K in Disagreeing]: K } =
  true;
