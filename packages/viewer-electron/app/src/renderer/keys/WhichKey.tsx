import { bindingChoices, keyGlyphs, type KeymapBinding } from '../../domain/keymap';
import { getState } from '../state/store';
import { useSequenceView } from './sequences';

/** A command id read as words, for a command not available here: `new-terminal-plane` → "new terminal plane". */
const words = (id: string) => id.replace(/^setting\./, '').replace(/[-.]/g, ' ');
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
    if (typeof binding === 'string') {
      const found = label(binding);
      return { text: found?.label ?? words(binding), available: found?.available ?? false };
    }
    if (Array.isArray(binding)) {
      const steps = binding.map((id) => label(id));
      return {
        text: binding.map((id, index) => steps[index]?.label ?? words(id)).join(' → '),
        available: steps.every((step) => step?.available),
      };
    }
    return { text: `+${Object.keys(binding).length} keys`, available: true };
  };
  const prefix = getState().settings.settings.keymap.prefix;
  const choices = view.node ? bindingChoices(view.node) : [];
  // as wide as the keys need: up to three columns of about eight rows
  const columns = Math.min(3, Math.max(1, Math.ceil(choices.length / 8)));
  return (
    <div className="which-key" role="status" aria-live="polite" aria-label="Key sequence">
      <div className="which-key-trail">
        {[...(view.help ? [] : prefix ? [prefix] : []), ...view.keys].map((key, index) => (
          <kbd key={index}>{keyGlyphs(key)}</kbd>
        ))}
        {view.help && <span>Keys after {prefix ? keyGlyphs(prefix) : 'the leader'}</span>}
      </div>
      {view.message ? (
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
