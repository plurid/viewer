import { useEffect, useState } from 'react';
import { useViewer } from '../state/store';
import { needsOperationsAttention } from '../state/jobs';

/** Brief successful operations stay quiet; decisions and failures never wait. */
export function useOperationsIndicator(): boolean {
  const running = useViewer((state) =>
    state.jobs.some((job) => job.status === 'queued' || job.status === 'running'),
  );
  const immediate = useViewer((state) => state.operationsOpen || needsOperationsAttention(state));
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!running) {
      setElapsed(false);
      return;
    }
    const timer = setTimeout(() => setElapsed(true), 1000);
    return () => clearTimeout(timer);
  }, [running]);
  return immediate || (running && elapsed);
}
