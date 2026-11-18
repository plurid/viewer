import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Dialog } from '../primitives';

/** What a removal or reset asks before it acts: its question, what it changes, and its button. */
export interface Confirmation {
  /** The question, as an alert's title: "Reset the Browsing settings?" */
  title: string;
  /** What changes, in plain words: the settings it resets, the item it removes. */
  detail: ReactNode;
  /** The action's own name on its danger button: "Reset", "Remove", "Revoke". */
  action: string;
  run(): void;
}

/**
 * A REMOVAL OR RESET that asks first, as a Mac does for what cannot be undone: a sheet that names
 * what changes, Cancel as its default, and the action in the danger ink. `ask` opens it; render
 * `dialog` once where the controls are.
 */
export function useConfirmation() {
  const [pending, setPending] = useState<Confirmation>();
  const close = () => setPending(undefined);
  const dialog = pending && (
    <Dialog title={pending.title} className="confirm-dialog" onClose={close}>
      <div className="dialog-copy">
        <p>{pending.detail}</p>
      </div>
      <footer>
        <Button variant="secondary" data-autofocus onClick={close}>
          Cancel
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            close();
            pending.run();
          }}
        >
          {pending.action}
        </Button>
      </footer>
    </Dialog>
  );
  return { ask: setPending, dialog };
}
