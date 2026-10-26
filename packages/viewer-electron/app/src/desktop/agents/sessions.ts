import { createHash, randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  agentSessionSchema,
  sessionReportSchema,
  sessionSummary,
  type AgentSession,
  type SessionReport,
  type SessionRequest,
  type SessionReply,
} from '../../domain/agents/sessions';
import { DocumentStore } from '../persistence/document-store';

const schema = z
  .array(agentSessionSchema)
  .max(100)
  .refine(
    (value) => JSON.stringify(value).length <= 8 * 1024 * 1024,
    'Agent session storage reached its 8 MiB limit.',
  );
/** Explicit adapter reports only. Neither terminal output nor filesystem chat logs are scraped. */
export class AgentSessions {
  private store: DocumentStore<AgentSession[]>;
  private writing: Promise<unknown> = Promise.resolve();
  constructor(
    directory: string,
    private changed: (id: string) => void,
  ) {
    this.store = new DocumentStore(path.join(directory, 'agent-sessions-v1.json'), (value) =>
      schema.parse(value),
    );
  }
  report(
    clientID: string,
    clientName: string,
    input: SessionReport,
    authorize: (file: string) => Promise<string>,
  ): Promise<ReturnType<typeof sessionSummary>> {
    const work = this.writing
      .catch(() => {})
      .then(async () => {
        const report = sessionReportSchema.parse(input);
        const directory = await authorize(report.directory);
        const info = await lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink())
          throw new Error('Choose an ordinary session folder.');
        const identity = `${info.dev}:${info.ino}`;
        const entries = await Promise.all(
          report.entries.map(async (entry) => ({
            ...entry,
            ...(entry.links
              ? {
                  links: await Promise.all(
                    entry.links.map(async (link) => ({
                      ...link,
                      path: await authorize(link.path),
                    })),
                  ),
                }
              : {}),
          })),
        );
        // Repeat checks after asynchronous authorization; a grant can be revoked while a report waits.
        const current = await lstat(directory);
        if (
          (await authorize(directory)) !== directory ||
          `${current.dev}:${current.ino}` !== identity
        )
          throw new Error('The session folder changed. Report again.');
        const values = (await this.store.load()) ?? [];
        const existing = values.find(
          (value) => value.clientID === clientID && value.externalID === report.sessionID,
        );
        const hash = createHash('sha256').update(JSON.stringify(report)).digest('hex');
        if (existing) {
          if (existing.directory !== directory || existing.identity !== identity)
            throw new Error('This session belongs to another checkout. Use a new session ID.');
          if (report.sequence === existing.sequence && existing.reportHash === hash)
            return sessionSummary(existing);
          if (report.sequence <= existing.sequence)
            throw new Error('A newer session report is already stored.');
        } else if (values.length >= 100)
          throw new Error('Viewer supports up to 100 reported agent sessions.');
        const kept = [...(existing?.entries ?? [])];
        for (const entry of entries) {
          const previous = kept.find((value) => value.id === entry.id);
          if (previous && JSON.stringify(previous) !== JSON.stringify(entry))
            throw new Error('A reported message ID cannot be rewritten.');
          if (!previous) kept.push(entry);
        }
        const session: AgentSession = {
          id: existing?.id ?? randomUUID(),
          clientID,
          clientName,
          externalID: report.sessionID,
          directory,
          identity,
          title: report.title,
          sequence: report.sequence,
          status: report.status,
          updated: Date.now(),
          reportHash: hash,
          entries: kept,
        };
        await this.store.save(
          existing
            ? values.map((value) => (value.id === existing.id ? session : value))
            : [...values, session],
        );
        this.changed(session.id);
        return sessionSummary(session);
      });
    this.writing = work;
    return work;
  }
  async request(request: SessionRequest): Promise<SessionReply> {
    await this.writing.catch(() => {});
    const values = (await this.store.load()) ?? [];
    if (request.kind === 'list') {
      const directory = request.directory ? await realpath(request.directory) : undefined;
      return {
        kind: 'list',
        sessions: values
          .filter((value) => !directory || value.directory === directory)
          .sort((left, right) => right.updated - left.updated)
          .map(sessionSummary),
      };
    }
    const session = values.find((value) => value.id === request.id);
    if (!session) throw new Error('This agent session is unavailable.');
    return { kind: 'session', session };
  }
  flush() {
    return this.writing.then(
      () => {},
      () => {},
    );
  }
}
