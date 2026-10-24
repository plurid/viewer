import type { SettingsPatch, SettingsSnapshot } from '../../../domain/services';
import type { SettingsChange } from './settings-edits';

/** What a Settings page edits with: the latest snapshot and serialized, revision-checked writes. */
export interface SettingsEditor {
  snapshot: SettingsSnapshot;
  patch(path: string, value: unknown): void;
  patches(values: SettingsPatch[]): void;
  save(change: SettingsChange): void;
  error(message: string): void;
}
