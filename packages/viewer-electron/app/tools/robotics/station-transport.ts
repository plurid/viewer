import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { RobotRehearsalSession } from './rehearsal';
import { recordRobotRequests } from './rehearsal-transport';

/** A qualification transport cannot replenish its allowance through process restarts. */
export function stationTransport(
  root: string,
  request: typeof fetch,
  report: (event: Record<string, unknown>) => void = () => {},
): typeof fetch {
  const sessions = new Map<string, RobotRehearsalSession>();
  return async (input, options) => {
    const url = new URL(String(input));
    if (url.origin !== 'https://api.meta.ai') return request(input, options);
    if (url.pathname !== '/v1/chat/completions' || options?.method?.toUpperCase() !== 'POST')
      throw new Error('Only the approved Meta generation route is available during qualification.');
    const active = JSON.parse(await readFile(path.join(root, 'active-session.json'), 'utf8')) as {
      session: number;
    };
    if (!Number.isInteger(active.session) || active.session < 1 || active.session > 3)
      throw new Error('The approved three-session allowance is exhausted.');
    if ((await realpath(root)) !== root)
      throw new Error('The qualification root changed identity.');
    const budget = JSON.parse(await readFile(path.join(root, 'budget.json'), 'utf8'));
    if (budget.sessions !== 3 || budget.requestsPerSession !== 8)
      throw new Error('The station allowance must remain three sessions of eight requests.');
    const folder = path.join(root, 'sessions', String(active.session).padStart(2, '0'));
    await readFile(path.join(folder, 'started.json'), 'utf8');
    const files = await readdir(folder);
    if (files.includes('result.json')) {
      const continuations = files.includes('continuations')
        ? (await readdir(path.join(folder, 'continuations'))).sort()
        : [];
      const continuation = continuations.at(-1);
      if (!continuation || !/^\d{2}$/.test(continuation))
        throw new Error('This qualification session is finished.');
      const entries = await readdir(path.join(folder, 'continuations', continuation));
      if (!entries.includes('started.json') || entries.includes('result.json'))
        throw new Error('This qualification session is finished.');
    }
    if (!sessions.has(folder))
      sessions.set(
        folder,
        new RobotRehearsalSession(
          folder,
          8,
          files.filter((name) => /^request-\d{2}\.json$/.test(name)).length,
        ),
      );
    const session = sessions.get(folder)!;
    const secret = new Headers(options.headers).get('authorization')?.replace(/^Bearer /, '');
    const redact = (text: string) =>
      secret ? text.split(secret).join('[redacted API key]') : text;
    return recordRobotRequests(session, request, redact, (event) =>
      report({ stationSession: active.session, ...event }),
    )(input, options);
  };
}
