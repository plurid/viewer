import { z } from 'zod';
import { feedLimits, launchCheckDue, updateDecision } from '../../domain/updates/feed';
import type { InstalledRelease, UpdateFeed } from '../../domain/updates/feed';
import { DocumentStore } from '../persistence/document-store';
import type { UpdateFeedConfiguration } from '../release';
import { UpdateError, feedEndpoint, httpsAddress, readSignedFeed } from './signature';
import type { FeedEndpoint, UpdateProblem } from './signature';

export type UpdateCheck =
  | { kind: 'store' }
  | { kind: 'not-configured' }
  | { kind: 'current'; feed: UpdateFeed }
  | { kind: 'available'; feed: UpdateFeed }
  | { kind: 'unsupported-system'; feed: UpdateFeed }
  | { kind: 'failed'; problem: UpdateProblem; message: string };

/** A native dialog's text. With `download`, it offers Download and Later. */
export interface UpdateNotice {
  message: string;
  detail: string;
  download?: string;
}

export interface UpdateHost {
  configuration: UpdateFeedConfiguration;
  /** The Mac App Store edition, which the Store updates. */
  store: boolean;
  installed: InstalledRelease;
  systemVersion(): string;
  /** `settings.updates.checkAtLaunch`. */
  checkAtLaunch(): boolean;
  /** Shows the notice; true when the person chose Download. */
  present(notice: UpdateNotice): Promise<boolean>;
  /** Opens the https download in the browser. */
  open(url: string): Promise<void>;
  request?: typeof fetch;
  now?: () => number;
}

const stateSchema = z
  .object({
    version: z.literal(1),
    /** When the last launch check started. */
    checked: z.number().nonnegative().optional(),
    /** The build a launch check last showed, so one release is shown once. */
    announced: z.number().int().positive().optional(),
  })
  .strict();
type UpdateState = z.infer<typeof stateSchema>;

const redirects = [301, 302, 303, 307, 308];

async function download(
  request: typeof fetch,
  address: URL,
  limit: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  let url = address;
  for (let hop = 0; hop < 5; hop++) {
    let response: Response;
    try {
      response = await request(url, { signal, redirect: 'manual' });
    } catch {
      throw new UpdateError(
        'network',
        'The update server could not be reached. Check your connection and try again.',
      );
    }
    if (redirects.includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) break;
      try {
        url = httpsAddress(new URL(location, url).href, 'update address');
      } catch {
        throw new UpdateError(
          'network',
          'The update server redirected to an address that is not https.',
        );
      }
      continue;
    }
    if (!response.ok || !response.body)
      throw new UpdateError('network', `The update server answered ${response.status}.`);
    if (Number(response.headers.get('content-length') ?? 0) > limit) {
      await response.body.cancel();
      throw new UpdateError('invalid', 'The update information is larger than Viewer accepts.');
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > limit)
          throw new UpdateError('invalid', 'The update information is larger than Viewer accepts.');
        chunks.push(chunk);
      }
    } catch (error) {
      if (error instanceof UpdateError) throw error;
      throw new UpdateError('network', 'The update download stopped before it finished.');
    }
    return Buffer.concat(chunks);
  }
  throw new UpdateError('network', 'The update server redirected too many times.');
}

/** The feed at `endpoint`, read only once its signature matches the embedded key. */
export async function fetchFeed(
  endpoint: FeedEndpoint,
  request: typeof fetch,
): Promise<UpdateFeed> {
  const signal = AbortSignal.timeout(20000);
  const [feed, signature] = await Promise.all([
    download(request, endpoint.feed, feedLimits.feed, signal),
    download(request, endpoint.signature, feedLimits.signature, signal),
  ]);
  return readSignedFeed(feed, Buffer.from(signature).toString('utf8'), endpoint.key);
}

const release = (installed: InstalledRelease) =>
  installed.build === undefined ? installed.version : `${installed.version} (${installed.build})`;

/** What a check tells the person. A launch check shows only an available update. */
export function updateNotice(
  check: UpdateCheck,
  installed: InstalledRelease,
  systemVersion: string,
): UpdateNotice {
  switch (check.kind) {
    case 'store':
      return {
        message: 'The App Store keeps Viewer up to date',
        detail: 'Open the App Store to check for a newer version.',
      };
    case 'not-configured':
      return {
        message: 'Updates are not configured for this build',
        detail:
          'This copy of Viewer has no update feed. Check the Viewer website for new versions.',
      };
    case 'current':
      return {
        message: 'Viewer is up to date',
        detail: `Version ${release(installed)} is the latest version.`,
      };
    case 'available':
      return {
        message: `Viewer ${check.feed.version} is available`,
        detail: `You have version ${release(installed)}.\n\n${check.feed.notes}`,
        download: check.feed.url,
      };
    case 'unsupported-system':
      return {
        message: `Viewer ${check.feed.version} needs macOS ${check.feed.minimumSystemVersion} or later`,
        detail: `This Mac has macOS ${systemVersion}. Version ${release(installed)} keeps working.`,
      };
    case 'failed':
      return { message: 'Viewer could not check for updates', detail: check.message };
  }
}

/**
 * Check for Updates and the quiet launch check, against one signed feed (domain/updates/feed.ts).
 * Nothing is downloaded or installed: an update opens its https download in the browser. A launch
 * check never reports a failure and shows each release once.
 */
export class Updates {
  private running?: Promise<UpdateCheck>;
  private readonly state: DocumentStore<UpdateState>;
  private readonly endpoint?: FeedEndpoint;
  private readonly configured: boolean;

  constructor(
    file: string,
    private readonly host: UpdateHost,
  ) {
    this.state = new DocumentStore(file, (value) => stateSchema.parse(value));
    try {
      this.endpoint = feedEndpoint(host.configuration);
    } catch {
      // A build with an invalid feed has none; the release tooling refuses to sign one.
      this.endpoint = undefined;
    }
    this.configured = !!this.endpoint;
  }

  check(): Promise<UpdateCheck> {
    this.running ??= this.read().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  async checkFromMenu(): Promise<void> {
    const notice = updateNotice(await this.check(), this.host.installed, this.host.systemVersion());
    if ((await this.host.present(notice)) && notice.download) await this.host.open(notice.download);
  }

  /** At most once a day, unless turned off in Settings; never in the Store edition. */
  async checkAtLaunch(): Promise<UpdateCheck | undefined> {
    if (this.host.store || !this.configured || !this.host.checkAtLaunch()) return undefined;
    const state = (await this.state.load().catch(() => null)) ?? { version: 1 as const };
    const now = (this.host.now ?? Date.now)();
    if (!launchCheckDue(state.checked, now)) return undefined;
    await this.state.save({ ...state, checked: now }).catch(() => {});
    const check = await this.check();
    if (check.kind !== 'available' || state.announced === check.feed.build) return check;
    await this.state.save({ ...state, checked: now, announced: check.feed.build }).catch(() => {});
    const notice = updateNotice(check, this.host.installed, this.host.systemVersion());
    if ((await this.host.present(notice)) && notice.download) await this.host.open(notice.download);
    return check;
  }

  private async read(): Promise<UpdateCheck> {
    if (this.host.store) return { kind: 'store' };
    const endpoint = this.endpoint;
    if (!endpoint) return { kind: 'not-configured' };
    try {
      const parsed = await fetchFeed(endpoint, this.host.request ?? fetch);
      return {
        kind: updateDecision(parsed, this.host.installed, this.host.systemVersion()),
        feed: parsed,
      };
    } catch (error) {
      if (error instanceof UpdateError)
        return { kind: 'failed', problem: error.problem, message: error.message };
      return {
        kind: 'failed',
        problem: 'invalid',
        message: 'The update information could not be read.',
      };
    }
  }
}
