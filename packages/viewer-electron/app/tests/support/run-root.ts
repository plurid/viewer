/**
 * One folder for a test run's folders. Kept with VIEWER_TEST_PRESERVE=1, a run is one path to
 * review and move to the Trash; otherwise it goes to the Trash at the end, once every test has
 * moved its own folder there. A folder a test kept stays, with the run around it.
 */
import { readdirSync } from 'node:fs';
import { temporaryRoot, trashTemporary } from '../../tools/temporary';

export default async function setup(): Promise<(() => Promise<void>) | undefined> {
  if (process.env.VIEWER_TEST_RUN_ROOT) return undefined;
  const root = await temporaryRoot('viewer-run-');
  process.env.VIEWER_TEST_RUN_ROOT = root;
  return async () => {
    delete process.env.VIEWER_TEST_RUN_ROOT;
    if (readdirSync(root).length) {
      if (process.env.VIEWER_TEST_PRESERVE !== '1')
        console.warn(`Kept ${root}: a test kept folders inside it.`);
      return;
    }
    await trashTemporary(root);
  };
}
