import { z } from 'zod';

/** The largest feed and signature Viewer reads; a release feed is a few hundred bytes. */
export const feedLimits = { feed: 64 * 1024, signature: 1024, notes: 4000 } as const;
/** A launch check runs at most once in this interval. */
export const launchCheckInterval = 24 * 60 * 60 * 1000;

const release = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const system = /^\d{1,3}(?:\.\d{1,3}){0,2}$/;

/** What the release tooling publishes: one direct-download build, signed as these exact bytes. */
export const updateFeedSchema = z.object({
  version: z.string().regex(release),
  build: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  notes: z.string().trim().min(1).max(feedLimits.notes),
  url: z
    .string()
    .max(2048)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password;
      } catch {
        return false;
      }
    }, 'The download must be an https address.'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  minimumSystemVersion: z.string().regex(system),
});
export type UpdateFeed = z.infer<typeof updateFeedSchema>;

/** The version and build this copy of Viewer reports; development runs have no build. */
export interface InstalledRelease {
  version: string;
  build?: number;
}

export type UpdateDecision = 'available' | 'current' | 'unsupported-system';

/** Compares dotted numbers, such as 1.0.2 or macOS 14.5: a missing part counts as 0. */
export function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

/** A newer version, or the same version with a later build, is an update. */
export function updateDecision(
  feed: UpdateFeed,
  installed: InstalledRelease,
  systemVersion: string,
): UpdateDecision {
  const order = compareVersions(feed.version, installed.version);
  const newer =
    order > 0 || (order === 0 && installed.build !== undefined && feed.build > installed.build);
  if (!newer) return 'current';
  return compareVersions(systemVersion, feed.minimumSystemVersion) < 0
    ? 'unsupported-system'
    : 'available';
}

/** At most once a day. A clock set back past the last check makes one due again. */
export function launchCheckDue(lastChecked: number | undefined, now: number): boolean {
  return lastChecked === undefined || now < lastChecked || now - lastChecked >= launchCheckInterval;
}

/** The build a bundle reports as CFBundleVersion: a positive whole number, or none. */
export function bundleBuild(value: string | undefined): number | undefined {
  if (!value || !/^[1-9]\d{0,15}$/.test(value)) return undefined;
  const build = Number(value);
  return Number.isSafeInteger(build) ? build : undefined;
}
