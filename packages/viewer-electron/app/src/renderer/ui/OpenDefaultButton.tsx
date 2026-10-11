import { useEffect, useState } from 'react';
import { report } from '../state/store';

const names = new Map<string, { until: number; promise: Promise<string | undefined> }>();
function applicationName(path: string): Promise<string | undefined> {
  const cached = names.get(path);
  if (cached && cached.until > Date.now()) return cached.promise;
  // Resolve only for an explicit open control, never for every file or passive plane.
  const promise = window.viewer.applications([path]).then((choices) => choices.defaultName);
  const item = { until: Date.now() + 30000, promise };
  names.set(path, item);
  void promise.catch(() => {
    if (names.get(path) === item) names.delete(path);
  });
  if (names.size > 32) names.delete(names.keys().next().value!);
  return promise;
}

export function OpenDefaultButton({
  path,
  onOpen,
  onError = report,
}: {
  path: string;
  onOpen?(): void;
  onError?(error: unknown): void;
}) {
  const [application, setApplication] = useState<{ path: string; name?: string }>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void applicationName(path).then(
      (name) => {
        if (live) setApplication({ path, name });
      },
      () => {
        if (live) setApplication({ path });
      },
    );
    return () => {
      live = false;
    };
  }, [path]);
  const name = application?.path === path ? application.name : undefined;
  const label = name ? `Open in ${name}` : 'Open';
  return (
    <button
      className="open-default-button"
      title={label}
      disabled={busy}
      onClick={() => {
        onOpen?.();
        setBusy(true);
        void window.viewer
          .openExternal(path)
          .catch(onError)
          .finally(() => setBusy(false));
      }}
    >
      {label}
    </button>
  );
}
