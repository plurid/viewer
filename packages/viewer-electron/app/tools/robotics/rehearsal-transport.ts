import path from 'node:path';
import { providerResponseJSON } from '../../src/desktop/models/provider-response';
import { saveEvidence } from './rehearsal';
import type { RobotRehearsalSession } from './rehearsal';

/** Count actual requests before network I/O, including rejected and canceled responses. */
export function recordRobotRequests(
  session: RobotRehearsalSession,
  request: typeof fetch,
  redact: (text: string) => string,
  report: (event: {
    request: string;
    status: number | 'started';
    milliseconds?: number;
  }) => void = () => {},
): typeof fetch {
  return async (url, options) => {
    options?.signal?.throwIfAborted();
    const prefix = await session.reserveRequest({
      endpoint: redact(String(url)),
      body:
        typeof options?.body === 'string' ? (JSON.parse(redact(options.body)) as unknown) : null,
    });
    report({ request: path.basename(prefix), status: 'started' });
    const started = Date.now();
    let status: number | undefined;
    try {
      const response = await request(url, options);
      status = response.status;
      const envelope = await providerResponseJSON(
        response,
        options?.signal ?? AbortSignal.timeout(120_000),
      );
      // Raw provider envelopes preserve usage and rejected tool arguments for offline diagnosis.
      // Headers are deliberately omitted; they can contain credentials and account identifiers.
      await saveEvidence(prefix + '-response.json', {
        status,
        milliseconds: Date.now() - started,
        envelope: JSON.parse(redact(JSON.stringify(envelope))) as unknown,
      });
      report({ request: path.basename(prefix), status, milliseconds: Date.now() - started });
      return Response.json(envelope, { status });
    } catch (error) {
      await saveEvidence(prefix + '-error.json', {
        status,
        milliseconds: Date.now() - started,
        error: redact(String(error)),
      });
      throw error;
    }
  };
}
