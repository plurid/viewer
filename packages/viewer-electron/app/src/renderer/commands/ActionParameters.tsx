import { useEffect, useState, useSyncExternalStore } from 'react';
import { actionValues, type ActionInput, type ActionValues } from '../../domain/automation/actions';
import { errorMessage } from '../../domain/errors';
import { Dialog } from '../ui/primitives';
import { ChoiceButton } from '../ui/ChoiceMenu';

interface Request {
  title: string;
  inputs: ActionInput[];
  finish(value: ActionValues | undefined): void;
}
let pending: Request | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function requestParameters(
  title: string,
  inputs: ActionInput[],
): Promise<ActionValues | undefined> {
  if (!inputs.length) return Promise.resolve({});
  if (!listeners.size || pending)
    return Promise.reject(new Error('Finish the current command form first.'));
  return new Promise((resolve) => {
    pending = {
      title,
      inputs,
      finish(value) {
        pending = undefined;
        for (const listener of listeners) listener();
        resolve(value);
      },
    };
    for (const listener of listeners) listener();
  });
}
export function ActionParameters() {
  const request = useSyncExternalStore(subscribe, () => pending);
  return request ? <Parameters key={request.title} request={request} /> : null;
}
function Parameters({ request }: { request: Request }) {
  useEffect(
    () => () => {
      if (pending === request) request.finish(undefined);
    },
    [request],
  );
  const [values, setValues] = useState<ActionValues>(() =>
    Object.fromEntries(
      request.inputs.map((input) => [
        input.name,
        input.initial ?? (input.kind === 'boolean' ? 'false' : ''),
      ]),
    ),
  );
  const [error, setError] = useState('');
  return (
    <Dialog title={request.title} onClose={() => request.finish(undefined)}>
      <form
        className="command-parameters"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            request.finish(actionValues(request.inputs, values));
          } catch (value) {
            setError(errorMessage(value));
          }
        }}
      >
        {request.inputs.map((input, index) => (
          <label key={input.name}>
            <span>
              {input.label}
              {input.required ? ' *' : ''}
            </span>
            {input.kind === 'choice' ? (
              <ChoiceButton
                label={input.label}
                value={values[input.name] ?? ''}
                placeholder="Choose…"
                choices={(input.choices ?? []).map((value) => ({ value, label: value }))}
                onChoose={(value) => setValues({ ...values, [input.name]: value })}
              />
            ) : input.kind === 'boolean' ? (
              <input
                aria-label={input.label}
                type="checkbox"
                checked={values[input.name] === 'true'}
                data-autofocus={index === 0 || undefined}
                onChange={(event) =>
                  setValues({ ...values, [input.name]: String(event.target.checked) })
                }
              />
            ) : (
              <input
                aria-label={input.label}
                type={input.kind === 'number' ? 'number' : 'text'}
                step="any"
                required={input.required}
                maxLength={4000}
                data-autofocus={index === 0 || undefined}
                value={values[input.name]}
                onChange={(event) => setValues({ ...values, [input.name]: event.target.value })}
              />
            )}
          </label>
        ))}
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" onClick={() => request.finish(undefined)}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Run
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
