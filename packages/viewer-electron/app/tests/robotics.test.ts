import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, symlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRobotURDF } from '../src/domain/robotics/urdf';
import { forwardKinematics, originTransform } from '../src/domain/robotics/kinematics';
import { robotModelSchema } from '../src/domain/robotics/model';
import { sourceSnapshot } from '../src/desktop/canvases/sources';
import { ExperimentCanvases as Canvases } from '../tools/robotics/experiment-canvases';
import { attachRobotMeshes, robotMeshPaths, validateRobotSTL } from '../src/desktop/canvases/robot';
import type { InspectionResult } from '../src/domain/files/inspection';
import { temporaryRoot } from '../tools/temporary';

const description = (joint = '<axis xyz="0 0 1"/>', type = 'revolute') => `<robot name="test">
  <link name="base"/>
  <link name="tip"><visual><geometry><box size="1 2 3"/></geometry></visual></link>
  <joint name="turn" type="${type}"><parent link="base"/><child link="tip"/>
    <origin xyz="1 0 0" rpy="0 0 0"/>${joint}<limit lower="-1" upper="1"/>
  </joint>
</robot>`;
const inspection = (text: string, file = '/arm.urdf'): InspectionResult => ({
  path: file,
  version: { identity: 'fixture', modified: 1, size: Buffer.byteLength(text) },
  availability: 'available',
  facts: {},
  evidence: [{ source: 'text', text }],
  coverage: { content: 'complete' },
});
const fixture = new URL('./fixtures/robotics/so101/', import.meta.url);

describe('URDF structure and source definitions', () => {
  it('preserves every joint and mesh of the pinned SO-101, including its reversed XML order', async () => {
    const bytes = await readFile(new URL('so101_new_calib.urdf', fixture));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '3a65d2d35e68a8d2f0c2cc176d19b884506543c93ba72980145b80abe276022c',
    );
    const model = parseRobotURDF(bytes.toString());
    expect(model.root).toBe('base_link');
    expect(model.links).toHaveLength(8);
    expect(model.joints).toHaveLength(7);
    expect(model.joints.filter((joint) => joint.type === 'revolute')).toHaveLength(6);
    const resources = new Set(
      model.links.flatMap((link) =>
        link.visuals.flatMap((v) => (v.geometry.kind === 'mesh' ? [v.geometry.resource] : [])),
      ),
    );
    expect(resources.size).toBe(13);
    for (const joint of model.joints) {
      expect(bytes.toString().slice(joint.definition.start, joint.definition.end)).toBe(
        joint.definition.quote,
      );
      expect(joint.definition.quote).toContain(`name="${joint.name}"`);
    }
  });
  it('ignores fake tags in comments and keeps quoted > inside the actual definition', () => {
    const text = description().replace(
      '<joint name="turn"',
      '<!-- <joint name="fake"/> -->\n<joint name="turn&gt;"',
    );
    const joint = parseRobotURDF(text).joints[0]!;
    expect(joint.name).toBe('turn>');
    expect(joint.definition.quote).toMatch(/^<joint name="turn&gt;"/);
    expect(joint.definition.line).toBe(text.slice(0, joint.definition.start).split('\n').length);
  });
  it.each([
    ['external entity', '<!DOCTYPE robot [<!ENTITY ex SYSTEM "file:///secret">]>' + description()],
    ['zero axis', description('<axis xyz="0 0 0"/>')],
    ['missing limit', description().replace('<limit lower="-1" upper="1"/>', '')],
    ['reversed limits', description().replace('lower="-1"', 'lower="2"')],
    ['not a number', description('<axis xyz="NaN 0 1"/>')],
    ['unsupported joint', description('', 'floating')],
    ['mimic', description('<mimic joint="other"/>')],
    ['misspelled transform', description('<axix xyz="0 0 1"/>')],
    ['misspelled origin', description().replace('rpy="0 0 0"', 'rpx="0 0 0"')],
    ['disconnected link', description().replace('</robot>', '<link name="orphan"/></robot>')],
    ['cycle', description().replace('link="tip"', 'link="base"')],
    ['duplicate name', description().replace('</robot>', '<link name="tip"/></robot>')],
    ['macro', description().replace('</robot>', '<xacro:joint/></robot>')],
    ['version', description().replace('<robot name="test"', '<robot version="1.1" name="test"')],
  ])('refuses %s without returning a plausible partial robot', (_name, text) => {
    expect(() => parseRobotURDF(text)).toThrow();
  });
  it('rejects tampered portable trees, not just raw XML', () => {
    const model = parseRobotURDF(description());
    model.joints[0]!.child = model.root;
    expect(robotModelSchema.safeParse(model).success).toBe(false);
  });
});

describe('kinematics', () => {
  it('agrees with independently generated SciPy rotations for every link at three SO-101 poses', async () => {
    const model = parseRobotURDF(await readFile(new URL('so101_new_calib.urdf', fixture), 'utf8'));
    const reference = JSON.parse(await readFile(new URL('poses.json', fixture), 'utf8')) as {
      cases: { positions: Record<string, number>; links: Record<string, number[]> }[];
    };
    for (const golden of reference.cases) {
      const pose = forwardKinematics(model, golden.positions);
      for (const [link, transform] of Object.entries(golden.links))
        transform.forEach((value, index) =>
          expect(pose.links[link]![index]).toBeCloseTo(value, 12),
        );
    }
  });
  it('applies the base rotation before the translated joint and reports unclamped radians', () => {
    const model = parseRobotURDF(description());
    const pose = forwardKinematics(
      model,
      { turn: Math.PI / 2 },
      { xyz: [0, 2, 0], rpy: [0, 0, Math.PI / 2] },
    );
    expect(pose.links.tip!.slice(12, 15)[0]).toBeCloseTo(0, 12);
    expect(pose.links.tip!.slice(12, 15)[1]).toBeCloseTo(3, 12);
    expect(pose.links.tip![0]).toBeCloseTo(-1, 12);
    expect(pose.violations).toEqual([
      { joint: 'turn', value: Math.PI / 2, lower: -1, upper: 1, unit: 'rad' },
    ]);
  });
  it('supports prismatic metres, continuous rotation and fixed links', () => {
    const prismatic = forwardKinematics(
      parseRobotURDF(description('<axis xyz="0 0 2"/>', 'prismatic')),
      { turn: 0.25 },
    );
    expect(prismatic.links.tip!.slice(12, 15)).toEqual([1, 0, 0.25]);
    const continuous = forwardKinematics(parseRobotURDF(description('', 'continuous')), {
      turn: 20,
    });
    expect(continuous.violations).toEqual([]);
    expect(
      forwardKinematics(parseRobotURDF(description('', 'fixed')), {}).links.tip!.slice(12, 15),
    ).toEqual([1, 0, 0]);
  });
  it.each<Record<string, number>>([{}, { turn: NaN }, { turn: Infinity }, { turn: 0, unknown: 1 }])(
    'requires a complete finite pose %j',
    (positions) => {
      expect(() => forwardKinematics(parseRobotURDF(description()), positions)).toThrow();
    },
  );
  it('does not mutate source or input and rejects invalid base coordinates', () => {
    const model = parseRobotURDF(description());
    const positions = Object.freeze({ turn: 0.5 });
    const before = JSON.stringify(model);
    forwardKinematics(model, positions);
    expect(JSON.stringify(model)).toBe(before);
    expect(() => originTransform({ xyz: [0, NaN, 0], rpy: [0, 0, 0] })).toThrow();
  });
});

describe('robot canvas sources and resources', () => {
  it('keeps the complete model independently of excerpt truncation and survives export/reopen', async () => {
    const root = await temporaryRoot('viewer-robot-source-');
    const canvases = new Canvases(root, { changed: () => {} });
    const initial = await canvases.create(1, randomUUID(), root);
    const text = await readFile(new URL('so101_new_calib.urdf', fixture), 'utf8');
    const bound = await canvases.source(1, initial.id, 0, inspection(text));
    expect(bound.source.data.robot?.joints).toHaveLength(7);
    expect(bound.source.data.coverage.content).toBe('complete');
    await canvases.state(1, initial.id, 0, bound.revision, { shoulder_pan: 0.2 });
    const output = await canvases.export(1, initial.id, root);
    const imported = await canvases.import(
      1,
      path.join(output, 'canvas.viewer.json'),
      randomUUID(),
    );
    expect(imported.sources[0]!.data.robot).toEqual(bound.source.data.robot);
    expect(imported.sources[0]!.path).toBeUndefined();
    expect(imported.state.shoulder_pan).toBe(0.2);
    const partial = inspection(text);
    partial.coverage.content = 'partial';
    expect(sourceSnapshot(partial).data.coverage.content).toBe('partial');
  });
  it('does not read companion files until every resource is authorized', async () => {
    const root = await realpath(await temporaryRoot('viewer-robot-mesh-'));
    await mkdir(path.join(root, 'assets'));
    const file = path.join(root, 'assets', 'part.stl');
    const bytes = Buffer.alloc(134);
    bytes.writeUInt32LE(1, 80);
    await writeFile(file, bytes);
    const text = description().replace('<box size="1 2 3"/>', '<mesh filename="assets/part.stl"/>');
    const canvases = new Canvases(path.join(root, 'private'), { changed: () => {} });
    const initial = await canvases.create(1, randomUUID(), root);
    const { source } = await canvases.source(
      1,
      initial.id,
      0,
      inspection(text, path.join(root, 'arm.urdf')),
    );
    await expect(
      attachRobotMeshes(
        canvases,
        1,
        initial.id,
        source,
        async () => {
          throw new Error('No scope');
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('No scope');
    expect((await canvases.read(1, initial.id)).assets).toEqual([]);
    const attached = await attachRobotMeshes(
      canvases,
      1,
      initial.id,
      source,
      async (file) => file,
      new AbortController().signal,
    );
    expect(attached.resources).toHaveLength(1);
    expect((await canvases.read(1, initial.id)).assets[0]!.source).toBe(file);
    await symlink(file, path.join(root, 'linked.stl'));
    for (const reference of [
      '../part.stl',
      '/part.stl',
      'https://example.com/a.stl',
      'package://a/part.stl',
    ]) {
      const invalid = sourceSnapshot(
        inspection(text.replace('assets/part.stl', reference), source.path),
      );
      await expect(robotMeshPaths(invalid)).rejects.toThrow();
    }
    const linked = await canvases.source(
      1,
      initial.id,
      (await canvases.read(1, initial.id)).revision,
      inspection(text.replace('assets/part.stl', 'linked.stl'), source.path),
      source.id,
    );
    await expect(
      attachRobotMeshes(
        canvases,
        1,
        initial.id,
        linked.source,
        async (file) => file,
        new AbortController().signal,
      ),
    ).rejects.toThrow('links');
    await expect(
      attachRobotMeshes(
        canvases,
        1,
        initial.id,
        source,
        async (file) => file,
        new AbortController().signal,
      ),
    ).rejects.toThrow('source changed');
    const signal = AbortSignal.abort();
    await expect(
      attachRobotMeshes(canvases, 1, initial.id, source, async (file) => file, signal),
    ).rejects.toThrow();
  });
  it('bounds STL allocation and rejects malformed or nonfinite geometry', () => {
    const bytes = Buffer.alloc(134);
    bytes.writeUInt32LE(1, 80);
    expect(() => validateRobotSTL(bytes)).not.toThrow();
    bytes.writeFloatLE(Infinity, 84);
    expect(() => validateRobotSTL(bytes)).toThrow('coordinates');
    bytes.writeUInt32LE(0xffffffff, 80);
    expect(() => validateRobotSTL(bytes)).toThrow('triangles');
  });
});
