import path from 'node:path';
import { expect, it } from 'vitest';
import { pdfProcessor } from '../src/desktop/transforms/pdf';

it.each([
  '/Applications/Viewer.app/Contents/Resources',
  '/Applications/viewer-processors-workspace/Viewer.app/Contents/Resources',
  '/tmp/viewer-processors-parent/viewer-processors-child/Resources',
])('finds bundled optimizers without rewriting their parent directory: %s', (resources) => {
  const processors = path.join(resources, 'viewer-processors-darwin-arm64');
  expect(pdfProcessor(processors)).toBe(
    path.join(resources, 'viewer-optimizers-darwin-arm64', 'qpdf'),
  );
});
