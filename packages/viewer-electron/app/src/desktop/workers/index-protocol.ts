import type { QuerySnapshot } from '../../domain/workspaces/collections';
import type { WorksheetWindow } from '../../domain/previews/documents/office';
import type {
  DrawingGeometryOptions,
  DrawingGeometryPage,
} from '../../domain/previews/drawings/geometry';
import type { InspectionResult } from '../../domain/files/inspection';
import type {
  ApplicationSettings,
  DocumentData,
  IndexedQuery,
  IndexedResult,
  IndexStatus,
} from '../../domain/services';

/** The file-services worker's requests: what each takes, and what it replies. */
export type IndexMethods = {
  init: { args: [database: string, ocr: string]; reply: true };
  configure: { args: [search: ApplicationSettings['search'], rebuild?: boolean]; reply: true };
  query: { args: [query: IndexedQuery]; reply: IndexedResult };
  'query-snapshot': { args: [query: IndexedQuery]; reply: QuerySnapshot };
  status: { args: []; reply: IndexStatus };
  update: { args: [file: string, removed: boolean]; reply: true };
  extract: {
    args: [file: string, limit: number | undefined, chapters: boolean, worksheet?: WorksheetWindow];
    reply: DocumentData;
  };
  inspect: { args: [file: string, content: boolean, ocr: boolean]; reply: InspectionResult };
  'drawing-geometry': {
    args: [file: string, options: DrawingGeometryOptions];
    reply: DrawingGeometryPage;
  };
};
