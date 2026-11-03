import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseRobotURDF } from '../src/domain/robotics/urdf';
import { forwardKinematics } from '../src/domain/robotics/kinematics';
import { solvePosition } from '../src/domain/robotics/solver';
import { placementBriefSchema } from '../src/domain/robotics/placement';
import type { CanvasActionInput } from '../src/domain/canvases/actions';
import { reviewStationPlugin } from '../tools/robotics/station-review';
import { stationPrompts } from '../tools/robotics/station-contract';
import type { StationStudy } from '../tools/robotics/station-contract';
import { qualifiedStationArtifact } from '../tools/robotics/station-evidence';
import { digest } from '../tools/robotics/rehearsal';

describe('saved artifact acceptance', () => {
  const canvas = {
    version: 2,
    id: randomUUID(),
    conversationID: randomUUID(),
    path: '/project',
    title: 'Plugin',
    revision: 2,
    html: '<main>Model revision</main>',
    defaults: {},
    state: {},
    stateRevision: 0,
    assets: [],
    sources: [],
    history: [],
    at: 1,
  };
  const result = { status: 'failed', canvasID: canvas.id, canvas };
  const review = {
    status: 'passed',
    canvasID: canvas.id,
    revision: canvas.revision,
    htmlHash: digest(canvas.html),
    conversationStatus: 'failed',
    finalReply: false,
  };
  it('retains an interrupted reply while accepting its independently reviewed artifact', () => {
    expect(qualifiedStationArtifact(result, review).finalReply).toBe(false);
    expect(result.status).toBe('failed');
  });
  it('refuses unreviewed, different, locally substituted or unfinished artifacts', () => {
    expect(() => qualifiedStationArtifact(result, { ...review, status: 'failed' })).toThrow();
    expect(() => qualifiedStationArtifact(result, { ...review, revision: 3 })).toThrow();
    expect(() => qualifiedStationArtifact(result, { ...review, canvasID: randomUUID() })).toThrow();
    expect(() =>
      qualifiedStationArtifact({ ...result, canvas: { ...canvas, html: 'substitute' } }, review),
    ).toThrow();
    expect(() => qualifiedStationArtifact({ ...result, status: 'running' }, review)).toThrow();
  });
});

// An explicitly handwritten mock tests the reviewer, not Meta generation.
const xml = await readFile(
  new URL('./fixtures/robotics/so101/so101_new_calib.urdf', import.meta.url),
  'utf8',
);
const model = parseRobotURDF(xml);
const brief = placementBriefSchema.parse(
  JSON.parse(await readFile(new URL('./fixtures/robotics/station.json', import.meta.url), 'utf8')),
);
const zero = Object.fromEntries(
  model.joints.filter((joint) => joint.type !== 'fixed').map((joint) => [joint.name, 0]),
);
const solutions = new Map<number, StationStudy['candidates']>();
for (const offset of [0, 0.013]) {
  const candidates: StationStudy['candidates'] = [];
  for (const mount of brief.mounts) {
    const poses = [];
    for (const target of brief.targets) {
      const position: [number, number, number] = [
        target.position[0] + offset,
        target.position[1],
        target.position[2],
      ];
      const solved = await solvePosition(model, {
        ...brief.tool,
        base: mount.base,
        target: position,
        tolerance: brief.tolerance,
        positions: zero,
      });
      const fk = forwardKinematics(model, solved.positions, mount.base);
      const actual = fk.links[brief.tool.link]!.slice(12, 15) as [number, number, number];
      const residual = Math.hypot(...actual.map((v, i) => v - position[i]!));
      poses.push({
        targetID: target.id,
        positions: solved.positions,
        actual,
        residual,
        withinTolerance: residual <= brief.tolerance,
        violations: fk.violations.map((v) => v.joint),
      });
    }
    candidates.push({
      id: mount.id,
      poses,
      eligible: poses.every((pose) => pose.withinTolerance && !pose.violations.length),
      movement: Math.hypot(...mount.base.xyz.map((v, i) => v - brief.reference[i]!)),
    });
  }
  solutions.set(offset, candidates);
}

function inspect(input: CanvasActionInput) {
  const positions = JSON.parse(String(input.joints)) as Record<string, number>;
  const altered = structuredClone(model);
  if (input.limitJoint)
    altered.joints.find((j) => j.name === input.limitJoint)!.limit = {
      lower: Number(input.limitLower),
      upper: Number(input.limitUpper),
    };
  const pose = forwardKinematics(
    altered,
    positions,
    brief.mounts.find((m) => m.id === input.mount)!.base,
  );
  const actual = pose.links[brief.tool.link]!.slice(12, 15);
  const target = [input.targetX, input.targetY, input.targetZ].map(Number);
  const residual = Math.hypot(...actual.map((v, i) => v - target[i]!));
  return {
    actual,
    residual,
    withinTolerance: residual <= Number(input.tolerance),
    violations: pose.violations.map((v) => v.joint),
  };
}
const good = async (action: string, input: CanvasActionInput): Promise<unknown> => {
  if (action === 'selfTest')
    return {
      passed: true,
      tests: ['transform', 'limits', 'residual'].map((name) => ({ name, passed: true })),
    };
  if (action === 'inspectPose') return inspect(input);
  if (action !== 'evaluate') throw new Error('Unexpected action');
  const candidates = structuredClone(solutions.get(Number(input.targetOffsetX))!);
  if (input.reserved) candidates.find((item) => item.id === 'central')!.eligible = false;
  return {
    candidates,
    recommended:
      candidates.filter((c) => c.eligible).sort((a, b) => a.movement - b.movement)[0]?.id ?? null,
  };
};

describe('external generated-plugin qualification', () => {
  it('checks source-derived poses, changed targets and joint limits without a host robotics API', async () => {
    for (const reserved of [false, true]) {
      const report = await reviewStationPlugin(good, xml, brief, reserved);
      expect(report.status).toBe('passed');
      expect(report.baseline.recommended).toBe(reserved ? 'front' : 'central');
      expect(report.perturbed.candidates.some((c) => c.eligible)).toBe(true);
    }
    expect(stationPrompts.create).not.toMatch(
      /viewer\/robotics|requestRobotCheck|requestPlacementCheck|228\.04|295\.30|3, ?6, ?6, ?6/,
    );
  });

  it.each([
    'fixed-success',
    'wrong-transform',
    'ignored-limit',
    'missing-target',
    'invented-movement',
    'stale-targets',
  ])('rejects %s even when the plugin reports passing self-tests', async (fault) => {
    const invoke = async (action: string, input: CanvasActionInput) => {
      if (action === 'inspectPose') {
        const output = inspect(input);
        if (fault === 'fixed-success') {
          output.residual = 0;
          output.withinTolerance = true;
        }
        if (fault === 'wrong-transform') output.actual[0]! += 0.002;
        if (fault === 'ignored-limit') output.violations = [];
        return output;
      }
      if (action === 'evaluate') {
        const output = (await good(
          action,
          fault === 'stale-targets' ? { ...input, targetOffsetX: 0 } : input,
        )) as StationStudy;
        if (fault === 'missing-target') output.candidates[0]!.poses.pop();
        if (fault === 'invented-movement') output.candidates[1]!.movement += 0.1;
        return output;
      }
      return good(action, input);
    };
    await expect(reviewStationPlugin(invoke, xml, brief, false)).rejects.toThrow();
  });
});
