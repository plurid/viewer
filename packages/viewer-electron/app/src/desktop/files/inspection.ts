import type { InspectionResult } from '../../domain/files/inspection';
import { sameSourceVersion, sourceVersion } from '../../domain/files/inspection';
import { entry } from './filesystem';
import { extractDocument, documentBytes } from '../previews/formats';
import { DXF_MAX_BYTES } from '../../domain/previews/drawings/dxf/math';
import { decodeDXF } from '../../domain/previews/drawings/dxf/decode';
import { unitInfo } from '../../domain/previews/drawings/dxf/units';
import { readImageDimensions } from '../previews/image-dimensions';
import { fileCoordination } from './file-coordination';
import { parseDelimited } from '../../domain/previews/data/delimited';
export async function inspectFile(
  file: string,
  options: {
    content?: boolean;
    ocr?: string;
    signal?: AbortSignal;
  } = {},
): Promise<InspectionResult> {
  const before = await entry(file);
  const result: InspectionResult = {
    path: file,
    version: sourceVersion(before),
    availability: 'available',
    facts: {
      bytes: { value: before.size, unit: 'bytes', source: 'filesystem' },
      kind: { value: before.directory ? 'folder' : before.extension, source: 'filesystem' },
    },
    evidence: [],
    coverage: { content: 'not-requested' },
  };
  if (!options.content || before.directory) return result;
  await fileCoordination.run(
    [{ path: file, mode: 'read' }],
    async (signal) => {
      signal?.throwIfAborted();
      if (before.extension === 'dxf') {
        const { parseDrawing } = await import('../../domain/previews/drawings/dxf/geometry');
        const drawing = parseDrawing(decodeDXF(await documentBytes(file, DXF_MAX_BYTES)));
        const unit = unitInfo(drawing.units).symbol;
        result.facts.drawingWidth = {
          value: drawing.bounds.max.x - drawing.bounds.min.x,
          unit,
          source: 'DXF drawing bounds',
        };
        result.facts.drawingHeight = {
          value: drawing.bounds.max.y - drawing.bounds.min.y,
          unit,
          source: 'DXF drawing bounds',
        };
        result.facts.drawingUnits = {
          value: unitInfo(drawing.units).label,
          source: 'DXF INSUNITS header; no unit assumptions',
        };
        result.facts.entities = {
          value: drawing.entities.length,
          source: 'Shared DXF geometry reader',
        };
        result.facts.layers = {
          value: drawing.layers.length,
          source: 'DXF layer table and entities',
        };
        result.facts.contourLength = {
          value: drawing.entities.reduce((sum, entity) => sum + (entity.length ?? 0), 0),
          unit,
          source: 'Sum of supported entity lengths; sampled curves may be approximate',
        };
        result.facts.closedContourArea = {
          value: drawing.entities.reduce((sum, entity) => sum + (entity.area ?? 0), 0),
          unit: unit + '²',
          source: 'Sum of closed contour areas; overlapping contours are not unioned',
        };
        result.coverage = {
          content: drawing.warnings.length ? 'partial' : 'complete',
          ...(drawing.warnings.length
            ? { reason: drawing.warnings.join(' ').slice(0, 10000) }
            : {}),
        };
        return;
      }
      if (before.mime.startsWith('image/')) {
        const dimensions = await readImageDimensions(fileCoordination.path(file));
        if (dimensions) {
          result.facts.width = { value: dimensions.width, unit: 'px', source: 'image header' };
          result.facts.height = { value: dimensions.height, unit: 'px', source: 'image header' };
          result.facts.pixels = {
            value: dimensions.width * dimensions.height,
            unit: 'pixels',
            source: 'image header',
          };
        }
        result.coverage = {
          content: dimensions ? 'partial' : 'unsupported',
          reason: 'Image header inspection; pixels and OCR have not been analyzed.',
        };
        return;
      }
      try {
        const document = await extractDocument(file, { ocr: options.ocr, signal });
        for (const [key, value] of Object.entries(document.metadata).slice(0, 100))
          result.facts[key] = {
            value: /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : value,
            source: 'document metadata',
          };
        result.evidence = document.evidence;
        for (const evidence of result.evidence)
          if (evidence.source === 'text' && !evidence.anchor)
            evidence.anchor = {
              kind: 'text',
              line: 1,
              start: 0,
              end: Math.min(1000, evidence.text.length),
            };
        result.facts.characters = {
          value: document.evidence.reduce((count, item) => count + item.text.length, 0),
          source: 'extracted text',
        };
        if (document.office?.kind === 'workbook') {
          const workbook = document.office;
          result.facts.worksheets = {
            value: workbook.sheets.length,
            source: 'bounded worksheet reader; retained sheets',
          };
          result.facts.cells = {
            value: workbook.sheets.reduce(
              (n, sheet) => n + sheet.rows.reduce((n, row) => n + row.cells.length, 0),
              0,
            ),
            source: 'bounded worksheet reader; retained cells',
          };
          result.facts.formulas = {
            value: workbook.formulas,
            source: 'bounded worksheet reader; retained formula cells',
          };
          result.facts.missingCachedValues = {
            value: workbook.missingCached,
            source: 'bounded worksheet reader; formulas without saved values',
          };
        }
        if (['csv', 'tsv'].includes(before.extension)) {
          const table = parseDelimited(
            document.evidence.find((item) => item.source === 'text')?.text || '',
            before.extension === 'tsv' ? '\t' : ',',
          );
          result.facts.rows = {
            value: Math.max(0, table.rows.length - 1),
            source: 'bounded table reader',
          };
          result.facts.columns = {
            value: table.rows[0]?.length || 0,
            source: 'bounded table reader',
          };
          if (table.malformed || table.truncated) document.truncated = true;
        }
        result.coverage = {
          content: document.truncated || document.coverageReason ? 'partial' : 'complete',
          reason:
            [
              document.coverageReason,
              document.truncated
                ? 'The reader limit was reached; unexamined content may contain more results.'
                : undefined,
            ]
              .filter(Boolean)
              .join(' ') || undefined,
        };
      } catch (error) {
        signal?.throwIfAborted();
        result.coverage = { content: 'unsupported', reason: (error as Error).message };
      }
    },
    options.signal,
  );
  options.signal?.throwIfAborted();
  const after = await entry(file);
  if (!sameSourceVersion(result.version, sourceVersion(after)))
    throw new Error('The file changed while being inspected. Inspect it again.');
  return result;
}
