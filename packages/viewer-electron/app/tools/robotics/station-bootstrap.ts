/** Qualification-only entry: bound provider recording, then the unchanged desktop application. */
import { createRequire } from 'node:module';
import path from 'node:path';
import { stationTransport } from './station-transport';

const root = process.env.VIEWER_STATION_RUN;
if (
  !root ||
  !path.isAbsolute(root) ||
  process.env.VIEWER_DATA_DIRECTORY !== path.join(root, 'Profile') ||
  process.env.VIEWER_RENDER_TEST !== '1' ||
  process.env.VIEWER_TEST_NO_REMOVAL !== '1' ||
  process.env.VIEWER_TEST_PRESERVE !== '1'
)
  throw new Error('The station qualification build needs its isolated preserved profile.');
globalThis.fetch = stationTransport(root, globalThis.fetch, (event) =>
  console.log(JSON.stringify(event)),
);

// The packaged entry and all permissions, canvas handlers and checks run without replacements.
createRequire(__filename)('./main.cjs');
