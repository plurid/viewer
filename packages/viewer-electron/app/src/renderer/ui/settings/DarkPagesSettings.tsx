import {
  clockTime,
  darkPageDefaults,
  type DarkPageSettings,
} from '../../../domain/previews/documents/dark-pages';
import { usePagesDark } from '../../previews/dark-pages';
import type { SettingsEditor } from './editor';

type NightEdge = Extract<keyof DarkPageSettings, 'darkPagesFrom' | 'darkPagesUntil'>;

/** An `HH:MM` time as the Mac shows times: 07:00, or 7:00 AM. */
function clockLabel(time: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Under Dark pages: the night's times when pages switch with them, and how pages are now, so the
 * choice is seen working. Off and On need neither.
 */
export function DarkPagesDetail({ editor }: { editor: SettingsEditor }) {
  const { snapshot, patch } = editor;
  const previews = snapshot.settings.previews;
  const mode = previews.darkPages ?? darkPageDefaults.darkPages;
  const from = previews.darkPagesFrom ?? darkPageDefaults.darkPagesFrom;
  const until = previews.darkPagesUntil ?? darkPageDefaults.darkPagesUntil;
  const dark = usePagesDark(previews, snapshot.systemLook ?? snapshot.look);
  if (mode !== 'night' && mode !== 'system') return null;
  const now =
    mode === 'system'
      ? dark
        ? 'macOS is in dark mode, so pages are dark now.'
        : 'macOS is in light mode, so pages are light now. With Appearance set to Auto in System Settings, macOS turns dark at sunset.'
      : from === until
        ? 'From and until are the same time, so pages stay light.'
        : dark
          ? `Pages are dark now, until ${clockLabel(until)}.`
          : `Pages turn dark at ${clockLabel(from)}.`;
  const edge = (field: NightEdge, label: string, value: string) => (
    <label>
      {label}
      <input
        type="time"
        aria-label={`Dark pages ${label.toLowerCase()}`}
        defaultValue={value}
        onChange={(event) => {
          const time = event.target.value;
          if (clockTime.test(time) && time !== value) patch('settings.previews.' + field, time);
        }}
      />
    </label>
  );
  return (
    <div className="settings-dark-pages">
      {mode === 'night' && (
        <div className="settings-dark-pages-times">
          {edge('darkPagesFrom', 'From', from)}
          {edge('darkPagesUntil', 'Until', until)}
        </div>
      )}
      <small role="status">{now}</small>
    </div>
  );
}
