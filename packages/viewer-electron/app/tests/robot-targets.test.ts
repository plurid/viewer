import { randomUUID } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRobotURDF } from '../src/domain/robotics/urdf';
import { solvePosition } from '../src/domain/robotics/solver';
import { checkRobotTask } from '../src/desktop/robotics/check';
import { canvasRobotReport } from '../src/desktop/canvases/robot-check';
import { Canvases } from '../src/desktop/canvases/service';
import { robotTaskSchema } from '../src/domain/robotics/task';
import type { RobotTask } from '../src/domain/robotics/task';
import type { RobotVector } from '../src/domain/robotics/model';
import { temporaryRoot } from '../tools/temporary';

const fixture = new URL('./fixtures/robotics/so101/', import.meta.url);
const xml = await readFile(new URL('so101_new_calib.urdf', fixture), 'utf8');
const model = parseRobotURDF(xml);
const golden = JSON.parse(await readFile(new URL('poses.json', fixture), 'utf8')) as {
  cases: { positions: Record<string, number>; links: Record<string, number[]> }[];
};
const task = (): RobotTask => ({
  version: 1,
  units: { length: 'm', angle: 'rad' },
  tool: { link: 'gripper_frame_link', point: [0, 0, 0] },
  base: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
  tolerance: 0.001,
  targets: [
    { id: 'A', position: golden.cases[0]!.links.gripper_frame_link!.slice(12, 15) as RobotVector },
  ],
  poses: [{ targetID: 'A', positions: { ...golden.cases[0]!.positions } }],
});
describe('independent endpoint verification', () => {
  it('agrees with SciPy for every link, including local tool offsets and a rotated, translated base', () => {
    for (const example of golden.cases)
      for (const [link, matrix] of Object.entries(example.links)) {
        const point: RobotVector = [0.012, -0.024, 0.036];
        const [x, y, z] = [0, 1, 2].map(
          (row) =>
            matrix[12 + row]! +
            point.reduce((sum, v, column) => sum + v * matrix[column * 4 + row]!, 0),
        );
        const input = task();
        input.tool = { link, point };
        input.base = { xyz: [0.1, 0.2, 0.3], rpy: [0, 0, Math.PI / 2] };
        input.targets[0]!.position = [0.1 - y!, 0.2 + x!, 0.3 + z!];
        input.poses[0]!.positions = example.positions;
        expect(checkRobotTask(model, input).poses[0]!.residual).toBeLessThan(1e-12);
      }
  });
  it('checks both accuracy and joint bounds without accepting a matching but invalid pose', () => {
    const input = task();
    expect(checkRobotTask(model, input).passed).toBe(true);
    input.poses[0]!.positions.shoulder_pan = 4;
    const first = checkRobotTask(model, input);
    input.targets[0]!.position = first.poses[0]!.actual;
    const result = checkRobotTask(model, input);
    expect(result.passed).toBe(false);
    expect(result.poses[0]!.residual).toBe(0);
    expect(result.poses[0]!.violations[0]!.joint).toBe('shoulder_pan');
    expect(result.unchecked).toContain('intervals between poses');
  });
  it('rejects omitted joints, targets, duplicate targets, unknown frames and ambiguous units', () => {
    const input = task();
    delete input.poses[0]!.positions.shoulder_pan;
    expect(() => checkRobotTask(model, input)).toThrow('exactly one position');
    expect(robotTaskSchema.safeParse({ ...task(), poses: [] }).success).toBe(false);
    expect(
      robotTaskSchema.safeParse({ ...task(), targets: [...task().targets, ...task().targets] })
        .success,
    ).toBe(false);
    expect(
      robotTaskSchema.safeParse({ ...task(), units: { length: 'mm', angle: 'degrees' } }).success,
    ).toBe(false);
    expect(() =>
      checkRobotTask(model, { ...task(), tool: { link: 'guessed', point: [0, 0, 0] } }),
    ).toThrow('Unknown tool');
  });
});
describe('bounded position solver', () => {
  it.each([1, 2])(
    'finds a real SO-101 pose for independent target %i and passes the separate checker',
    async (index) => {
      const input = task();
      input.targets[0]!.position = golden.cases[index]!.links.gripper_frame_link!.slice(
        12,
        15,
      ) as RobotVector;
      const solution = await solvePosition(model, {
        ...input.tool,
        base: input.base,
        target: input.targets[0]!.position,
        positions: input.poses[0]!.positions,
        tolerance: input.tolerance,
      });
      expect(solution.outcome).toBe('candidate');
      input.poses[0]!.positions = solution.positions;
      expect(checkRobotTask(model, input).passed).toBe(true);
      expect(solution.iterations).toBeLessThanOrEqual(576);
      expect(task().poses[0]!.positions).toEqual(golden.cases[0]!.positions);
    },
  );
  it('leaves impossible requests unresolved and supports cancellation', async () => {
    const input = task();
    const request = {
      ...input.tool,
      base: input.base,
      target: [5, 5, 5] as RobotVector,
      positions: input.poses[0]!.positions,
      tolerance: input.tolerance,
    };
    const result = await solvePosition(model, request);
    expect(result.outcome).toBe('unresolved');
    expect(result.residual).toBeGreaterThan(1);
    expect(result.iterations).toBeLessThanOrEqual(576);
    const abort = new AbortController();
    const pending = solvePosition(model, request, abort.signal);
    abort.abort();
    await expect(pending).rejects.toThrow();
  });
  it('solves a translated prismatic chain and preserves joints outside the tool chain', async () => {
    const robot =
      parseRobotURDF(`<robot name="slide"><link name="base"/><link name="tool"/><link name="other"/>
      <joint name="slide" type="prismatic"><parent link="base"/><child link="tool"/><axis xyz="1 0 0"/><limit lower="0" upper="1"/></joint>
      <joint name="other" type="continuous"><parent link="base"/><child link="other"/><axis xyz="0 0 1"/></joint></robot>`);
    const result = await solvePosition(robot, {
      link: 'tool',
      point: [0.1, 0, 0],
      target: [0.2, 0.6, 0],
      positions: { slide: 0, other: 0.7 },
      base: { xyz: [0.2, 0, 0], rpy: [0, 0, Math.PI / 2] },
      tolerance: 1e-5,
    });
    expect(result.outcome).toBe('candidate');
    expect(result.positions.slide).toBeCloseTo(0.5, 4);
    expect(result.positions.other).toBe(0.7);
  });
});

async function setup() {
  const root = await temporaryRoot('viewer-robot-check-');
  const canvases = new Canvases(root, { changed() {} });
  let doc = await canvases.create(1, randomUUID(), root);
  const bound = await canvases.source(1, doc.id, doc.revision, {
    path: '/test/arm.urdf',
    version: { identity: 'robot', size: xml.length, modified: 1 },
    availability: 'available',
    facts: {},
    evidence: [{ source: 'text', text: xml }],
    coverage: { content: 'complete' },
  });
  doc = await canvases.write(1, doc.id, bound.revision, 'Robot', '<p>Test task</p>', {
    robotTask: task(),
  });
  doc = await canvases.checkRobot(
    1,
    doc.id,
    doc.revision,
    doc.stateRevision,
    bound.source.id,
    'robotTask',
  );
  return { root, canvases, doc, sourceID: bound.source.id };
}
describe('durable checks owned by Viewer', () => {
  it('recomputes after a cold reload and import; exports checked inputs and measured results', async () => {
    const { root, canvases, doc } = await setup();
    expect(canvasRobotReport(doc)).toMatchObject({ status: 'checked', passed: true });
    await canvases.flush();
    const reopened = new Canvases(root, { changed() {} });
    expect(canvasRobotReport(await reopened.read(1, doc.id))).toEqual(canvasRobotReport(doc));
    const file = path.join(root, 'checked.json');
    await canvases.saveRobotCheck(1, doc.id, doc.revision, doc.stateRevision, async () => file);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    expect(saved).toMatchObject({ passed: true, input: task(), checker: 'position-v1' });
    const exported = await canvases.export(1, doc.id, root);
    const manifest = path.join(exported, 'canvas.viewer.json');
    const data = JSON.parse(await readFile(manifest, 'utf8'));
    expect(data.robotCheck).not.toHaveProperty('passed');
    expect(data.robotCheck).not.toHaveProperty('report');
    data.robotCheck.at = 0;
    await writeFile(manifest, JSON.stringify(data));
    const imported = await canvases.import(1, manifest, randomUUID());
    expect(canvasRobotReport(imported)).toEqual(canvasRobotReport(doc));
    expect(imported.sources[0]!.path).toBeUndefined();
  });
  it.each(['target', 'base', 'pose', 'tool', 'tolerance'])(
    'invalidates a changed %s while camera input leaves the check current',
    async (field) => {
      const { canvases, doc } = await setup();
      const camera = await canvases.state(1, doc.id, doc.stateRevision, doc.revision, {
        camera: [1, 2, 3],
      });
      expect(canvasRobotReport(camera)).toMatchObject({ passed: true });
      const input = task();
      if (field === 'target') input.targets[0]!.position[0] += 0.01;
      if (field === 'base') input.base.xyz[0] += 0.01;
      if (field === 'pose') input.poses[0]!.positions.shoulder_pan! += 0.01;
      if (field === 'tool') input.tool.point[0] += 0.01;
      if (field === 'tolerance') input.tolerance = 0.002;
      const changed = await canvases.state(1, doc.id, camera.stateRevision, doc.revision, {
        robotTask: input,
      });
      expect(canvasRobotReport(changed)).toMatchObject({ status: 'stale' });
      await expect(
        canvases.saveRobotCheck(
          1,
          doc.id,
          doc.revision,
          changed.stateRevision,
          async () => undefined,
        ),
      ).rejects.toThrow('Check the current task');
    },
  );
  it('invalidates content or source changes and isolates a fork from its original', async () => {
    const { canvases, doc } = await setup();
    const branch = await canvases.fork(1, doc.id, randomUUID());
    expect(canvasRobotReport(branch)).toMatchObject({ status: 'stale' });
    expect(canvasRobotReport(await canvases.read(1, doc.id))).toMatchObject({ passed: true });
    const source = structuredClone(doc);
    source.sources[0]!.hash = 'a'.repeat(64);
    expect(canvasRobotReport(source)).toMatchObject({ status: 'stale' });
    const revised = await canvases.write(1, doc.id, doc.revision, 'Revised', '<p>Changed</p>', {});
    expect(canvasRobotReport(revised)).toMatchObject({ status: 'stale' });
  });
  it('rejects stale and cross-window requests and a task changed during save review', async () => {
    const { root, canvases, doc, sourceID } = await setup();
    await expect(
      canvases.checkRobot(2, doc.id, doc.revision, doc.stateRevision, sourceID, 'robotTask'),
    ).rejects.toThrow('another window');
    await expect(
      canvases.checkRobot(1, doc.id, 0, doc.stateRevision, sourceID, 'robotTask'),
    ).rejects.toThrow('changed');
    const destination = path.join(root, 'stale.json');
    await expect(
      canvases.saveRobotCheck(1, doc.id, doc.revision, doc.stateRevision, async () => {
        await canvases.state(1, doc.id, doc.stateRevision, doc.revision, {
          robotTask: { ...task(), tolerance: 0.002 },
        });
        return destination;
      }),
    ).rejects.toThrow('changed');
    await expect(access(destination)).rejects.toThrow();
  });
});
