import type { ParseError } from 'jsonc-parser';
import { pathMapper, type FileChange } from '../../domain/files/changes';
import { preferencesSchema } from './preferences-schema';
import { sequencesOnly } from '../../domain/automation/actions';
import { settingCatalog, workspaceMayChange } from '../../domain/preferences/catalog';
import path from 'node:path';
import { z } from 'zod';
import { profileDiagnostics } from '../../domain/preferences/presentation/resolver';
import type { SettingsPatch, SettingsSnapshot } from '../../domain/services';
import { defaultSettings } from '../../domain/services';
import type { UIPreferences, Pane, FolderPane, Look } from '../../domain/contracts';
import { normalizePreferences } from '../../domain/preferences/ui';
import fs from 'node:fs/promises';
import { JsoncConfiguration, configChanges, overlaps } from './configuration';
import { referenceIssues } from '../../domain/automation/references';
import { modelDataLevels } from '../../domain/models/permissions';
import { profileSchema, validateCustomProfiles, settingsSchema } from './settings-schema';
import { importChanges } from './import-changes';
/**
 * What the workspace window changes: its own preferences and views. It could patch any setting, so a
 * compromised workspace renderer could widen agent folders, add a provider or an action;
 * the rest is changed in Settings.
 */
// the workspace window's own view and presentation: domain/preferences/catalog.ts
const workspaceMayPatch = workspaceMayChange;
const configSchema = z
  .object({
    $schema: z.literal('config.schema.json').default('config.schema.json'),
    version: z.literal(1),
    settings: settingsSchema,
    ui: preferencesSchema,
  })
  .strict();
type Configuration = z.infer<typeof configSchema>;
/** The keys a patch names, under `settings` or `ui` and never through an object's prototype. */
function patchKeys(patch: SettingsPatch): string[] {
  const keys = patch.keys || patch.path.split('.');
  if (
    !['settings', 'ui'].includes(keys[0] ?? '') ||
    keys.some((key) => ['__proto__', 'prototype', 'constructor'].includes(key))
  )
    throw new Error('Unknown setting.');
  return keys;
}
/**
 * Applies a patch to `document`, a copy. Returns `true` when it sets a key the document does not
 * hold yet, such as an optional one a config.jsonc written before it lacks: `validated` decides
 * whether the schema knows it. A key that is not there cannot be removed.
 */
function applyPatch(
  document: Record<string, unknown>,
  keys: readonly string[],
  value: unknown,
): boolean {
  const folders = keys[1] === 'folders';
  let object = document;
  for (const key of keys.slice(0, -1)) {
    if (!object[key] && folders) object[key] = {};
    if (!object[key] || typeof object[key] !== 'object' || Array.isArray(object[key]))
      throw new Error('Unknown setting.');
    object = object[key] as Record<string, unknown>;
  }
  const key = keys.at(-1)!;
  const absent = !Object.hasOwn(object, key) && !folders;
  if (value === undefined || (value === null && folders)) {
    if (absent) throw new Error('Unknown setting.');
    delete object[key];
    return false;
  }
  object[key] = value;
  return absent;
}
/** Whether `document` holds a value at `keys`. */
function holds(document: unknown, keys: readonly string[]): boolean {
  let value = document;
  for (const key of keys) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return false;
    value = (value as Record<string, unknown>)[key];
  }
  return true;
}
/**
 * The patched configuration, validated. A key a patch set where the document held none is one the
 * schema knows only if it survives: a strict object refuses any other, and any other drops it.
 */
function validated(config: unknown, absent: readonly (readonly string[])[]): Configuration {
  const named = (path: readonly PropertyKey[], key: PropertyKey) =>
    absent.some(
      (keys) => keys.at(-1) === key && keys.slice(0, -1).join('\0') === path.map(String).join('\0'),
    );
  let result: Configuration;
  try {
    result = configSchema.parse(config);
  } catch (error) {
    if (
      error instanceof z.ZodError &&
      error.issues.some(
        (issue) =>
          issue.code === 'unrecognized_keys' && issue.keys.some((key) => named(issue.path, key)),
      )
    )
      throw new Error('Unknown setting.');
    throw error;
  }
  if (absent.some((keys) => !holds(result, keys))) throw new Error('Unknown setting.');
  return result;
}
export class SettingsService {
  private document: z.infer<typeof configSchema> & { revision: number };
  private fields = new Map<string, number>();
  private queue: Promise<void> = Promise.resolve();
  private store: JsoncConfiguration<z.infer<typeof configSchema>>;
  private loaded?: Promise<void>;
  /** Until config.jsonc is read, the document holds defaults, which are not the person's settings. */
  private read = false;
  private seedPending = false;
  private profilesReady = false;
  /** The copy in effect while config.jsonc cannot be read: its last valid copy, or the defaults. */
  private fallback?: 'last-valid' | 'defaults';
  private restored?: string;
  constructor(
    private dataPath: string,
    home: string,
    private dark: () => boolean,
    private emit: (value: SettingsSnapshot) => void,
  ) {
    this.store = new JsoncConfiguration(dataPath, (value) => {
      const parsed = configSchema.parse(value);
      if (this.profilesReady)
        validateCustomProfiles(parsed.settings.profiles, this.document.settings.profiles);
      return parsed;
    });
    this.document = {
      $schema: 'config.schema.json',
      version: 1,
      revision: 0,
      settings: defaultSettings(home),
      ui: normalizePreferences(),
    };
  }
  /** `seed` carries interface preferences kept with workspace state, for a first configuration. */
  async load(seed?: { ui?: UIPreferences; look: Look }): Promise<void> {
    this.loaded ??= (async () => {
      await fs.mkdir(this.dataPath, { recursive: true, mode: 0o700 });
      const value = await this.store.read();
      const last = value || this.store.diagnostics.length ? {} : await this.store.lastValid();
      if (value) this.document = { ...value, revision: 0 };
      else if (this.store.diagnostics.length) {
        const recovery = await this.store.recovery();
        if (recovery) this.document = { ...recovery, revision: 0 };
        this.fallback = recovery ? 'last-valid' : 'defaults';
      } else if (last.value) {
        // config.jsonc is missing and its last valid copy is not: the file was removed. The copy is
        // the person's settings; a removed file was a first run, which wrote the defaults over the
        // last valid copy too.
        this.document = { ...last.value, revision: 0 };
        this.restored = 'config.jsonc was missing: Viewer restored it from its last valid copy.';
        await this.write();
      } else {
        this.seedPending = true;
        // never replace a copy that was not read: it is kept under a name of its own
        if (last.unreadable) await this.store.keepUnreadableLastValid();
        // settings-v1 is migrated once: its backup says it was, and then it is older than whatever
        // config.jsonc held since (it came back whenever config.jsonc went missing)
        const migrated = await fs
          .access(path.join(this.dataPath, 'settings-v1.migration-backup.json'))
          .then(
            () => true,
            () => false,
          );
        try {
          if (migrated)
            throw Object.assign(new Error('settings-v1 was migrated before.'), { code: 'ENOENT' });
          const text = await fs.readFile(path.join(this.dataPath, 'settings-v1.json'), 'utf8');
          const prior = JSON.parse(text);
          await fs
            .writeFile(path.join(this.dataPath, 'settings-v1.migration-backup.json'), text, {
              flag: 'wx',
              mode: 0o600,
            })
            .catch((error: NodeJS.ErrnoException) => {
              if (error.code !== 'EEXIST') throw error;
            });
          this.document = {
            ...configSchema.parse({
              version: 1,
              settings: prior.settings,
              ui: normalizePreferences(prior.ui),
            }),
            revision: prior.revision || 0,
          };
        } catch (error) {
          // An unreadable earlier file stays where it is and settings start from the defaults;
          // rethrown, it kept Viewer from starting at all.
          if (
            !(error instanceof SyntaxError || error instanceof z.ZodError) &&
            (error as NodeJS.ErrnoException).code !== 'ENOENT'
          )
            throw error;
          if (seed) {
            this.document.ui = normalizePreferences(seed.ui);
            this.document.settings.appearance = seed.look;
          }
        }
        await this.write();
      }
      // Generate the schema from the same declarations used by Settings and IPC.
      const schema = z.toJSONSchema(configSchema, { unrepresentable: 'any' });
      for (const field of settingCatalog) {
        let object = schema as Record<string, unknown>;
        for (const key of field.path.split('.'))
          object =
            (object.properties as Record<string, Record<string, unknown>> | undefined)?.[key] || {};
        object.title = field.label;
        if (field.detail) object.description = field.detail;
      }
      const settingsProperties = (
        schema.properties as
          Record<string, { properties?: Record<string, Record<string, unknown>> }> | undefined
      )?.settings?.properties;
      if (settingsProperties?.profiles)
        settingsProperties.profiles.items = z.toJSONSchema(profileSchema, {
          unrepresentable: 'any',
        });
      await this.store.schema(schema);
      this.profilesReady = true;
      this.read = true;
      this.store.watch(() => {
        void this.reload().catch(() => {});
      });
    })();
    await this.loaded;
  }
  /** Whether config.jsonc has been read, so a snapshot holds the person's settings. */
  isLoaded(): boolean {
    return this.read;
  }
  private write(): Promise<void> {
    const { revision: _revision, ...config } = this.document;
    return this.store.write(config);
  }
  snapshot(credentials: string[] = []): SettingsSnapshot {
    const systemLook = this.dark() ? 'dark' : 'light';
    return {
      revision: this.document.revision,
      settings: this.document.settings,
      ui: this.document.ui,
      look:
        this.document.settings.appearance === 'system'
          ? systemLook
          : this.document.settings.appearance,
      credentials,
      systemLook,
      config: {
        path: this.store.file,
        diagnostics: this.store.diagnostics,
        changes: this.store.changes,
        ...(this.store.missing ? { missing: true } : {}),
        ...(this.restored ? { restored: this.restored } : {}),
        ...(this.fallback && this.store.diagnostics.length ? { fallback: this.fallback } : {}),
        warnings: [
          ...referenceIssues(this.document.settings),
          ...profileDiagnostics(this.document.settings.profiles).map((issue) => issue.message),
        ],
      },
    };
  }
  /** `true` when it announced a change. */
  private async readChanges(): Promise<boolean> {
    const value = await this.store.read();
    if (!value) return false;
    const { revision, ...before } = this.document;
    const changes = configChanges(before, value);
    if (!changes.length) return false;
    this.document = { ...value, revision: revision + 1 };
    for (const change of changes)
      this.fields.set(JSON.stringify(change.keys), this.document.revision);
    this.emit(this.snapshot());
    return true;
  }
  reload(): Promise<SettingsSnapshot> {
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        await this.load();
        // the diagnostics of a file that could not be read are announced here; a change, once (it was
        // announced by the read and again here, 2026-10-20)
        if (!(await this.readChanges())) this.emit(this.snapshot());
        return this.snapshot();
      });
    this.queue = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  patch(
    patches: SettingsPatch[],
    revision: number,
    scope?: 'workspace',
  ): Promise<SettingsSnapshot> {
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        await this.load();
        await this.readChanges();
        if (this.store.diagnostics.length) throw new Error(this.store.diagnostics[0]);
        const next = structuredClone(this.document);
        const absent: string[][] = [];
        for (const patch of patches) {
          const keys = patchKeys(patch);
          // Record macro saves a command sequence from the workspace: checked once the result is known
          const macros = keys[0] === 'settings' && keys[1] === 'customActions';
          if (scope === 'workspace' && !workspaceMayPatch(keys) && !macros)
            throw new Error('Change this setting in Settings.');
          if (
            [...this.fields].some(
              ([field, changed]) => changed > revision && overlaps(JSON.parse(field), keys),
            )
          )
            throw new Error(
              'This setting changed in another window or config.jsonc. Review its current value.',
            );
          if (applyPatch(next as unknown as Record<string, unknown>, keys, patch.value))
            absent.push(keys);
        }
        const { revision: _revision, ...config } = next;
        const parsed = validated(config, absent);
        validateCustomProfiles(parsed.settings.profiles, this.document.settings.profiles);
        if (
          scope === 'workspace' &&
          !sequencesOnly(this.document.settings.customActions, parsed.settings.customActions)
        )
          throw new Error('Change this setting in Settings.');
        // a whole browsing section from the workspace keeps the person's Trash confirmation
        if (
          scope === 'workspace' &&
          parsed.settings.browsing.confirmTrash !== this.document.settings.browsing.confirmTrash
        )
          throw new Error('Change this setting in Settings.');
        await this.store.write(parsed);
        this.document = { ...parsed, revision: this.document.revision + 1 };
        for (const patch of patches)
          this.fields.set(
            JSON.stringify(patch.keys || patch.path.split('.')),
            this.document.revision,
          );
        const result = this.snapshot();
        this.emit(result);
        return result;
      });
    this.queue = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  preview(patches: SettingsPatch[]): { valid: true; changes: string[] } {
    const next = structuredClone(this.document) as unknown as Record<string, unknown>;
    const absent: string[][] = [];
    for (const patch of patches) {
      const keys = patchKeys(patch);
      if (applyPatch(next, keys, patch.value)) absent.push(keys);
    }
    const { revision: _revision, ...config } = next;
    const parsed = validated(config, absent);
    validateCustomProfiles(parsed.settings.profiles, this.document.settings.profiles);
    // An agent edits a recipe, not what binds it to the person: its shortcut, its model provider,
    // or more data than it sent. A whole-recipes patch carried them.
    const recipes = new Map(this.document.settings.recipes.map((recipe) => [recipe.id, recipe]));
    for (const recipe of parsed.settings.recipes) {
      const before = recipes.get(recipe.id);
      if (
        (recipe.shortcut || '') !== (before?.shortcut || '') ||
        (recipe.providerID ?? '') !== (before?.providerID ?? '') ||
        (before && modelDataLevels.indexOf(recipe.data) > modelDataLevels.indexOf(before.data))
      )
        throw new Error(
          `A recipe’s shortcut, model provider and data stay with you: change “${recipe.name}” in Settings → Actions.`,
        );
    }
    // an agent's change may leave an earlier reference to a missing item; it may not add one
    const earlier = new Set(referenceIssues(this.document.settings));
    const added = referenceIssues(parsed.settings).filter((issue) => !earlier.has(issue));
    if (added.length) throw new Error(added.join(' '));
    return {
      valid: true,
      changes: configChanges(this.document, next).map((change) => change.keys.join('.')),
    };
  }
  /** Writes a removed config.jsonc back from the settings in effect (a no-op while it is there). */
  restoreConfiguration(): Promise<SettingsSnapshot> {
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        await this.load();
        await this.readChanges();
        if (this.store.missing) await this.write();
        const result = this.snapshot();
        this.emit(result);
        return result;
      });
    this.queue = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  async exportConfiguration(file: string): Promise<void> {
    await fs.copyFile(this.store.file, file);
  }
  /** `confirm` is asked first when the import changes what Viewer may run, reach or send. */
  async importConfiguration(
    file: string,
    confirm?: (changes: string[]) => Promise<boolean>,
  ): Promise<SettingsSnapshot> {
    const text = await fs.readFile(file, 'utf8');
    const errors: ParseError[] = [];
    const { parse } = await import('jsonc-parser');
    const config = configSchema.parse(parse(text, errors, { allowTrailingComma: true }));
    if (errors.length) throw new Error('Import contains invalid JSONC.');
    validateCustomProfiles(config.settings.profiles);
    await this.load();
    const changes = importChanges(this.document.settings, config.settings);
    if (changes.length && confirm && !(await confirm(changes)))
      throw new Error('The import was cancelled. Nothing changed.');
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        const value = await this.store.replace(text);
        const { revision, ...before } = this.document;
        this.document = { ...value, revision: revision + 1 };
        this.fallback = undefined;
        for (const change of configChanges(before, value))
          this.fields.set(JSON.stringify(change.keys), this.document.revision);
        const result = this.snapshot();
        this.emit(result);
        return result;
      });
    this.queue = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  async remapFolders(changes: readonly FileChange[]): Promise<void> {
    await this.load();
    await this.flush();
    const map = pathMapper(changes);
    const snapshot = this.snapshot();
    const folders = Object.fromEntries(
      Object.entries(snapshot.settings.folders).map(([folder, value]) => [map(folder), value]),
    );
    if (JSON.stringify(folders) !== JSON.stringify(snapshot.settings.folders))
      await this.patch([{ path: 'settings.folders', value: folders }], snapshot.revision);
  }
  async seedFolders(panes: Pane[]): Promise<void> {
    await this.load();
    if (!this.seedPending) return;
    this.seedPending = false;
    if (Object.keys(this.document.settings.folders).length) return;
    const folders = Object.fromEntries(
      panes
        .filter((pane): pane is FolderPane => pane.type === 'folder')
        .map((pane) => [
          pane.path,
          {
            mode: pane.mode,
            sort: pane.sort,
            descending: pane.descending,
            showHidden: pane.showHidden,
          },
        ]),
    );
    if (Object.keys(folders).length)
      await this.patch([{ path: 'settings.folders', value: folders }], this.document.revision);
  }
  /** Before config.jsonc is read there is nothing of the person's to announce: a theme change at
   * launch announced the defaults, and model data approvals were reconciled against no providers. */
  announce(): void {
    if (this.read) this.emit(this.snapshot());
  }
  async flush(): Promise<void> {
    await this.queue;
  }
  close(): void {
    this.store.close();
  }
}
