import path from 'node:path';
import { z } from 'zod';
import { absolute } from '../files/filesystem';
import { containsPath } from '../files/containment';
import { localBookFields } from '../previews/formats';
import type { FileEntry } from '../../domain/contracts';
import type { ChangePlanStatus } from '../../domain/operations/change-plan';
import type {
  ActionApproval,
  ActionRecipe,
  ActionRequest,
  DocumentData,
  DocumentEvidence,
  ProposedChange,
} from '../../domain/services';
/** What a model returns for a batch: one row per requested file. */
export const modelResponse = z.object({
  rows: z
    .array(
      z.object({
        sourceID: z.string(),
        destination: z.string(),
        summary: z.string(),
        fields: z.object({
          year: z.string().nullable(),
          authors: z.string().nullable(),
          title: z.string().nullable(),
          publisher: z.string().nullable(),
        }),
        evidence: z
          .array(
            z.object({
              field: z.enum([
                'year',
                'authors',
                'title',
                'publisher',
                'name',
                'destination',
                'summary',
              ]),
              source: z.string(),
              text: z.string(),
            }),
          )
          .max(20),
      }),
    )
    .max(2000),
});
type ModelRow = z.infer<typeof modelResponse>['rows'][number];
/** One file as a model reads it. */
export interface ModelInputRow {
  sourceID: string;
  filename: string;
  extension: string;
  metadata?: Record<string, string>;
  evidence?: DocumentEvidence[];
}
/** A file's proposed destination, the evidence behind it, and why it needs a person's edit. */
export interface DestinationReview {
  destination: string;
  evidence: DocumentEvidence[];
  issue?: string;
}
/** A reviewed model row: a section of the summary, or a file's destination. */
export type ModelReview =
  | { kind: 'summary'; section: string }
  | ({ kind: 'destination'; file: FileEntry } & DestinationReview);
export interface MergedApproval {
  rows: ProposedChange[];
  /** The approved rows of `rows`, the same objects, so applying them updates the plan's rows. */
  selected: ProposedChange[];
}
export type StoppedStatus = Extract<ChangePlanStatus, 'partial' | 'cancelled' | 'failed'>;
const publicationFields = ['year', 'authors', 'title', 'publisher'] as const;
type PublicationField = (typeof publicationFields)[number];
/** Quotes and characters per quote that each data level sends a model for one file. */
const evidenceLimits = {
  excerpts: { quotes: 16, characters: 6000 },
  'full-text': { quotes: 64, characters: 20000 },
};
const compact = (value: string) => value.replace(/\s+/g, ' ').trim();
/** A publication template filled from fields; a field without a value stays as `[field]`. */
export function publicationName(
  template: string,
  fields: Partial<Record<PublicationField, string | null>>,
  extension: string,
): string {
  return template.replace(
    /\{(year|authors|title|publisher|extension)\}/g,
    (_all, key: PublicationField | 'extension') =>
      key === 'extension' ? extension : fields[key] || '[' + key + ']',
  );
}
/** A book named from its own metadata, when its recipe has no model. */
export function localPublication(
  file: FileEntry,
  document: DocumentData,
  template: string,
): DestinationReview {
  const fields = localBookFields(document);
  const unresolved = publicationFields.filter((key) => !fields[key]);
  return {
    destination: path.join(file.parent, publicationName(template, fields, path.extname(file.name))),
    evidence: document.evidence.filter((item) => !item.source.startsWith('chapter:')).slice(0, 20),
    issue: unresolved.length
      ? 'Missing ' + unresolved.join(', ') + '. Edit the name or configure a model.'
      : undefined,
  };
}
/** The batch a model reads, shaped by the recipe's data level and bounded to 500,000 characters. */
export function modelInput(
  files: readonly FileEntry[],
  documents: ReadonlyMap<string, DocumentData>,
  data: ActionRecipe['data'],
): ModelInputRow[] {
  const limit = data === 'names' ? undefined : evidenceLimits[data];
  const input = files.map((file, index) => {
    const document = documents.get(file.path);
    return {
      sourceID: String(index),
      filename: file.name,
      extension: path.extname(file.name),
      metadata: limit ? document?.metadata : {},
      evidence: limit
        ? document?.evidence
            .slice(0, limit.quotes)
            .map((item) => ({ ...item, text: item.text.slice(0, limit.characters) }))
        : [],
    };
  });
  if (JSON.stringify(input).length > 500000)
    throw new Error('This batch contains too much document evidence. Select fewer files.');
  return input;
}
/** The recipe's instructions, the person's, then the response every recipe asks for. */
export function modelInstructions(recipe: ActionRecipe, request: ActionRequest): string {
  return (
    recipe.instructions +
    '\n' +
    (request.instructions || '') +
    '\nFor books return year, authors, title and publisher with a quote for each. For organize return a relative destination inside the existing parent directory. For rename return a filename. For summarize return a summary. Return exactly one row per sourceID.'
  );
}
/**
 * Reviews the model's rows in its order. A file named twice or outside the request stops the
 * review there, and a file it omitted is refused once every row is reviewed. Rows are yielded as
 * they are reviewed, so the rows before a refusal stay in the failed plan.
 */
export function* reviewModelRows(
  rows: readonly ModelRow[],
  files: readonly FileEntry[],
  documents: ReadonlyMap<string, DocumentData>,
  recipe: ActionRecipe,
): Generator<ModelReview, void> {
  const ids = new Set<string>();
  for (const proposed of rows) {
    if (ids.has(proposed.sourceID)) throw new Error('The model proposed the same file twice.');
    ids.add(proposed.sourceID);
    const index = Number(proposed.sourceID);
    const file = files[index];
    if (!file || String(index) !== proposed.sourceID)
      throw new Error('The model proposed an unknown file.');
    if (recipe.kind === 'summarize')
      yield { kind: 'summary', section: '\n\n## ' + file.name + '\n\n' + proposed.summary };
    else
      yield {
        kind: 'destination',
        file,
        ...reviewDestination(proposed, file, documents.get(file.path), recipe),
      };
  }
  if (ids.size !== files.length)
    throw new Error('The model omitted files. Retry with a smaller batch.');
}
/** A model's destination for one file. Each rule it breaks replaces the issue, so the last one
 * broken is the one a person reads. */
function reviewDestination(
  proposed: ModelRow,
  file: FileEntry,
  document: DocumentData | undefined,
  recipe: ActionRecipe,
): DestinationReview {
  let name = proposed.destination;
  let issue: string | undefined;
  if (recipe.kind === 'book-name') {
    name = publicationName(recipe.template, proposed.fields, path.extname(file.name));
    if (!publicationProven(proposed, document))
      issue = 'Unresolved publication evidence. Review and edit the name.';
  }
  if (recipe.kind !== 'organize' && path.basename(name) !== name)
    issue = 'Rename must contain only a filename.';
  if (path.extname(name) !== path.extname(file.name)) issue = 'Keep the original extension.';
  const destination = path.resolve(file.parent, name);
  if (!containsPath(file.parent, destination))
    issue = 'The destination is outside this action’s scope.';
  return {
    destination,
    evidence: proposed.evidence.map((item) => ({
      source: item.field + ' · ' + item.source,
      text: item.text,
    })),
    issue,
  };
}
/** Every publication field has a value and a quote, and each quote appears in the source it cites. */
function publicationProven(proposed: ModelRow, document: DocumentData | undefined): boolean {
  return (
    publicationFields.every(
      (key) => proposed.fields[key] && proposed.evidence.some((item) => item.field === key),
    ) &&
    proposed.evidence.every(
      (item) =>
        item.text.trim() &&
        document?.evidence.some(
          (source) =>
            source.source === item.source && compact(source.text).includes(compact(item.text)),
        ),
    )
  );
}
/** The plan's rows with the person's edits. An edited destination clears the row's issue for
 * checking again; a row the approval leaves out is not approved. */
export function mergeApproval(
  rows: readonly ProposedChange[],
  approval: ActionApproval,
): MergedApproval {
  const merged = rows.map((row) => {
    const edit = approval.rows.find((item) => item.id === row.id);
    return edit
      ? {
          ...row,
          destination: absolute(edit.destination),
          approved: edit.approved,
          issue: edit.destination !== row.destination ? undefined : row.issue,
        }
      : { ...row, approved: false };
  });
  for (const edit of approval.rows)
    if (!rows.some((row) => row.id === edit.id)) throw new Error('Unknown proposal row.');
  const selected = merged.filter((row) => row.approved);
  if (!selected.length) throw new Error('Select at least one change.');
  return { rows: merged, selected };
}
/** How an apply that stopped ends: partial while any row is completed or still staged. */
export function stoppedStatus(
  selected: readonly ProposedChange[],
  aborted: boolean,
): StoppedStatus {
  return selected.some((row) => row.completed || row.stagedPath)
    ? 'partial'
    : aborted
      ? 'cancelled'
      : 'failed';
}
