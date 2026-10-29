import { useEffect, useState } from 'react';
import { errorMessage } from '../../domain/errors';
import type { SQLiteReply, SQLiteRequest } from '../../domain/previews/data/sqlite';
import type { PreviewContext } from './contracts';

interface Answer {
  resource: string;
  request: SQLiteRequest;
  attempt: number;
  reply?: SQLiteReply;
  error?: string;
}
export interface SQLiteLoad {
  reply?: SQLiteReply;
  error: string;
  loading: boolean;
}

const unavailable = 'Database previews need the Viewer app.';
const slow = 'The database reader is taking longer than expected. Try again.';

/** One read of the granted database per resource, request and attempt. A desktop read cannot
 * be cancelled, so an answer for an older one is dropped rather than shown. */
export function useSQLite(
  context: PreviewContext,
  request: SQLiteRequest | undefined,
  attempt: number,
): SQLiteLoad {
  const [answer, setAnswer] = useState<Answer>();
  const resource = context.resource.id;
  const signal = context.signal;
  const read = context.services.sqlite;
  useEffect(() => {
    if (!request || !read) return;
    let alive = true;
    const settle = (result: Pick<Answer, 'reply' | 'error'>) => {
      if (!alive || signal.aborted) return;
      alive = false;
      clearTimeout(timer);
      setAnswer({ resource, request, attempt, ...result });
    };
    const timer = setTimeout(() => settle({ error: slow }), 20000);
    void read(resource, request).then(
      (reply) => settle({ reply }),
      (error: unknown) =>
        settle({ error: errorMessage(error) || 'The database could not be read.' }),
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [resource, signal, read, request, attempt]);
  if (!read) return { error: unavailable, loading: false };
  if (!request) return { error: '', loading: false };
  if (answer?.resource !== resource || answer.request !== request || answer.attempt !== attempt)
    return { error: '', loading: true };
  return { reply: answer.reply, error: answer.error ?? '', loading: false };
}
