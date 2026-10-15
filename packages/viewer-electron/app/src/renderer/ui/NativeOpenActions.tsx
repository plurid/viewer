import { useMemo, useState } from 'react';
import { OpenWithDialog } from './OpenWithDialog';
import { OpenDefaultButton } from './OpenDefaultButton';
import { errorMessage } from '../../domain/errors';

export function NativeOpenActions({ path }: { path: string }) {
  const paths = useMemo(() => [path], [path]);
  const [chooser, setChooser] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
      <div className="native-open-actions">
        <OpenDefaultButton
          path={path}
          onOpen={() => setError('')}
          onError={(error) => setError(errorMessage(error))}
        />
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
