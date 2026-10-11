import { useMemo, useState } from 'react';
import { OpenWithDialog } from './OpenWithDialog';

export function NativeOpenActions({ path }: { path: string }) {
  const paths = useMemo(() => [path], [path]);
  const [chooser, setChooser] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
      <div className="native-open-actions">
        <button
          onClick={() => {
            setError('');
            void window.viewer
              .openExternal(path)
              .catch((error) => setError(error instanceof Error ? error.message : String(error)));
          }}
        >
          Open in Default App
        </button>
        <button onClick={() => setChooser(true)}>Open With…</button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {chooser && <OpenWithDialog paths={paths} onClose={() => setChooser(false)} />}
    </>
  );
}
