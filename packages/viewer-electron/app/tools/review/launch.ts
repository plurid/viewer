/**
 * Starting the packaged app for review: always in hidden windows (offscreen, out of the Dock, never
 * activated), on a generated profile, with the run's sample home as its home folder.
 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import { ownedApp, until } from '../../tests/owned-app';
import { pageCall } from '../../tests/native/runtime/page-function';
import type { ProfileTemplate } from './profile';

export type ReviewApp = Awaited<ReturnType<typeof ownedApp>>;
export type ReviewConnection = Awaited<ReturnType<ReviewApp['connect']>>;

/** Why the whole run must stop: the app did not start or did not quit cleanly. Retrying could
 * leave a crash report on the owner's screen, so a run never retries. */
export class RunStop extends Error {}

/** Starts the app on `profile`, which must lie inside the run's generated folder. */
export async function launchHidden(
  binary: string,
  profile: string,
  home: string,
): Promise<ReviewApp> {
  try {
    return await ownedApp(binary, profile, {
      mode: 'hidden',
      label: 'review',
      mockKeychain: true,
      environment: { HOME: home },
    });
  } catch (error) {
    throw new RunStop('The app did not start: ' + (error as Error).message);
  }
}

/** Quits the app; a quit that needs force stops the run. */
export async function quit(app: ReviewApp, connection?: ReviewConnection): Promise<void> {
  try {
    await app.close(connection);
  } catch (error) {
    throw new RunStop('The app did not quit cleanly: ' + (error as Error).message);
  }
}

/** What the first launch learns about the binary. */
export interface BinaryFacts {
  profile: ProfileTemplate;
  /** Whether it has the QA runtime's hooks: Trash and places in the sample home, the markers
   * and the command list. */
  qaHooks: boolean;
}

interface ReviewHookWindow {
  viewerReviewCommands?: unknown;
}

/** Starts the app once on an empty profile and keeps the settings it reports, and the saved-state
 * version it writes, as the template for every scene's profile (profile.ts says why). */
export async function readTemplate(
  root: string,
  home: string,
  binary: string,
): Promise<BinaryFacts> {
  const profile = path.join(root, 'Profiles', 'template');
  await mkdir(profile, { recursive: true });
  const app = await launchHidden(binary, profile, home);
  let connection: ReviewConnection | undefined;
  let snapshot: Pick<ProfileTemplate, 'settings' | 'ui'> | undefined;
  let failure: Error | undefined;
  let qaHooks = false;
  try {
    connection = await app.connect();
    snapshot = await connection.evaluate(
      pageCall(() =>
        window.viewer.settingsGet().then((value) => ({
          settings: value.settings as unknown as Record<string, unknown>,
          ui: value.ui as unknown as Record<string, unknown>,
        })),
      ),
    );
    const page = connection;
    // the window lists its commands once it has mounted, in builds that have the hook
    qaHooks = await until(
      () =>
        page.evaluate(
          pageCall(() => typeof (window as ReviewHookWindow).viewerReviewCommands === 'function'),
        ),
      Boolean,
      'QA runtime hooks',
      4000,
    ).catch(() => false);
  } catch (error) {
    failure = error as Error;
  }
  await quit(app, connection);
  if (!snapshot) throw new RunStop('The app’s own settings could not be read: ' + failure?.message);
  const saved = await readFile(path.join(profile, 'viewer-state-v1.json'), 'utf8')
    .then((text) => (JSON.parse(text) as { version?: unknown }).version)
    .catch(() => undefined);
  return {
    profile: {
      ...snapshot,
      stateVersion: typeof saved === 'number' ? saved : CURRENT_STATE_VERSION,
    },
    qaHooks,
  };
}
