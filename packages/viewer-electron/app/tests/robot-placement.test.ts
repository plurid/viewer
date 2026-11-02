import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRobotURDF } from '../src/domain/robotics/urdf';
import { solvePosition } from '../src/domain/robotics/solver';
import { placementBriefSchema } from '../src/domain/robotics/placement';
import type { PlacementStudy } from '../src/domain/robotics/placement';
import { checkPlacements } from '../src/desktop/robotics/placement';
import { Canvases } from '../src/desktop/canvases/service';
import { canvasPlacementReport, comparePlacements } from '../src/desktop/canvases/placement-check';
import { temporaryRoot } from '../tools/temporary';

const xml = await readFile(
  new URL('./fixtures/robotics/so101/so101_new_calib.urdf', import.meta.url),
  'utf8',
);
const robot = parseRobotURDF(xml);
const briefText = await readFile(
  new URL('./fixtures/robotics/station.json', import.meta.url),
  'utf8',
);
const brief = placementBriefSchema.parse(JSON.parse(briefText));
const study: PlacementStudy = { version: 1, reserved: [], candidates: [], selected: 'central' };
for (const mount of brief.mounts) {
  const poses = [];
  for (const target of brief.targets) {
    const solved = await solvePosition(robot, {
      ...brief.tool,
      base: mount.base,
      target: target.position,
      tolerance: brief.tolerance,
      positions: Object.fromEntries(
        robot.joints.filter((j) => j.type !== 'fixed').map((j) => [j.name, 0]),
      ),
    });
    poses.push({ targetID: target.id, positions: solved.positions });
  }
  study.candidates.push({ id: mount.id, poses });
}
const reserved: PlacementStudy['reserved'] = [{ min: [0.14, 0.12], max: [0.26, 0.24] }];
async function setup() {
  const root = await temporaryRoot('viewer-placement-');
  const canvases = new Canvases(root, { changed() {} });
  let doc = await canvases.create(1, randomUUID(), root);
  const bind = (name: string, text: string, revision: number) =>
    canvases.source(1, doc.id, revision, {
      path: '/' + name,
      version: { identity: name, size: text.length, modified: 1 },
      availability: 'available',
      facts: {},
      evidence: [{ source: 'text', text }],
      coverage: { content: 'complete' },
    });
  const source = await bind('arm.urdf', xml, 0);
  const task = await bind('station.json', briefText, source.revision);
  doc = await canvases.write(1, doc.id, task.revision, 'Station', '<p>Fixture</p>', { study });
  doc = await canvases.checkPlacements(
    1,
    doc.id,
    doc.revision,
    doc.stateRevision,
    source.source.id,
    task.source.id,
    'study',
  );
  return { root, canvases, doc };
}
describe('station placement study', () => {
  it('measures all six endpoints and changes recommendation when the central mount is reserved', () => {
    const before = checkPlacements(robot, brief, study);
    expect(before.candidates.map((c) => c.reached)).toEqual([3, 6, 6, 6]);
    expect(before.recommended).toBe('central');
    const after = checkPlacements(robot, brief, { ...study, reserved });
    expect(after.candidates[1]).toMatchObject({ reached: 6, allowed: false, passed: false });
    expect(after.recommended).toBe('front');
    expect(after.candidates[2]!.maximumError).toBeLessThan(0.001);
  });
  it('refuses missing mounts, changed target IDs, missing joints and claimed success flags', () => {
    expect(() =>
      checkPlacements(robot, brief, { ...study, candidates: study.candidates.slice(1) }),
    ).toThrow();
    const changed = structuredClone(study);
    changed.candidates[0]!.poses[0]!.targetID = 'invented';
    expect(() => checkPlacements(robot, brief, changed)).toThrow();
    changed.candidates[0]!.poses[0]!.targetID = 'A1';
    delete changed.candidates[0]!.poses[0]!.positions.shoulder_pan;
    expect(() => checkPlacements(robot, brief, changed)).toThrow();
    expect(() =>
      checkPlacements(robot, brief, { ...study, passed: true } as PlacementStudy),
    ).toThrow();
  });
  it('binds the brief, invalidates edited studies, compares only equal constraints and survives restart/import', async () => {
    const { root, canvases, doc } = await setup();
    expect(canvasPlacementReport(doc)).toMatchObject({ status: 'checked', recommended: 'central' });
    const modified = await canvases.state(1, doc.id, doc.stateRevision, doc.revision, {
      study: { ...study, reserved, selected: 'front' },
    });
    expect(canvasPlacementReport(modified)?.status).toBe('stale');
    const binding = doc.placementCheck!;
    const checked = await canvases.checkPlacements(
      1,
      doc.id,
      doc.revision,
      modified.stateRevision,
      binding.sourceID,
      binding.briefSourceID,
      'study',
    );
    let fork = await canvases.fork(1, doc.id, randomUUID());
    fork = await canvases.state(1, fork.id, 0, 0, {
      study: { ...study, reserved, selected: 'rear' },
    });
    fork = await canvases.checkPlacements(
      1,
      fork.id,
      0,
      fork.stateRevision,
      binding.sourceID,
      binding.briefSourceID,
      'study',
    );
    expect(comparePlacements(checked, fork).status).toBe('compared');
    const unequal = await canvases.state(1, fork.id, fork.stateRevision, fork.revision, { study });
    const unequalChecked = await canvases.checkPlacements(
      1,
      fork.id,
      unequal.revision,
      unequal.stateRevision,
      binding.sourceID,
      binding.briefSourceID,
      'study',
    );
    expect(comparePlacements(checked, unequalChecked).status).toBe('unavailable');
    await canvases.flush();
    const restarted = new Canvases(root, { changed() {} });
    expect(canvasPlacementReport(await restarted.read(1, doc.id))).toEqual(
      canvasPlacementReport(checked),
    );
    const folder = await canvases.export(1, doc.id, root);
    const imported = await restarted.import(
      1,
      path.join(folder, 'canvas.viewer.json'),
      randomUUID(),
    );
    expect(canvasPlacementReport(imported)).toEqual(canvasPlacementReport(checked));
    const output = path.join(root, 'check.json');
    await restarted.savePlacementCheck(
      1,
      doc.id,
      checked.revision,
      checked.stateRevision,
      async () => output,
    );
    expect(JSON.parse(await readFile(output, 'utf8')).recommended).toBe('front');
  });
});
