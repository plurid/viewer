import type { CustomAction, TerminalProfile } from '../../../domain/automation/actions';
import type { SettingsPatch, SettingsSnapshot } from '../../../domain/services';
import { errorMessage } from '../../../domain/errors';

export type SettingsChange = (snapshot: SettingsSnapshot) => SettingsPatch[];

interface SettingsWriter {
  current(): SettingsSnapshot | undefined;
  write(patches: SettingsPatch[], revision: number): Promise<SettingsSnapshot>;
  refresh(): Promise<SettingsSnapshot>;
  accept(snapshot: SettingsSnapshot): void;
  error(message: string): void;
}

// Build the edit after the preceding write has settled. Rebasing only the revision would
// allow a stale replacement array/object to erase another field edited in the meantime.
export function saveSettingsChange(
  preceding: Promise<void>,
  writer: SettingsWriter,
  change: SettingsChange,
): Promise<void> {
  return preceding
    .catch(() => {})
    .then(async () => {
      const current = writer.current();
      if (!current) return;
      const patches = change(current);
      if (!patches.length) return;
      try {
        writer.accept(await writer.write(patches, current.revision));
      } catch (error) {
        writer.error(errorMessage(error));
        writer.accept(await writer.refresh());
      }
    })
    .catch((error) => writer.error(errorMessage(error)));
}

export function customActionEdit(
  id: string,
  update: Partial<CustomAction> | ((action: CustomAction) => Partial<CustomAction>),
): SettingsChange {
  return (snapshot) => {
    const actions = snapshot.settings.customActions;
    if (!actions.some((action) => action.id === id)) return [];
    return [
      {
        path: 'settings.customActions',
        value: actions.map((action) =>
          action.id === id
            ? { ...action, ...(typeof update === 'function' ? update(action) : update) }
            : action,
        ),
      },
    ];
  };
}

export function terminalProfilesEdit(
  update: (profiles: TerminalProfile[]) => TerminalProfile[],
): SettingsChange {
  return (snapshot) => [
    { path: 'settings.terminals.profiles', value: update(snapshot.settings.terminals.profiles) },
  ];
}

export function terminalProfileEdit(id: string, update: Partial<TerminalProfile>): SettingsChange {
  return (snapshot) =>
    snapshot.settings.terminals.profiles.some((profile) => profile.id === id)
      ? terminalProfilesEdit((profiles) =>
          profiles.map((profile) => (profile.id === id ? { ...profile, ...update } : profile)),
        )(snapshot)
      : [];
}
