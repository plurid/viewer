import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { SavedState } from '../../domain/contracts';
import { CURRENT_STATE_VERSION } from '../../domain/contracts';
import type { SettingsPatch, SettingsSnapshot } from '../../domain/services';
import type { TextVersion } from '../../domain/editing/documents';
import type { BackupRequest, BackupReply, BackupReview } from '../../domain/persistence/backup';
import { backupRequestSchema } from '../../domain/persistence/backup';
import { noteSchema } from '../../domain/editing/notes';
import { mediaDraftSchema } from '../../domain/media/documents';
import { chatDocumentSchema } from '../../domain/models/chat';
import { receiptSchema } from '../../domain/automation/receipts';
import { pathMapper } from '../../domain/files/changes';
import { inspectReviewedFile } from '../native/reviewed-file';
import { textBufferSchema } from '../editing/text-buffers';
import { settingsSchema, validateCustomProfiles } from '../preferences/settings-schema';
import { stateSchema } from './storage';
import { backupIdentityMap, backupRoots, restoreBackupState } from './backup-state';

const maximumBackupBytes = 64 * 1024 * 1024;
const documentKinds = {
  notes: { directory: 'notes', schema: noteSchema },
  drafts: { directory: 'text-buffers', schema: textBufferSchema },
  media: { directory: 'media-drafts', schema: mediaDraftSchema },
  conversations: { directory: 'chat-documents', schema: chatDocumentSchema },
  receipts: { directory: 'command-receipts', schema: receiptSchema },
} as const;
type DocumentKind = keyof typeof documentKinds;
const documentKeys = Object.keys(documentKinds) as DocumentKind[];
/** Presentation and authored recipes only. Never add access or execution authority to this list. */
const portableKeys = [
  'appearance',
  'browsing',
  'folders',
  'editor',
  'terminalFont',
  'tiling',
  'tour',
  'theme',
  'themes',
  'profiles',
  'layouts',
  'shortcuts',
  'keymap',
  'savedSearches',
  'recipes',
  'optimizationRecipes',
  'toolbars',
] as const;
const portableFields = Object.fromEntries(
  portableKeys.map((key) => [key, settingsSchema.shape[key]]),
) as Pick<typeof settingsSchema.shape, (typeof portableKeys)[number]>;
export const portablePreferencesSchema = z.object(portableFields).partial().strict();
export const backupSchema = z
  .object({
    format: z.literal('viewer-personal-backup'),
    version: z.literal(1),
    created: z.string().datetime(),
    privateRoot: z.string().min(1).max(32768),
    state: stateSchema,
    preferences: portablePreferencesSchema,
    documents: z
      .object({
        notes: z.array(noteSchema).max(2000),
        drafts: z.array(textBufferSchema).max(2000),
        media: z.array(mediaDraftSchema).max(1000),
        conversations: z.array(chatDocumentSchema).max(1000),
        receipts: z.array(receiptSchema).max(1000),
      })
      .strict(),
  })
  .strict();
type Backup = z.infer<typeof backupSchema>;
interface Prepared {
  owner: number;
  backup: Backup;
  mode: BackupReview['mode'];
  roots: string[];
  bindings: Map<string, string>;
  bytes: number;
}
interface BackupHost {
  flush(): Promise<void>;
  state(): Promise<SavedState | null>;
  settings(): SettingsSnapshot;
  apply(patches: SettingsPatch[]): Promise<SettingsSnapshot>;
  choose(owner: number, kind: 'import' | 'export' | 'folder'): Promise<string | null>;
  textVersion?(file: string): Promise<TextVersion | undefined>;
  imported?(): void;
}

function validate(value: unknown): Backup {
  if (
    value &&
    typeof value === 'object' &&
    'version' in value &&
    typeof value.version === 'number' &&
    value.version > 1
  )
    throw new Error('This backup needs a newer Viewer. The file was left unchanged.');
  if (
    value &&
    typeof value === 'object' &&
    'state' in value &&
    value.state &&
    typeof value.state === 'object' &&
    'version' in value.state &&
    typeof value.state.version === 'number' &&
    value.state.version > CURRENT_STATE_VERSION
  )
    throw new Error('These workspaces need a newer Viewer. The backup was left unchanged.');
  const backup = backupSchema.parse(value);
  const ids = new Set<string>();
  const members = Object.fromEntries(
    documentKeys.map((kind) => [
      kind,
      new Set(backup.documents[kind].map((document) => document.id)),
    ]),
  ) as Record<DocumentKind, Set<string>>;
  for (const kind of documentKeys)
    for (const document of backup.documents[kind]) {
      if (ids.has(document.id))
        throw new Error('The backup contains duplicate document identities.');
      ids.add(document.id);
    }
  const spaces = new Set<string>(),
    panes = new Set<string>();
  for (const space of backup.state.workspaces) {
    if (spaces.has(space.id))
      throw new Error('The backup contains duplicate workspace identities.');
    spaces.add(space.id);
    for (const pane of space.panes) {
      if (panes.has(pane.id)) throw new Error('The backup contains duplicate plane identities.');
      panes.add(pane.id);
      const reference: { kind: DocumentKind; id: string } | undefined =
        pane.type === 'note'
          ? { kind: 'notes', id: pane.documentID }
          : (pane.type === 'scratch' || pane.type === 'preview' || pane.type === 'diff') &&
              pane.bufferID
            ? { kind: 'drafts', id: pane.bufferID }
            : pane.type === 'media'
              ? { kind: 'media', id: pane.draftID }
              : pane.type === 'chat' && !pane.externalSessionID
                ? { kind: 'conversations', id: pane.conversationID }
                : pane.type === 'receipt'
                  ? { kind: 'receipts', id: pane.receiptID }
                  : undefined;
      if (reference && !members[reference.kind].has(reference.id))
        throw new Error(
          'The backup is incomplete: a plane’s private document is missing. Current work was left unchanged.',
        );
    }
  }
  if (backup.state.version > CURRENT_STATE_VERSION)
    throw new Error('The workspaces need a newer Viewer.');
  return backup;
}

/** A bounded review owns exact bytes and fresh restore identities; it conveys no file access. */
export class PersonalBackups {
  private prepared = new Map<string, Prepared>();
  private busy = new Set<number>();
  private closed = new Set<number>();
  private exports = new Set<Promise<void>>();
  constructor(
    private root: string,
    private host: BackupHost,
  ) {}

  stopOwner(owner: number) {
    if (this.busy.has(owner)) this.closed.add(owner);
    for (const [id, item] of this.prepared) if (item.owner === owner) this.prepared.delete(id);
  }
  private requireOwner(owner: number) {
    if (this.closed.has(owner))
      throw new Error('The backup window closed. Existing work was preserved.');
  }
  /** Resolves once no export is being written, including one that starts meanwhile. */
  async exported(): Promise<void> {
    while (this.exports.size) await Promise.allSettled([...this.exports]);
  }

  private async readDocuments(): Promise<Backup['documents']> {
    const documents: Backup['documents'] = {
      notes: [],
      drafts: [],
      media: [],
      conversations: [],
      receipts: [],
    };
    let bytes = 0;
    for (const kind of documentKeys) {
      const directory = path.join(this.root, documentKinds[kind].directory);
      let names: string[];
      try {
        const item = await lstat(directory);
        if (!item.isDirectory() || item.isSymbolicLink())
          throw new Error('A private document folder is a link or is unavailable.');
        names = await readdir(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      if (names.length > 10000)
        throw new Error('The private document folder exceeds the backup limit.');
      for (const name of names.sort()) {
        if (!name.endsWith('.json') || !z.uuid().safeParse(name.slice(0, -5)).success) continue;
        const inspected = await inspectReviewedFile(path.join(directory, name), 4 * 1024 * 1024);
        bytes += inspected.bytes.length;
        if (bytes > maximumBackupBytes)
          throw new Error('The backup exceeds 64 MiB. Export fewer workspaces or documents first.');
        const document = documentKinds[kind].schema.parse(
          JSON.parse(inspected.bytes.toString('utf8')),
        );
        if (document.id !== name.slice(0, -5))
          throw new Error('A private document’s identity does not match its file.');
        // The key and validator travel together; validation above determines this member’s type.
        (documents[kind] as { id: string }[]).push(document);
      }
    }
    return documents;
  }

  private review(id: string, item: Prepared): BackupReply {
    return {
      kind: 'review',
      review: {
        id,
        mode: item.mode,
        created: item.backup.created,
        bytes: item.bytes,
        workspaces: item.backup.state.workspaces.map((space) => space.name),
        documents: {
          notes: item.backup.documents.notes.length,
          drafts: item.backup.documents.drafts.length,
          media: item.backup.documents.media.length,
          conversations: item.backup.documents.conversations.length,
          receipts: item.backup.documents.receipts.length,
        },
        roots: item.roots.map((source) => ({ source, destination: item.bindings.get(source) })),
        warnings: [
          'The backup is readable JSON and contains private text, conversations, file paths and command history. Store it privately.',
          'Source files, credentials, access grants, browser sessions and running processes are not included.',
          ...(item.mode === 'import'
            ? [
                'Restored workspaces are independent copies. Linked project files and external agent sessions must be reconnected separately.',
              ]
            : []),
        ],
      },
    };
  }

  async request(request: BackupRequest, owner: number): Promise<BackupReply> {
    request = backupRequestSchema.parse(request);
    if (request.kind === 'release') {
      const item = this.prepared.get(request.id);
      if (item?.owner === owner) this.prepared.delete(request.id);
      return { kind: 'cancelled' };
    }
    if (this.busy.has(owner)) throw new Error('Wait for this backup operation to finish.');
    this.requireOwner(owner);
    this.busy.add(owner);
    try {
      return await this.perform(request, owner);
    } finally {
      this.busy.delete(owner);
      this.closed.delete(owner);
    }
  }

  private async write(file: string, backup: Backup): Promise<void> {
    // Exclusive creation: a native dialog’s replace choice cannot silently destroy an old backup.
    const handle = await open(file, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(backup, null, 2));
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async perform(
    request: Exclude<BackupRequest, { kind: 'release' }>,
    owner: number,
  ): Promise<BackupReply> {
    if (request.kind === 'prepare-export' || request.kind === 'choose-import') {
      if (this.prepared.size >= 4) throw new Error('Close another backup review first.');
      let backup: Backup;
      if (request.kind === 'prepare-export') {
        await this.host.flush();
        const state = await this.host.state();
        if (!state) throw new Error('Save a workspace before making a backup.');
        backup = validate({
          format: 'viewer-personal-backup',
          version: 1,
          created: new Date().toISOString(),
          privateRoot: this.root,
          state,
          preferences: portablePreferencesSchema.parse(
            Object.fromEntries(
              Object.keys(portablePreferencesSchema.shape).map((key) => [
                key,
                this.host.settings().settings[key as keyof SettingsSnapshot['settings']],
              ]),
            ),
          ),
          documents: await this.readDocuments(),
        });
      } else {
        const file = await this.host.choose(owner, 'import');
        if (!file) return { kind: 'cancelled' };
        const inspected = await inspectReviewedFile(file, maximumBackupBytes);
        backup = validate(JSON.parse(inspected.bytes.toString('utf8')));
      }
      const bytes = Buffer.byteLength(JSON.stringify(backup, null, 2));
      if (bytes > maximumBackupBytes)
        throw new Error('The backup exceeds 64 MiB. Existing work was preserved.');
      const roots = backupRoots(backup.state, backup.privateRoot, [
        ...backup.documents.notes.map((item) => item.directory),
        ...backup.documents.drafts.flatMap((item) => (item.file ? [path.dirname(item.file)] : [])),
        ...backup.documents.media.flatMap((item) =>
          item.sources.map((source) => path.dirname(source.path)),
        ),
        ...backup.documents.conversations.map((item) => item.path),
        ...backup.documents.receipts.map((item) => item.directory),
      ]);
      const id = randomUUID(),
        item: Prepared = {
          owner,
          backup,
          mode: request.kind === 'prepare-export' ? 'export' : 'import',
          roots,
          bindings: new Map(),
          bytes,
        };
      this.requireOwner(owner);
      this.prepared.set(id, item);
      return this.review(id, item);
    }
    const item = this.prepared.get(request.id);
    if (!item || item.owner !== owner)
      throw new Error('This backup review expired. Open it again.');
    if (request.kind === 'relink') {
      if (item.mode !== 'import' || !item.roots.includes(request.root))
        throw new Error('This folder is not part of the reviewed backup.');
      const folder = await this.host.choose(owner, 'folder');
      if (folder) item.bindings.set(request.root, folder);
      return this.review(request.id, item);
    }
    if (request.kind === 'write') {
      if (item.mode !== 'export') throw new Error('Choose an export review.');
      const file = await this.host.choose(owner, 'export');
      if (!file) return { kind: 'cancelled' };
      this.requireOwner(owner);
      const writing = this.write(file, item.backup);
      this.exports.add(writing);
      try {
        await writing;
      } finally {
        this.exports.delete(writing);
      }
      this.prepared.delete(request.id);
      return { kind: 'written', name: path.basename(file) };
    }
    if (item.mode !== 'import') throw new Error('Choose an import review.');
    await this.host.flush();
    this.requireOwner(owner);
    const current = await this.host.state();
    if ((current?.workspaces.length ?? 0) + item.backup.state.workspaces.length > 30)
      throw new Error(
        'Restoring these workspaces would exceed the limit of 30. Export smaller groups first.',
      );
    const ids = backupIdentityMap(
      item.backup.state,
      documentKeys.flatMap((kind) => item.backup.documents[kind].map((doc) => doc.id)),
    );
    const changes = [
      { source: item.backup.privateRoot, destination: this.root },
      ...[...item.bindings].map(([source, destination]) => ({ source, destination })),
    ];
    const map = pathMapper(changes),
      id = (value: string) => ids.get(value) ?? value;
    const restored = stateSchema.parse(restoreBackupState(item.backup.state, ids, changes));
    const preferences = request.preferences ? structuredClone(item.backup.preferences) : {};
    if (preferences.folders)
      preferences.folders = Object.fromEntries(
        Object.entries(preferences.folders).map(([folder, view]) => [map(folder), view]),
      );
    if (preferences.browsing) {
      preferences.browsing.newPlanePath = map(preferences.browsing.newPlanePath);
      preferences.browsing.emptyWorkspacePath = map(preferences.browsing.emptyWorkspacePath);
    }
    if (preferences.savedSearches)
      preferences.savedSearches = preferences.savedSearches.map((search) => ({
        ...search,
        root: search.root && map(search.root),
      }));
    if (preferences.layouts)
      preferences.layouts = preferences.layouts.map((layout) => ({
        ...layout,
        planes: layout.planes.map((plane) => ({
          ...plane,
          ...('path' in plane ? { path: map(plane.path) } : {}),
          ...('root' in plane && plane.root ? { root: map(plane.root) } : {}),
        })),
      }));
    const before = this.host.settings().settings;
    const next = settingsSchema.parse({ ...before, ...preferences });
    validateCustomProfiles(next.profiles, before.profiles);
    const patches: SettingsPatch[] = Object.entries(preferences).map(([key, value]) => ({
      path: 'settings.' + key,
      value,
    }));
    if (request.preferences && restored.ui) patches.push({ path: 'ui', value: restored.ui });
    // Validate all records before creating anything. The write pass only uses generated UUID names.
    const documents = {
      notes: item.backup.documents.notes.map((doc) => ({
        ...doc,
        id: id(doc.id),
        directory: map(doc.directory),
      })),
      drafts: item.backup.documents.drafts.map((doc) => ({
        ...doc,
        id: id(doc.id),
        file: doc.file && map(doc.file),
      })),
      media: item.backup.documents.media.map((doc) => ({
        ...doc,
        id: id(doc.id),
        sources: doc.sources.map((source) => ({ ...source, path: map(source.path) })),
      })),
      conversations: item.backup.documents.conversations.map((doc) => ({
        ...doc,
        id: id(doc.id),
        path: map(doc.path),
        status: 'stopped' as const,
        scopes: [],
        messages: doc.messages.map(({ proposal: _proposal, ...message }) => ({
          ...message,
          links: message.links?.map((link) => ({ ...link, path: map(link.path) })),
        })),
      })),
      receipts: item.backup.documents.receipts.map((doc) => ({
        ...doc,
        id: id(doc.id),
        directory: map(doc.directory),
        folderIdentity: undefined,
        workspaceID: id(doc.workspaceID),
        paneID: id(doc.paneID),
        status: doc.status === 'running' ? ('interrupted' as const) : doc.status,
      })),
    };
    for (const draft of documents.drafts)
      if (draft.file && draft.base && this.host.textVersion) {
        const version = await this.host.textVersion(draft.file).catch(() => undefined);
        // Relinking a copied file changes its inode. Adopt it only when the original bytes match.
        if (version?.sha256 === draft.base.sha256 && version.size === draft.base.size)
          draft.base = version;
      }
    for (const kind of documentKeys)
      for (const doc of documents[kind]) documentKinds[kind].schema.parse(doc);
    for (const kind of documentKeys) {
      if (!documents[kind].length) continue;
      const directory = path.join(this.root, documentKinds[kind].directory);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const entry = await lstat(directory);
      if (!entry.isDirectory() || entry.isSymbolicLink())
        throw new Error(
          'The private document destination is a link. Restored files were preserved.',
        );
      for (const doc of documents[kind]) {
        const handle = await open(path.join(directory, doc.id + '.json'), 'wx', 0o600);
        try {
          await handle.writeFile(JSON.stringify(doc));
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
    }
    this.requireOwner(owner);
    const settings = patches.length ? await this.host.apply(patches) : this.host.settings();
    this.host.imported?.();
    this.prepared.delete(request.id);
    return { kind: 'restored', state: restored, settings };
  }
}
