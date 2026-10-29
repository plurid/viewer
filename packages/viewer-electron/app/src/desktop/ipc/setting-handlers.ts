import { shell, type BrowserWindow } from 'electron';
import type { ApiHandlers } from './schemas';
import type { SettingsService } from '../preferences/settings';
import type { Credentials } from '../models/providers';
import type { PersonalBackups } from '../persistence/backup';
import { confirmNatively } from '../native/native-confirmation';
import { openOnce, saveOnce, type DialogAccess } from '../native/dialogs';

type SettingHandlers = Pick<
  ApiHandlers,
  | 'settingsGet'
  | 'settingsPatch'
  | 'configOpen'
  | 'configValidate'
  | 'configRestore'
  | 'configTransfer'
  | 'backup'
>;
interface SettingPorts {
  settings: Pick<
    SettingsService,
    | 'load'
    | 'snapshot'
    | 'patch'
    | 'reload'
    | 'restoreConfiguration'
    | 'exportConfiguration'
    | 'importConfiguration'
  >;
  credentials: Pick<Credentials, 'load' | 'ids'>;
  backups: Pick<PersonalBackups, 'request'>;
  fileAccess: DialogAccess;
  window(owner: number): BrowserWindow | undefined;
  isSettings(owner: number): boolean;
}

/** Outside Settings, a patch is limited to what a workspace window may change. */
export function createSettingHandlers(ports: SettingPorts): SettingHandlers {
  return {
    settingsGet: async () => {
      await ports.settings.load();
      await ports.credentials.load();
      return ports.settings.snapshot(ports.credentials.ids());
    },
    settingsPatch: async ([patches, revision], owner) => ({
      ...(await ports.settings.patch(
        patches,
        revision,
        ports.isSettings(owner) ? undefined : 'workspace',
      )),
      credentials: ports.credentials.ids(),
    }),
    configOpen: async () => {
      await ports.settings.load();
      const error = await shell.openPath(ports.settings.snapshot().config!.path);
      if (error) throw new Error(error);
    },
    configValidate: () => ports.settings.reload(),
    configRestore: () => ports.settings.restoreConfiguration(),
    configTransfer: async ([direction], owner) => {
      if (direction === 'export') {
        const file = await saveOnce(ports.fileAccess, undefined, {
          title: 'Export configuration',
          defaultPath: 'config.jsonc',
        });
        if (file) await ports.settings.exportConfiguration(file);
      } else {
        const file = await openOnce(ports.fileAccess, undefined, {
          title: 'Import configuration',
          filters: [{ name: 'Configuration', extensions: ['jsonc', 'json'] }],
        });
        if (file)
          return ports.settings.importConfiguration(file, (changes) =>
            confirmNatively(
              ports.window(owner),
              'Import this configuration?',
              'It changes ' +
                changes.join('; ') +
                '.\n\nThe current config.jsonc is kept beside it as config.jsonc.before-import-….',
              'Import',
            ),
          );
      }
      return ports.settings.snapshot();
    },
    backup: ([request], owner) => ports.backups.request(request, owner),
  };
}
