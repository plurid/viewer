/** Messages between the nesting panel and its two workers: one reads drawings, one nests. */
import type { DrawingLayer } from '../../../domain/layout/nesting/drawing';
import type { NestProblem } from '../../../domain/layout/nesting/nest';
import type { FileParts, Part } from '../../../domain/layout/nesting/parts';
import type { NestUpdate } from '../../../domain/layout/nesting/search';

/** A part as the panel shows it: its entities stay with the desktop writer. */
export type PartView = Omit<Part, 'entities'>;
export interface FilePartsView extends Omit<FileParts, 'parts'> {
  parts: PartView[];
}
export interface DrawingFacts {
  /** `$INSUNITS`; 0 when the drawing does not say. */
  units: number;
  layers: DrawingLayer[];
  /** Layers whose names suggest marking, not cutting. */
  suggested: string[];
}
export interface PartsOptions {
  /** Millimetres per drawing unit. */
  scale: number;
  marks: string[];
  together: boolean;
  name: string;
}
/** What the panel asks of the parts worker, each answered once. */
export type PartsQuestion =
  | { kind: 'read'; key: string; url: string }
  | { kind: 'parts'; key: string; options: PartsOptions };
export type PartsRequest = (PartsQuestion & { id: number }) | { kind: 'forget'; key: string };
export type PartsReply =
  | { id: number; kind: 'read'; drawing: DrawingFacts }
  | { id: number; kind: 'parts'; parts: FilePartsView }
  | { id: number; kind: 'error'; error: string };

export interface NestRequest {
  problem: NestProblem;
  /** Milliseconds. */
  budget: number;
  looser?: NestProblem;
  seed: number;
}
export type NestReply = { kind: 'update'; update: NestUpdate } | { kind: 'error'; error: string };
