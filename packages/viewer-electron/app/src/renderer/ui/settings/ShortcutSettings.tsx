import {
  defaultShortcuts,
  isPreviewShortcut,
  menuShortcuts,
  pictureKeyPartner,
  previewShortcuts,
  resolvedShortcut,
  sharedPictureKey,
  shippedKeyHolder,
  shortcutGlyphs,
  shortcutKey,
  shortcutLabel,
  shortcutOwner,
} from '../../../domain/preferences/shortcuts';
import type { SettingsEditor } from './editor';
import { KeyCapture } from './KeyCapture';
import { KeymapSettings } from './KeymapSettings';

/**
 * Keyboard shortcuts for commands and menu items, each set by pressing it. Only the person's own
 * changes are saved: a key as shipped always comes from the keymap, so a key shipped differently
 * reaches everyone who never changed it, and a Reset or Reset All gives each command its shipped
 * key again, or none, said in its row, where the person gave that key to something else.
 */
export function ShortcutSettings({ editor }: { editor: SettingsEditor }) {
  const { snapshot, patch } = editor;
  const settings = snapshot.settings;
  const set = (id: string, value: string | undefined, shipped: string) => {
    const next = { ...settings.shortcuts };
    // pressing the shipped key again is no change of the person's own
    if (value === undefined || (!!value && shortcutKey(value) === shortcutKey(shipped)))
      delete next[id];
    else next[id] = value;
    patch('settings.shortcuts', next);
  };
  /** What a row says of its key: a key shared on purpose, or one left to the person's own. */
  const note = (id: string, value: string, shipped: string) => {
    const holder = id in settings.shortcuts ? undefined : shippedKeyHolder(settings, id);
    if (holder) return `${holder} uses ${shortcutGlyphs(shipped)}. Choose another key.`;
    if (!isPreviewShortcut(id)) {
      const picture = sharedPictureKey(settings, id);
      return picture ? `Over a picture, ${shortcutGlyphs(value)} turns it.` : '';
    }
    const partner = pictureKeyPartner(settings, id);
    return partner ? `Elsewhere, ${partner} uses ${shortcutGlyphs(value)}.` : '';
  };
  return (
    <>
      {/* a picture's own keys last: they answer only while a picture has the keyboard */}
      {Object.entries({ ...defaultShortcuts, ...menuShortcuts, ...previewShortcuts }).map(
        ([id, shortcut]) => {
          const label = shortcutLabel(id);
          const changed = id in settings.shortcuts;
          const value = resolvedShortcut(settings, id);
          const said = note(id, value, shortcut);
          return (
            // not a label: it would hand a click on the name to Reset
            <div className="settings-row" key={id}>
              <span>
                {label}
                {said && <small>{said}</small>}
              </span>
              <span className="shortcut-control">
                {changed && (
                  <button
                    type="button"
                    className="shortcut-reset"
                    aria-label={`Reset ${label}`}
                    title={`Back to ${shortcutGlyphs(shortcut) || 'none'}`}
                    onClick={(event) => {
                      event.preventDefault();
                      set(id, undefined, shortcut);
                    }}
                  >
                    Reset
                  </button>
                )}
                <KeyCapture
                  label={`${label} shortcut`}
                  kind="shortcut"
                  value={value}
                  owner={(chord) => shortcutOwner(settings, chord, id)}
                  onChange={(chord) => set(id, chord, shortcut)}
                />
              </span>
            </div>
          );
        },
      )}
      <div className="settings-actions">
        <button onClick={() => patch('settings.shortcuts', {})}>Reset All Shortcuts</button>
      </div>
      <KeymapSettings editor={editor} />
    </>
  );
}
