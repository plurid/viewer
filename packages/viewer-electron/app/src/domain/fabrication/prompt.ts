/**
 * WHAT A CHECK ASKS: the instructions, the answer's JSON Schema (from `fabricationAnswerSchema`,
 * which also checks the reply) and the input the model reads. Files appear only by inventory ref
 * and name; the pictures follow the input in the order of their image numbers.
 */
import { z } from 'zod';
import type { InventoryItem } from './answer';
import type { PageText } from './check';
import type { MeasurementSummary } from './measure';
import { fabricationAnswerSchema } from './answer';

export const checkAnswerSchema = z.toJSONSchema(fabricationAnswerSchema) as Record<string, unknown>;

export const checkInstructions = `You check a laser-cutting job before it is cut.
The job is the inventory: every file has a ref (S1, S2, …), a kind and its name. Name files only by ref.
- request: the customer's message. List each part it asks for in request, with its quantity in pieces, thickness in millimetres and material, quoting the words you read them from, and the DXF ref it means. When a drawing's title block or parts list gives the same part's quantity, thickness or material, add them under drawing with their quote, even when they agree.
- drawing: dimensioned drawing pages, each a picture with the page's text and the box of each text run.
- photo: photos of parts or samples, as pictures.
- dxf: a cutting file as Viewer measured it, in millimetres: outlines (each a separate piece), holes with their entity ids, pitches between holes, and what its file name gives when it follows a convention Viewer reads, such as g6 for 6 mm and 4buc for 4 pieces. Names are a shop's habit, not a source: read values from the request and drawings first.
Find where the job disagrees with itself: a hole pitch, diameter, outline size or hole count the drawing gives and the DXF does not have; a part the request names without a DXF. Viewer compares quantities and thicknesses itself, from what you list in request.
For each finding give:
- drawing: the drawing or request the value is read from, its page, the value in millimetres (or pieces), the exact text quoted from that page, and a box around that text or feature as [left, top, right, bottom] fractions of the page. Use the text boxes the page lists.
- dxf: the DXF ref, the value its measurement gives, the axis, and the entity ids: exactly the two holes' entities for a pitch, the hole's for a diameter, the outline's for a size.
- proposal, only for a pitch the DXF draws other than the drawing gives: the drawing's value as target, and the entity ids of the holes that move (the hole whose pitch is set and any that move with it, such as its column). Never list the hole that stays.
Take every number from the inputs and never invent one. Viewer measures every DXF value itself and grades each finding; a finding it cannot measure is marked unverified.
Then plan a tour of at most 8 stops that shows a person each finding: the request's line, the drawing's region with its box, the DXF's holes by entity id, a photo. Each caption says in one short sentence what the stop shows, with its values.
When the job agrees with itself, return no findings and say so in the summary.`;

export interface CheckInputRequest {
  ref: string;
  subject?: string;
  date?: string;
  text: string;
  attachments: string[];
}
export interface CheckInputPage {
  page: number;
  /** Its picture's number in the message, from 1. */
  image: number;
  width: number;
  height: number;
  text: PageText[];
}
export interface CheckInputDrawing {
  ref: string;
  pages: number;
  shown: CheckInputPage[];
  /** Why some pages are not shown, when they are not. */
  note?: string;
}
export interface CheckInputPhoto {
  ref: string;
  image: number;
  width: number;
  height: number;
}
export interface CheckInputDXF {
  ref: string;
  /** What the file's name gives. */
  name: { part?: string; thickness?: number; quantity?: number; notes: string[] };
  measurement?: MeasurementSummary;
  /** Why Viewer did not measure it. */
  refused?: string;
}
export interface CheckInput {
  job: string;
  inventory: InventoryItem[];
  requests: CheckInputRequest[];
  drawings: CheckInputDrawing[];
  photos: CheckInputPhoto[];
  dxf: CheckInputDXF[];
  pictures: string;
}

/** The input, with the sentence that ties the pictures to their numbers. */
export function checkInput(input: Omit<CheckInput, 'pictures'>, pictures: number): CheckInput {
  return {
    ...input,
    pictures: pictures
      ? `${pictures === 1 ? 'One picture follows' : `${pictures} pictures follow`} this text, in the order of their image numbers.`
      : 'No pictures follow this text.',
  };
}

/** A page's text as one string, in the order the page gives its runs, for checking quotes. */
export const pageText = (items: readonly PageText[]) =>
  items
    .map((item) => item.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
