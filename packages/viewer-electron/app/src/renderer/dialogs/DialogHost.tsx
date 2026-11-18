import { lazy, Suspense, useEffect, useState } from 'react';
import type { DialogPrompt, MessageDialogPrompt } from '../../domain/dialogs';
import { errorMessage } from '../../domain/errors';
import { Dialog } from '../ui/primitives';
import './dialogs.css';

const FilePicker = lazy(() => import('./FilePicker'));

export function DialogHost() {
  const [prompt, setPrompt] = useState<DialogPrompt | null>(null);
  useEffect(() => {
    let live = true;
    let received = false;
    const unsubscribe = window.viewer.onEvent((event) => {
      if (event.type !== 'dialog') return;
      received = true;
      if (live) setPrompt(event.prompt);
    });
    void window.viewer
      .dialog({ kind: 'current' })
      .then((reply) => {
        if (live && !received) setPrompt(reply.prompt ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  if (!prompt) return null;
  return prompt.kind === 'message' ? (
    <MessagePrompt key={prompt.id} prompt={prompt} />
  ) : (
    <Suspense fallback={null}>
      <FilePicker key={prompt.id} prompt={prompt} />
    </Suspense>
  );
}

/**
 * The buttons in a Mac's order, whatever order they were asked in: the default at the far right,
 * Cancel beside it, and any other choice, such as Don't Save, at the left.
 */
export function buttonOrder(
  prompt: Pick<MessageDialogPrompt, 'buttons' | 'defaultId' | 'cancelId'>,
): number[] {
  const indexes = prompt.buttons.map((_, index) => index);
  const others = indexes.filter((index) => index !== prompt.defaultId && index !== prompt.cancelId);
  const cancel =
    prompt.cancelId !== prompt.defaultId && indexes.includes(prompt.cancelId)
      ? [prompt.cancelId]
      : [];
  const fallback = indexes.includes(prompt.defaultId) ? [prompt.defaultId] : [];
  return [...others, ...cancel, ...fallback];
}
function MessagePrompt({ prompt }: { prompt: MessageDialogPrompt }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const answer = async (button: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await window.viewer.dialog({ kind: 'answer', id: prompt.id, button });
    } catch (error) {
      setError(errorMessage(error));
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={prompt.title}
      className="viewer-message-dialog"
      onClose={() => void answer(prompt.cancelId)}
    >
      <div className="viewer-message-copy">
        {prompt.title !== prompt.message && <strong>{prompt.message}</strong>}
        {prompt.detail && <p>{prompt.detail}</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer>
        {buttonOrder(prompt).map((index, place, order) => (
          <button
            key={index}
            disabled={busy}
            data-autofocus={index === prompt.defaultId || undefined}
            className={
              [
                index === prompt.destructiveId
                  ? 'danger'
                  : index === prompt.defaultId && index !== prompt.cancelId
                    ? 'primary'
                    : '',
                // a third choice such as Don't Save stands apart at the far left
                place === 0 && order.length > 2 && index !== prompt.cancelId
                  ? 'dialog-leading-action'
                  : '',
              ]
                .filter(Boolean)
                .join(' ') || undefined
            }
            onClick={() => void answer(index)}
          >
            {prompt.buttons[index]}
          </button>
        ))}
      </footer>
    </Dialog>
  );
}
