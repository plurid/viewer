/** A nesting problem from extracted parts and what a person chose for each. */
import type { NestFormat, NestPart, NestProblem } from './nest';
import type { Part } from './parts';
import { looserRotation, rotationAngles, type RotationMode } from './plan';
import { nestingTolerances } from './parts';

export interface PartChoice {
  quantity: number;
  rotation: RotationMode;
  mirror: boolean;
  /** Keep the part's x axis along the sheet's length. */
  grain: boolean;
}
export interface NestSettings {
  margin: number;
  spacing: number;
}

/** What nesting needs of a part. */
export type PartShape = Pick<Part, 'rings' | 'paths' | 'width' | 'height' | 'area'>;

export function nestPart(part: PartShape, choice: PartChoice): NestPart {
  return {
    rings: part.rings,
    paths: part.paths,
    width: part.width,
    height: part.height,
    area: part.area,
    quantity: choice.quantity,
    angles: rotationAngles(choice.rotation, choice.grain),
    mirror: choice.mirror,
  };
}
export function nestProblem(
  parts: readonly { part: PartShape; choice: PartChoice }[],
  formats: readonly NestFormat[],
  settings: NestSettings,
): NestProblem {
  return {
    parts: parts.map(({ part, choice }) => nestPart(part, choice)),
    formats,
    margin: settings.margin,
    spacing: settings.spacing,
    tolerance: nestingTolerances.flatten,
  };
}
/** The same problem with one more step of rotation freedom where a part allows less, or
 * undefined when every part already turns at least in 45° steps. Grain locks stay. */
export function looserProblem(
  problem: NestProblem,
  choices: readonly PartChoice[],
): { problem: NestProblem; loosened: number[] } | undefined {
  const loosened: number[] = [];
  const parts = problem.parts.map((part, index) => {
    const choice = choices[index]!;
    const next = looserRotation[choice.rotation];
    if (!next || !part.quantity) return part;
    const angles = rotationAngles(next, choice.grain);
    if (angles.length === part.angles.length) return part;
    loosened.push(index);
    return { ...part, angles };
  });
  return loosened.length ? { problem: { ...problem, parts }, loosened } : undefined;
}
