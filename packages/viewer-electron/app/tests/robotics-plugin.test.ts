import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildRoboticsPlugin } from '../tools/plugins/robotics/build';
import type { createWorkbench } from '../tools/plugins/robotics/library';
import { temporaryRoot } from '../tools/temporary';

describe('reusable robotics plugin', () => {
  it('runs the existing calculations from its portable module and rechecks saved results', async () => {
    const built = await buildRoboticsPlugin();
    expect(built.html).not.toMatch(/viewer\/robotics|requestPlacementCheck|data\.robot/);
    expect(built.modules.some((name) => name.endsWith('/core/solver.ts'))).toBe(true);
    expect(built.modules.some((name) => name.endsWith('/core/check.ts'))).toBe(true);
    const root = await temporaryRoot('viewer-plugin-module-');
    const file = path.join(root, 'robotics.mjs');
    await writeFile(file, built.library, { flag: 'wx' });
    const module = (await import(pathToFileURL(file).href)) as {
      createWorkbench: typeof createWorkbench;
    };
    const xml = await readFile(
      new URL('./fixtures/robotics/so101/so101_new_calib.urdf', import.meta.url),
      'utf8',
    );
    const brief = JSON.parse(
      await readFile(new URL('./fixtures/robotics/station.json', import.meta.url), 'utf8'),
    );
    const tool = module.createWorkbench(xml, brief);
    expect(tool.selfTest().passed).toBe(true);
    const initial = await tool.evaluate({ reserved: false, targetOffsetX: 0 });
    expect(initial.recommended).toBe('central');
    expect(tool.check(initial.candidates, false, 0)).toEqual(initial);
    expect(tool.check(initial.candidates, true, 0).recommended).toBe('front');
    const forged = structuredClone(initial.candidates);
    forged[0]!.poses[0]!.actual = [100, 100, 100];
    forged[0]!.poses[0]!.residual = 0;
    forged[0]!.poses[0]!.withinTolerance = true;
    expect(tool.check(forged, false, 0)).toEqual(initial);
    const abort = new AbortController();
    abort.abort();
    await expect(
      tool.evaluate({ reserved: false, targetOffsetX: 0 }, abort.signal),
    ).rejects.toThrow();
  });
});
