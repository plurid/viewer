/**
 * QUOTES ON THEIR PAGE: whether the words a model quotes are a page's own, and where they are.
 * Case and spacing are ignored. A quote is on its page as one passage; as passages on lines of
 * their own, each on the page in that order; or as whole printed lines in order, such as a parts
 * list's row and a title block's lines, never pieces cut from them. A match never cuts a number,
 * so "2 pieces" is not on a page that says "12 pieces" (docs/reference/fabrication.md).
 */
import type { PageText } from './check';
import { pageLines } from './page-text';

/** Text as it compares: one form of each character (⌀ as ø, the multiplication sign as x, so a
 * quoted "3x Ø8.5" is the drawing's "3× Ø8.5"), lower case, without spacing; for each character,
 * whether spacing came before it and the piece of the page it is from. */
interface Squashed {
  text: string;
  spaced: boolean[];
  pieces: number[];
}
function squash(pieces: readonly string[]): Squashed {
  const out: Squashed = { text: '', spaced: [], pieces: [] };
  pieces.forEach((piece, index) => {
    const text = piece.normalize('NFKC').toLowerCase().replace(/⌀/g, 'ø').replace(/×/g, 'x');
    let spaced = true;
    // By UTF-16 unit, as indexOf counts.
    for (let at = 0; at < text.length; at++) {
      if (/\s/.test(text[at]!)) {
        spaced = true;
        continue;
      }
      out.text += text[at];
      out.spaced.push(spaced);
      out.pieces.push(index);
      spaced = false;
    }
  });
  return out;
}
const squashed = (text: string) => squash([text]).text;
const isDigit = (character: string | undefined) =>
  character !== undefined && character >= '0' && character <= '9';
/** Whether a number of the page goes on at `at`: a digit, or a decimal point or comma before one. */
const numberAt = (page: Squashed, at: number) =>
  at >= 0 &&
  at < page.text.length &&
  (isDigit(page.text[at]) ||
    (/[.,]/.test(page.text[at]!) && isDigit(page.text[at + 1]) && !page.spaced[at + 1]));
/** Whether the match from `start` to `end` starts or ends inside one of the page's numbers. */
function cutsNumber(page: Squashed, start: number, end: number): boolean {
  const before =
    start > 0 &&
    !page.spaced[start] &&
    (isDigit(page.text[start - 1]) ||
      (/[.,]/.test(page.text[start - 1]!) &&
        isDigit(page.text[start - 2]) &&
        !page.spaced[start - 1]));
  const after = end < page.text.length && !page.spaced[end] && numberAt(page, end);
  return (isDigit(page.text[start]) && before) || (isDigit(page.text[end - 1]) && after);
}
/** Every place `asked` is on the page from `from`, in order, none cutting a number. */
function* matches(page: Squashed, asked: string, from = 0) {
  for (let at = page.text.indexOf(asked, from); at >= 0; at = page.text.indexOf(asked, at + 1))
    if (!cutsNumber(page, at, at + asked.length)) yield at;
}
const span = (first: number, last: number) =>
  Array.from({ length: last - first + 1 }, (_, index) => first + index);

/** A page as pieces, runs or lines, and its printed lines as the indexes of their pieces. */
interface Units {
  pieces: readonly string[];
  lines: readonly (readonly number[])[];
}
/**
 * The passages of the page a quote is read from, each the indexes of its pieces; undefined when
 * the quote is not on the page. `rank` scores a passage when the quote is on the page more than
 * once, the lowest first.
 */
function locate(
  units: Units,
  quote: string,
  rank?: (pieces: number[]) => number,
): number[][] | undefined {
  const page = squash(units.pieces);
  const asked = squashed(quote);
  if (!asked) return undefined;
  const passage = (at: number, length: number) =>
    span(page.pieces[at]!, page.pieces[at + length - 1]!);

  let best: { pieces: number[]; score: number } | undefined;
  for (const at of matches(page, asked)) {
    const pieces = passage(at, asked.length);
    const score = rank?.(pieces) ?? 0;
    if (!best || score < best.score) best = { pieces, score };
    if (!rank) break;
  }
  if (best) return [best.pieces];

  const segments = quote.split(/\r?\n/).map(squashed).filter(Boolean);
  if (segments.length > 1) {
    const found: number[][] = [];
    let from = 0;
    for (const segment of segments) {
      const { value: at } = matches(page, segment, from).next();
      if (at === undefined) break;
      found.push(passage(at, segment.length));
      from = at + segment.length;
    }
    if (found.length === segments.length) return found;
  }
  return wholeLines(units, asked);
}

/** The printed lines a squashed quote is made of, whole and in order, joined where they follow one
 * another; undefined when no such lines make it. */
function wholeLines(units: Units, asked: string): number[][] | undefined {
  const texts = units.lines.map((line) => squash(line.map((index) => units.pieces[index]!)).text);
  // For each length of the quote made so far, the earliest last line that makes it, and how.
  const reach = new Map<number, { line: number; previous: number }>([
    [0, { line: -1, previous: -1 }],
  ]);
  for (let at = 0; at < asked.length; at++) {
    const here = reach.get(at);
    if (!here) continue;
    for (let line = here.line + 1; line < texts.length; line++) {
      const text = texts[line]!;
      if (!text || !asked.startsWith(text, at)) continue;
      const end = at + text.length;
      if ((reach.get(end)?.line ?? Infinity) > line) reach.set(end, { line, previous: at });
    }
  }
  if (!reach.has(asked.length)) return undefined;
  const chosen: number[] = [];
  for (let at = asked.length; at > 0; at = reach.get(at)!.previous)
    chosen.unshift(reach.get(at)!.line);
  const passages: number[][] = [];
  chosen.forEach((line, index) => {
    const pieces = [...units.lines[line]!];
    if (index && chosen[index - 1] === line - 1) passages.at(-1)!.push(...pieces);
    else passages.push(pieces);
  });
  return passages;
}

/** Whether a quote is on a page's text, whose lines are its printed lines (`pageText`). */
export function quoteOn(text: string, quote: string): boolean {
  const pieces = text.split('\n');
  return locate({ pieces, lines: pieces.map((_, index) => [index]) }, quote) !== undefined;
}

/** `[left, top, right, bottom]` in page fractions. */
type Box = readonly number[];
/** The box around runs of text. */
export function runsBox(runs: readonly PageText[]): [number, number, number, number] {
  return [
    Math.min(...runs.map((run) => run.box[0])),
    Math.min(...runs.map((run) => run.box[1])),
    Math.max(...runs.map((run) => run.box[2])),
    Math.max(...runs.map((run) => run.box[3])),
  ];
}
const centre = (box: Box) => [(box[0]! + box[2]!) / 2, (box[1]! + box[3]!) / 2] as const;
/**
 * The runs of each passage a quote is read from on a page, or undefined when it is not on it.
 * When the quote is on the page more than once, the passage nearest `near` is taken, such as the
 * box the model gave: a dimension's "60" rather than the "60" of a note.
 */
export function quotePassages(
  runs: readonly PageText[],
  quote: string,
  near?: Box,
): PageText[][] | undefined {
  const rank =
    near &&
    ((pieces: number[]) => {
      const [x, y] = centre(runsBox(pieces.map((index) => runs[index]!)));
      const [nx, ny] = centre(near);
      return Math.hypot(x - nx, y - ny);
    });
  const found = locate(
    { pieces: runs.map((run) => run.text), lines: pageLines(runs) },
    quote,
    rank || undefined,
  );
  return found?.map((pieces) => pieces.map((index) => runs[index]!));
}

/** Whether a quote gives a value: one of its numbers is it, a decimal comma read as a point. */
export const quoteGives = (quote: string, value: number) =>
  (quote.match(/\d+(?:[.,]\d+)?/g) ?? []).some(
    (number) => Math.abs(Number(number.replace(',', '.')) - value) < 1e-9,
  );
