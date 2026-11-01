import { parseXML } from '../previews/data/xml';
import type { XMLNode } from '../previews/data/xml';
import { robotLimits, robotModelSchema } from './model';
import type { RobotJoint, RobotModel, RobotOrigin, RobotVector } from './model';

const children = (node: XMLNode, name?: string): XMLNode[] =>
  node.children.filter(
    (child): child is XMLNode => typeof child !== 'string' && (!name || child.name === name),
  );
function one(node: XMLNode, name: string): XMLNode | undefined {
  const found = children(node, name);
  if (found.length > 1) throw new Error(`Duplicate ${name} in ${node.name}.`);
  return found[0];
}
function knownChildren(node: XMLNode, allowed: string[]) {
  const unknown = children(node).find((child) => !allowed.includes(child.name));
  if (unknown) throw new Error(`Unsupported ${node.name} element: ${unknown.name}.`);
}
function knownAttributes(node: XMLNode | undefined, allowed: string[]) {
  const unknown = node && Object.keys(node.attributes).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`Unsupported ${node!.name} attribute: ${unknown}.`);
}
function numeric(value: string | undefined): number {
  if (value === undefined || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()))
    throw new Error('Robot values must be finite numbers, without expressions.');
  const result = Number(value);
  if (!Number.isFinite(result) || Math.abs(result) > 1e6)
    throw new Error('Robot value exceeds the supported range.');
  return result === 0 ? 0 : result;
}
function vector(value: string | undefined, fallback: RobotVector): RobotVector {
  if (value === undefined) return [...fallback];
  const parts = value.trim().split(/\s+/).map(numeric);
  if (parts.length !== 3) throw new Error('Robot vectors need three coordinates.');
  return parts as RobotVector;
}
function origin(node: XMLNode): RobotOrigin {
  const value = one(node, 'origin');
  knownAttributes(value, ['xyz', 'rpy']);
  return {
    xyz: vector(value?.attributes.xyz, [0, 0, 0]),
    rpy: vector(value?.attributes.rpy, [0, 0, 0]),
  };
}
function required(node: XMLNode | undefined, attribute: string): string {
  const value = node?.attributes[attribute];
  if (!value?.trim()) throw new Error(`Missing robot ${attribute}.`);
  return value;
}

/** Source ranges follow validated XML tokens, including quoted > and comments. */
function jointDefinitions(text: string): RobotJoint['definition'][] {
  const ranges: RobotJoint['definition'][] = [];
  const stack: { name: string; start: number }[] = [];
  const tokens = text.matchAll(
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(?:[^<>"']|"[^"]*"|'[^']*')*>/g,
  );
  for (const token of tokens) {
    const raw = token[0];
    if (/^<[!?]/.test(raw)) continue;
    const closing = raw.startsWith('</');
    const name = raw.match(/^<\/?([^\s/>]+)/)![1]!;
    const opened = closing ? stack.pop()! : { name, start: token.index };
    const self = raw.endsWith('/>');
    if (!closing && !self) stack.push(opened);
    if ((closing || self) && name === 'joint' && stack.length === 1 && stack[0]?.name === 'robot') {
      const end = token.index + raw.length;
      ranges.push({
        start: opened.start,
        end,
        line: text.slice(0, opened.start).split('\n').length,
        quote: text.slice(opened.start, end),
      });
    }
  }
  return ranges;
}

/** Kinematic URDF subset. Mesh references are inert data, never file/network authority. */
export function parseRobotURDF(text: string): RobotModel {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > robotLimits.bytes) throw new Error('The robot definition exceeds 128 KB.');
  const root = parseXML(bytes, 8000);
  if (root.name !== 'robot') throw new Error('Select a URDF robot definition.');
  if (root.attributes.version && root.attributes.version !== '1.0')
    throw new Error('Only URDF version 1.0 is supported.');
  const unsupported = children(root).find(
    (node) => !['link', 'joint', 'material', 'transmission', 'gazebo'].includes(node.name),
  );
  if (unsupported)
    throw new Error(
      `Unsupported robot element: ${unsupported.name}. Expand macros before loading.`,
    );
  const definitions = jointDefinitions(text);
  const materials = new Map<string, RobotModel['links'][number]['visuals'][number]['color']>();
  const color = (node: XMLNode | undefined) => {
    const value = node && one(node, 'color')?.attributes.rgba;
    if (value === undefined) return undefined;
    const parts = value.trim().split(/\s+/).map(numeric);
    if (parts.length !== 4) throw new Error('Robot colors need four RGBA values.');
    return parts as [number, number, number, number];
  };
  for (const node of children(root, 'material')) {
    const name = required(node, 'name');
    if (materials.has(name)) throw new Error('Robot material names must be unique.');
    materials.set(name, color(node));
  }
  let ignored = false;
  let linkOrigin = false;
  const links = children(root, 'link').map((node) => {
    knownChildren(node, ['visual', 'collision', 'inertial', 'origin']);
    if (one(node, 'origin')) {
      const value = origin(node);
      if ([...value.xyz, ...value.rpy].some((number) => number !== 0))
        throw new Error(
          'A link-level origin has no URDF transform semantics. Move it to the defining joint before loading.',
        );
      linkOrigin = true;
    }
    return {
      name: required(node, 'name'),
      visuals: children(node, 'visual').map((visual) => {
        knownChildren(visual, ['origin', 'geometry', 'material']);
        const shapes = children(
          one(visual, 'geometry') ?? { name: 'geometry', attributes: {}, children: [] },
        );
        if (shapes.length !== 1) throw new Error('Each robot visual needs exactly one geometry.');
        const shape = shapes[0]!;
        let geometry: RobotModel['links'][number]['visuals'][number]['geometry'];
        if (shape.name === 'mesh')
          geometry = {
            kind: 'mesh',
            resource: required(shape, 'filename'),
            scale: vector(shape.attributes.scale, [1, 1, 1]),
          };
        else if (shape.name === 'box')
          geometry = { kind: 'box', size: vector(required(shape, 'size'), [1, 1, 1]) };
        else if (shape.name === 'sphere')
          geometry = { kind: 'sphere', radius: numeric(shape.attributes.radius) };
        else if (shape.name === 'cylinder')
          geometry = {
            kind: 'cylinder',
            radius: numeric(shape.attributes.radius),
            length: numeric(shape.attributes.length),
          };
        else throw new Error(`Unsupported robot geometry: ${shape.name}.`);
        const material = one(visual, 'material');
        return {
          origin: origin(visual),
          geometry,
          color: color(material) ?? materials.get(material?.attributes.name ?? ''),
        };
      }),
    };
  });
  const joints = children(root, 'joint').map((node, index): RobotJoint => {
    const name = required(node, 'name');
    knownAttributes(node, ['name', 'type']);
    knownChildren(node, [
      'origin',
      'parent',
      'child',
      'axis',
      'limit',
      'mimic',
      'dynamics',
      'calibration',
      'safety_controller',
    ]);
    knownAttributes(one(node, 'axis'), ['xyz']);
    knownAttributes(one(node, 'parent'), ['link']);
    knownAttributes(one(node, 'child'), ['link']);
    const type = node.attributes.type;
    if (!['fixed', 'revolute', 'continuous', 'prismatic'].includes(type ?? ''))
      throw new Error(`Unsupported joint type for ${name}: ${type}.`);
    if (one(node, 'mimic')) throw new Error(`Mimic joint ${name} is not supported.`);
    ignored ||= children(node).some((child) =>
      ['safety_controller', 'calibration', 'dynamics'].includes(child.name),
    );
    const axis =
      type === 'fixed'
        ? ([1, 0, 0] as RobotVector)
        : vector(one(node, 'axis')?.attributes.xyz, [1, 0, 0]);
    const length = Math.hypot(...axis);
    if (length < 1e-12) throw new Error(`Joint ${name} has a zero axis.`);
    const limits = one(node, 'limit');
    const bounded = type === 'revolute' || type === 'prismatic';
    return {
      name,
      type: type as RobotJoint['type'],
      parent: required(one(node, 'parent'), 'link'),
      child: required(one(node, 'child'), 'link'),
      origin: origin(node),
      axis: axis.map((value) => value / length) as RobotVector,
      ...(bounded
        ? {
            limit: {
              lower: numeric(limits?.attributes.lower),
              upper: numeric(limits?.attributes.upper),
            },
          }
        : {}),
      definition: definitions[index]!,
    };
  });
  const descendants = new Set(joints.map((joint) => joint.child));
  const roots = links.filter((link) => !descendants.has(link.name));
  if (roots.length !== 1) throw new Error('The robot must have one root link.');
  return robotModelSchema.parse({
    format: 'urdf',
    name: required(root, 'name'),
    root: roots[0]!.name,
    units: { length: 'm', angle: 'rad' },
    links,
    joints,
    notes: [
      'URDF metres and radians. Joint values use the definition’s zero convention; hardware calibration is not verified.',
      'Kinematic model only. Collision, dynamics, actuation and physical safety are not checked. Meshes require separate approved assets.',
      ...(linkOrigin
        ? [
            'An identity link-level origin was ignored. URDF link frames are defined by their joints.',
          ]
        : []),
      ...(ignored
        ? [
            'Calibration tags, dynamics and soft safety-controller limits are not applied; only explicit hard position limits are checked.',
          ]
        : []),
    ],
  });
}
