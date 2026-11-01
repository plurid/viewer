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
        {prompt.buttons.map((label, index) => (
          <button
            key={index}
            disabled={busy}
            data-autofocus={index === prompt.defaultId || undefined}
            className={
              index === prompt.destructiveId
                ? 'danger'
                : index === prompt.defaultId && index !== prompt.cancelId
                  ? 'primary'
                  : undefined
            }
            onClick={() => void answer(index)}
          >
            {label}
          </button>
        ))}
      </footer>
    </Dialog>
  );
}
