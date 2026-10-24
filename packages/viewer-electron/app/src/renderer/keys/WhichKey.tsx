import { bindingChoices, keyGlyphs, type KeymapBinding } from '../../domain/preferences/keymap';
import { getState } from '../state/store';
import { plainCommandID } from '../../domain/command-line/verbs';
import { useSequenceView } from './sequences';

/** A command id read as words, for a command not available here: `new-terminal-plane` → "new terminal plane". */
const words = (id: string) => id.replace(/^setting\./, '').replace(/[-.]/g, ' ');
const commandID = plainCommandID;
/**
 * WHICH-KEY (2026-10-23): while a sequence waits, the keys it can take next and what each does: a
 * command's label, a list's commands in order, or a chord's count of keys. Not a dialog, so the
 * commands it shows still run.
 */
export function WhichKey({
  label,
}: {
  label(id: string): { label: string; available: boolean } | undefined;
}) {
  const view = useSequenceView();
  if (!view.active || !view.shown) return null;
  const describe = (binding: KeymapBinding): { text: string; available: boolean } => {
    if (typeof binding === 'string' || Array.isArray(binding)) {
      const lines: readonly string[] = typeof binding === 'string' ? [binding] : binding;
      // a command's label; a line with words (2026-10-23) as it is written
      const steps = lines.map((line) => (commandID(line) ? label(line) : undefined));
      return {
        text: lines
          .map((line, index) => steps[index]?.label ?? (commandID(line) ? words(line) : line))
          .join(' → '),
        available: lines.every((line, index) => !commandID(line) || steps[index]?.available),
      };
    }
    return { text: `+${Object.keys(binding).length} keys`, available: true };
  };
  const prefix = getState().settings.settings.keymap.prefix;
  const mode = view.mode;
  const choices = view.node ? bindingChoices(view.node) : [];
  // as wide as the keys need: up to three columns of about eight rows
  const columns = Math.min(3, Math.max(1, Math.ceil(choices.length / 8)));
  return (
    <div className="which-key" role="status" aria-live="polite" aria-label="Key sequence">
      <div className="which-key-trail">
        {mode ? (
          // a mode's line, as vim's: it stays until Escape
          <>
            <span className="which-key-mode">-- {mode.toUpperCase()} --</span>
            {view.count && <kbd>{view.count}</kbd>}
            <span>Escape leaves</span>
          </>
        ) : (
          [...(view.help ? [] : prefix ? [prefix] : []), ...view.keys].map((key, index) => (
            <kbd key={index}>{keyGlyphs(key)}</kbd>
          ))
        )}
        {view.help && <span>Keys after {prefix ? keyGlyphs(prefix) : 'the leader'}</span>}
      </div>
      {view.message && !mode ? (
        <p className="which-key-message">{view.message}</p>
      ) : (
        <ul
          className="which-key-list"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(170px, auto))` }}
        >
          {choices.map(({ key, binding }) => {
            const { text, available } = describe(binding);
            return (
              <li
                key={key}
                data-chord={typeof binding === 'object' && !Array.isArray(binding)}
                data-available={available}
                title={available ? undefined : 'Not available here'}
              >
                <kbd>{keyGlyphs(key)}</kbd>
                <span>{text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
