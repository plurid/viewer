import type { LocalServerLog } from '../../domain/previews/web';

export type LogStatus = 'all' | 'success' | 'redirect' | 'client-error' | 'server-error';

export function filterServerLogs(
  logs: readonly LocalServerLog[],
  query: string,
  method: string,
  status: LogStatus,
): readonly LocalServerLog[] {
  const text = query.trim().toLocaleLowerCase();
  return logs.filter((log) => {
    if (method !== 'all' && log.method !== method) return false;
    if (status === 'success' && (log.status < 200 || log.status >= 300)) return false;
    if (status === 'redirect' && (log.status < 300 || log.status >= 400)) return false;
    if (status === 'client-error' && (log.status < 400 || log.status >= 500)) return false;
    if (status === 'server-error' && log.status < 500 && !log.error) return false;
    return (
      !text ||
      `${log.method} ${log.path} ${log.status} ${log.error ?? ''}`
        .toLocaleLowerCase()
        .includes(text)
    );
  });
}
