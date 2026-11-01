import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { InspectionResult } from '../../domain/files/inspection';
import type { CanvasSource } from '../../domain/canvases/sources';
import {
  canvasSourceLimits,
  canvasSourceSchema,
  canvasSourceDataSchema,
} from '../../domain/canvases/sources';
import { parseDelimited } from '../../domain/previews/data/delimited';

const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
export const sourceHash = (data: CanvasSource['data']) =>
  createHash('sha256').update(JSON.stringify(data)).digest('hex');

/** A bounded prefix retains its original anchor and reports any omitted evidence. */
export function sourceSnapshot(
  inspection: InspectionResult,
  id: string = randomUUID(),
): CanvasSource {
  if (inspection.availability !== 'available') throw new Error('This source is unavailable.');
  let limited = inspection.evidence.length > 12 || Object.keys(inspection.facts).length > 32;
  let budget = 24_000;
  const evidence = inspection.evidence.slice(0, 12).map((item) => {
    let text = item.text.slice(0, 4096);
    while (Buffer.byteLength(text) > budget) text = text.slice(0, Math.floor(text.length * 0.8));
    limited ||= text.length !== item.text.length;
    budget -= Buffer.byteLength(text);
    return { ...item, text };
  });
  const facts = Object.fromEntries(
    Object.entries(inspection.facts)
      .slice(0, 32)
      .map(([key, fact]) => {
        if (typeof fact.value !== 'string' || fact.value.length <= 500) return [key, fact];
        limited = true;
        return [key, { ...fact, value: fact.value.slice(0, 500) }];
      }),
  );
  const data: CanvasSource['data'] = { facts, evidence, coverage: { ...inspection.coverage } };
  const extension = path.extname(inspection.path).toLowerCase();
  if (extension === '.csv' || extension === '.tsv') {
    const table = parseDelimited(
      evidence.find((item) => item.source === 'text')?.text ?? '',
      extension === '.tsv' ? '\t' : ',',
      { rows: 500, cells: 4000 },
    );
    data.table = { rows: table.rows, malformed: table.malformed };
    limited ||= table.truncated || table.malformed;
  }
  if (extension === '.json' && inspection.coverage.content === 'complete' && !limited) {
    try {
      JSON.parse(evidence.map((item) => item.text).join('\n'));
    } catch {
      limited = true;
      data.coverage.reason = 'The source contains invalid JSON.';
    }
  }
  while (size(data) > canvasSourceLimits.bytes - 1000) {
    limited = true;
    if (data.table?.rows.length) data.table.rows.pop();
    else if (data.evidence.length) data.evidence.pop();
    else throw new Error('The source metadata exceeds the canvas snapshot limit.');
  }
  if (limited)
    data.coverage = {
      content: 'partial',
      reason: [
        data.coverage.reason,
        'Some source content is omitted or malformed. Review the original before using the result.',
      ]
        .filter(Boolean)
        .join(' '),
    };
  const normalized = canvasSourceDataSchema.parse(data);
  return canvasSourceSchema.parse({
    id,
    name: path.basename(inspection.path),
    path: inspection.path,
    version: inspection.version,
    hash: sourceHash(normalized),
    data: normalized,
  });
}
