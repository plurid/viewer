import { z } from 'zod';
import { feedLimits, launchCheckDue, updateDecision } from '../../domain/updates/feed';
import type { InstalledRelease, UpdateFeed } from '../../domain/updates/feed';
import { alphaVersionSchema, compareAlphaVersions } from '../../domain/updates/version';
import { DocumentStore } from '../persistence/document-store';
import { syncParentDirectory } from '../persistence/directory-sync';
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
  /** True for Download, false for dismissal, undefined if the window could not collect a response. */
  present(notice: UpdateNotice): Promise<boolean | undefined>;
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
    /** The last available release selected for notification. */
    announced: z.number().int().positive().optional(),
    announcedVersion: alphaVersionSchema.optional(),
    /** Existing records omit this flag. They keep their prior suppression of repeat notices. */
    announcementPending: z.literal(true).optional(),
    verified: z
      .object({ version: alphaVersionSchema, build: z.number().int().positive() })
      .optional(),
  })
  .strict()
  .refine(
    (state) =>
      !state.announcementPending ||
      (state.announced !== undefined && state.announcedVersion !== undefined),
    {
      message: 'A pending update notice needs its release version and build.',
    },
  );
type UpdateState = z.infer<typeof stateSchema>;
type Presentation = 'shown' | 'suppressed' | 'interrupted';

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

/** What a check tells the person. A launch check shows only an available update. */
export function updateNotice(
  check: UpdateCheck,
  installed: InstalledRelease,
  systemVersion: string,
): UpdateNotice {
  const installedName =
    installed.build === undefined ? installed.version : `${installed.version} (${installed.build})`;
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
        detail: `Version ${installedName} is the latest version.`,
      };
    case 'available':
      return {
        message: `Viewer ${check.feed.version} is available`,
        detail: `You have version ${installedName}.\n\n${check.feed.notes}`,
        download: check.feed.url,
      };
    case 'unsupported-system':
      return {
        message: `Viewer ${check.feed.version} needs macOS ${check.feed.minimumSystemVersion} or later`,
        detail: `This Mac has macOS ${systemVersion}. Version ${installedName} keeps working.`,
      };
    case 'failed':
      return { message: 'Viewer could not check for updates', detail: check.message };
  }
}

/**
 * Check for Updates and the quiet launch check, against one signed feed (domain/updates/feed.ts).
 * Download opens the HTTPS address in the browser. Launch checks stay quiet for failures and
 * for releases with a recorded response.
 */
export class Updates {
  private running?: Promise<UpdateCheck>;
  private presenting?: { check: UpdateCheck; result: Promise<Presentation> };
  private verified?: UpdateState['verified'];
  private durableRevision?: string;
  private pendingRevision?: string;
  private historyWrites: Promise<unknown> = Promise.resolve();
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
    const check = this.presenting?.check ?? (await this.check());
    // A shared launch presentation can finish without showing an already announced release.
    if ((await this.present(check)) === 'suppressed') await this.present(check);
  }

  /** At most once a day, unless turned off in Settings; never in the Store edition. */
  async checkAtLaunch(): Promise<UpdateCheck | undefined> {
    if (this.host.store || !this.configured || !this.host.checkAtLaunch()) return undefined;
    const now = (this.host.now ?? Date.now)();
    const due = await this.updateHistory((state) =>
      launchCheckDue(state.checked, now) ? { ...state, checked: now } : undefined,
    ).catch(() => false);
    if (!due) return undefined;
    const check = await this.check();
    if (check.kind === 'available') await this.present(check, true);
    return check;
  }

  private async historySnapshot() {
    const { value, revision } = await this.state.loadSnapshot();
    const state = value ?? { version: 1 as const };
    this.rememberVerified(state.verified);
    return { state, revision };
  }

  private rememberVerified(release: UpdateState['verified']) {
    if (release && (!this.verified || this.compareVerified(release, this.verified) > 0))
      this.verified = release;
  }

  private compareVerified(
    a: NonNullable<UpdateState['verified']>,
    b: NonNullable<UpdateState['verified']>,
  ) {
    return compareAlphaVersions(a.version, b.version) || a.build - b.build;
  }

  private updateHistory(change: (state: UpdateState) => UpdateState | undefined): Promise<boolean> {
    const write = this.historyWrites
      .catch(() => undefined)
      .then(async () => {
        const { state, revision } = await this.historySnapshot();
        const next = change(state);
        // A visible record may have been published before a failed sync, even in another session.
        const unchangedNeedsSync = !next && revision !== this.durableRevision;
        const confirm = this.pendingRevision ?? (unchangedNeedsSync ? revision : null);
        if (confirm) {
          await syncParentDirectory(this.state.file);
          const after = await this.historySnapshot();
          this.pendingRevision = undefined;
          if (after.revision !== confirm || revision !== confirm) {
            this.durableRevision = undefined;
            throw new Error('The saved update history changed while it was being confirmed.');
          }
          this.durableRevision = confirm;
        }
        if (!next) return false;
        if (
          this.verified &&
          (!next.verified || this.compareVerified(next.verified, this.verified) < 0)
        )
          next.verified = this.verified;
        await this.state.save(next, revision, (newRevision) => {
          this.pendingRevision = newRevision;
          this.durableRevision = undefined;
          this.rememberVerified(next.verified);
        });
        this.durableRevision = this.pendingRevision;
        this.pendingRevision = undefined;
        return true;
      });
    this.historyWrites = write;
    return write;
  }

  private present(check: UpdateCheck, quiet = false): Promise<Presentation> {
    this.presenting ??= {
      check,
      result: this.show(check, quiet).finally(() => {
        this.presenting = undefined;
      }),
    };
    return this.presenting.result;
  }

  private async prepareAnnouncement(feed: UpdateFeed): Promise<boolean> {
    let pending = false;
    const created = await this.updateHistory((state) => {
      this.releaseOrder(feed, state);
      const order =
        (state.announcedVersion && compareAlphaVersions(feed.version, state.announcedVersion)) ||
        feed.build - (state.announced ?? 0);
      if (order > 0)
        return {
          ...state,
          announced: feed.build,
          announcedVersion: feed.version,
          announcementPending: true,
        };
      pending = order === 0 && state.announcementPending === true;
    });
    return created || pending;
  }

  private async recordDelivery(feed: UpdateFeed) {
    const delivered = (state: UpdateState): UpdateState | undefined => {
      if (
        state.announcementPending &&
        state.announced === feed.build &&
        state.announcedVersion === feed.version
      )
        return { ...state, announcementPending: undefined };
    };
    try {
      await this.updateHistory(delivered);
    } catch {
      // Retry the response without reopening the dialog. Download still honors the person's choice.
      await this.updateHistory(delivered).catch(() => {});
    }
  }

  private async show(check: UpdateCheck, quiet: boolean): Promise<Presentation> {
    let announcement: UpdateFeed | undefined;
    if (check.kind === 'available') {
      try {
        if (await this.prepareAnnouncement(check.feed)) announcement = check.feed;
        else if (quiet) return 'suppressed';
      } catch {
        if (quiet) return 'suppressed';
        check = {
          kind: 'failed',
          problem: 'invalid',
          message: 'The saved update history changed or could not be read.',
        };
      }
    }
    const notice = updateNotice(check, this.host.installed, this.host.systemVersion());
    const download = await this.host.present(notice);
    if (download === undefined) return 'interrupted';
    if (announcement) await this.recordDelivery(announcement);
    if (download && notice.download) await this.host.open(notice.download);
    return 'shown';
  }

  private releaseOrder(feed: UpdateFeed, state: UpdateState) {
    const order = state.verified
      ? compareAlphaVersions(feed.version, state.verified.version) ||
        feed.build - state.verified.build
      : (state.announcedVersion && compareAlphaVersions(feed.version, state.announcedVersion)) ||
        feed.build - (state.announced ?? 0);
    if (order < 0 || (this.verified && this.compareVerified(feed, this.verified) < 0))
      throw new UpdateError(
        'invalid',
        'The update server returned an older release than Viewer already verified.',
      );
    return order;
  }

  private async read(): Promise<UpdateCheck> {
    if (this.host.store) return { kind: 'store' };
    const endpoint = this.endpoint;
    if (!endpoint) return { kind: 'not-configured' };
    try {
      const initial = await this.historySnapshot();
      const parsed = await fetchFeed(endpoint, this.host.request ?? fetch);
      this.releaseOrder(parsed, initial.state);
      await this.updateHistory((state) => {
        const order = this.releaseOrder(parsed, state);
        return !state.verified || order > 0
          ? { ...state, verified: { version: parsed.version, build: parsed.build } }
          : undefined;
      });
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
