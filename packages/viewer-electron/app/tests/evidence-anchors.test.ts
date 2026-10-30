/**
 * EVIDENCE ANCHORS: a place in a file that a search hit, an inspection or a tour stop opens at.
 * New anchors (regions, drawings, models) are additive, so evidence saved before them still opens.
 */
import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import {
  anchoredLine,
  evidenceAnchorSchema,
  evidenceNavigationSchema,
  searchEvidence,
} from '../src/domain/files/inspection';
import { anchorFromPreviewState } from '../src/domain/tours/record';
import {
  boxRegion,
  fitRegion,
  regionBounds,
  regionPoints,
  regionScale,
} from '../src/domain/files/regions';
import { focusBounds, focusFill, framedView } from '../src/renderer/previews/dxf/canvas';
import type { Drawing, DrawingEntity } from '../src/domain/previews/drawings/dxf/math';

const version = { identity: '1:2', modified: 1_700_000_000_000, size: 4096 };

describe('evidence anchors', () => {
  it('reads every anchor saved before regions, drawings and models', () => {
    for (const anchor of [
      { kind: 'text', line: 12, start: 340, end: 356 },
      { kind: 'pdf', page: 3 },
      { kind: 'epub', chapter: 2 },
      { kind: 'document', block: 7 },
      { kind: 'cells', sheet: 'Parts', row: 4, column: 2 },
      { kind: 'image', x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      { kind: 'media', seconds: 42.5 },
    ])
      expect(
        evidenceNavigationSchema.parse({ path: '/Job/Bracket.pdf', version, anchor, quote: '' })
          .anchor,
      ).toEqual(anchor);
  });
  it('reads regions, zooms, drawing entities and camera views', () => {
    const outline: [number, number][] = [
      [0.2, 0.3],
      [0.4, 0.3],
      [0.4, 0.5],
    ];
    expect(
      evidenceAnchorSchema.parse({
        kind: 'pdf',
        page: 2,
        region: outline,
        zoom: 'width',
        search: false,
      }),
    ).toMatchObject({ page: 2, zoom: 'width', search: false });
    expect(
      evidenceAnchorSchema.parse({
        kind: 'image',
        x: 0.2,
        y: 0.3,
        width: 0.2,
        height: 0.2,
        polygon: outline,
      }),
    ).toMatchObject({ polygon: outline });
    expect(
      evidenceAnchorSchema.parse({
        kind: 'dxf',
        entities: ['12', '13'],
        view: { min: [0, 0], max: [120, 80] },
        measure: [
          {
            tool: 'distance',
            points: [
              [10, 10],
              [58, 10],
            ],
          },
        ],
      }),
    ).toMatchObject({ entities: ['12', '13'] });
    expect(
      evidenceAnchorSchema.parse({ kind: 'model', position: [3, 2, 5], target: [0, 0, 0] }),
    ).toMatchObject({ kind: 'model' });
  });
  it('refuses regions off the page, unknown fields, and ids that are not entity positions', () => {
    const invalid = [
      {
        kind: 'pdf',
        page: 1,
        region: [
          [0, 0],
          [1.2, 0],
          [1, 1],
        ],
      },
      {
        kind: 'pdf',
        page: 1,
        region: [
          [0, 0],
          [1, 1],
        ],
      },
      { kind: 'pdf', page: 1, search: true },
      { kind: 'pdf', page: 1, zoom: 9 },
      { kind: 'image', x: 0, y: 0, width: 1, height: 1, outline: [] },
      { kind: 'dxf', entities: ['hole-1'] },
      { kind: 'model', position: [0, 0], target: [0, 0, 0] },
    ];
    for (const anchor of invalid)
      expect(evidenceAnchorSchema.safeParse(anchor).success).toBe(false);
  });
  it('marks the line its quote is on when a recorded line number drifted', () => {
    const text = 'Hello,\n\nThe holes are 48 mm apart.\nThanks';
    const at = (line: number) => ({ line, start: 12, end: 27 });
    expect(anchoredLine(text, at(3), 'holes are 48 mm')).toBe(3);
    expect(anchoredLine(text, at(1), 'holes are 48 mm')).toBe(3);
    expect(anchoredLine(text, { line: 4, start: 0, end: 0 }, '')).toBe(4);
    expect(anchoredLine(text, { line: 9, start: 0, end: 0 }, '')).toBeUndefined();
  });
  it('marks the matched line of a search quote, which starts before the match', () => {
    const body = 'Hello Ana,\n\nThanks for the drawings.\nThe holes are 48 mm apart.\nRegards';
    const file = { path: '/Jobs/request.eml', identity: '1:2', modified: 1, size: 9 } as FileEntry;
    const hit = (text: string) => {
      const found = searchEvidence(
        file,
        {
          path: file.path,
          metadata: {},
          evidence: [{ source: 'text', text }],
          text,
          truncated: false,
        },
        'holes are 48',
      );
      if (found?.anchor.kind !== 'text') throw new Error('Expected a text anchor.');
      return { anchor: found.anchor, quote: found.quote };
    };
    // the quote begins at "Hello Ana," on line 1; the match is on line 4
    const plain = hit(body);
    expect(plain.quote.startsWith('Hello Ana,')).toBe(true);
    expect(anchoredLine(body, plain.anchor, plain.quote)).toBe(4);
    // indexed with a heading, the line drifts by two; the quote still places the match
    const indexed = hit('[message]\nRequest\n' + body);
    expect(indexed.anchor.line).toBe(6);
    expect(anchoredLine(body, indexed.anchor, indexed.quote)).toBe(4);
    // a word that is also on an earlier line is placed by the quote around it, not its first use
    const repeated = 'holes are 48 here too\n' + 'x'.repeat(120) + '\nholes are 48 mm apart.';
    const late = searchEvidence(
      file,
      {
        path: file.path,
        metadata: {},
        evidence: [{ source: 'text', text: 'x'.repeat(200) + '\n' + repeated.split('\n')[2] }],
        text: '',
        truncated: false,
      },
      'holes are 48',
    )!;
    if (late.anchor.kind !== 'text') throw new Error('Expected a text anchor.');
    // recorded on line 2, where it is not: the match alone would land on line 1
    expect(anchoredLine(repeated, { ...late.anchor, line: 2 }, late.quote)).toBe(3);
  });
});

describe('evidence regions on a page or picture', () => {
  const outline: [number, number][] = [
    [0.25, 0.5],
    [0.75, 0.5],
    [0.5, 1.2],
  ];
  it('maps an outline onto the unit viewBox, clamped to the page', () => {
    expect(regionPoints(outline)).toBe('0.25,0.5 0.75,0.5 0.5,1');
    expect(regionBounds(outline)).toEqual({ x: 0.25, y: 0.5, width: 0.5, height: 0.5 });
    expect(boxRegion({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 })).toEqual([
      [0.1, 0.2],
      [0.4, 0.2],
      [0.4, 0.6000000000000001],
      [0.1, 0.6000000000000001],
    ]);
  });
  it('zooms a small region to fill about 60% of the stage, centred', () => {
    // a 100 × 100 px region of a picture shown at 800 × 600, on an 800 × 600 stage
    const view = fitRegion(
      { x: 0.5, y: 0.5, width: 0.125, height: 1 / 6 },
      { width: 800, height: 600 },
      { width: 800, height: 600 },
    );
    expect(view.zoom).toBeCloseTo(3.6);
    // the region's centre (0.5625, 0.5833) lands on the stage's centre
    expect(view.pan.x).toBeCloseTo(-(0.0625 * 800 * 3.6));
    expect(view.pan.y).toBeCloseTo(-((0.5 + 1 / 12 - 0.5) * 600 * 3.6));
  });
  it('keeps a picture fitted when the region is already most of it', () => {
    expect(
      fitRegion(
        { x: 0, y: 0, width: 1, height: 1 },
        { width: 760, height: 560 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ zoom: 1, pan: { x: -0, y: -0 } });
  });
  it('enlarges a PDF page so its region fills the view, between fit and 400%', () => {
    const page = { width: 816, height: 1056 },
      available = { width: 800, height: 600 };
    expect(regionScale({ x: 0.1, y: 0.1, width: 0.2, height: 0.1 }, page, available, 0.57)).toBe(
      2.94,
    );
    expect(regionScale({ x: 0, y: 0, width: 0.01, height: 0.01 }, page, available, 0.57)).toBe(4);
    expect(regionScale({ x: 0, y: 0, width: 1, height: 1 }, page, available, 0.57)).toBe(0.57);
  });
});

describe('a drawing focused on its evidence', () => {
  const entity = (id: string, min: [number, number], max: [number, number]): DrawingEntity => ({
    id,
    type: 'CIRCLE',
    layer: 'Visible',
    points: [],
    snaps: [],
    closed: true,
    bounds: { min: { x: min[0], y: min[1] }, max: { x: max[0], y: max[1] } },
  });
  const drawing: Drawing = {
    entities: [
      entity('0', [0, 0], [500, 300]),
      entity('1', [20, 20], [30, 30]),
      entity('2', [68, 20], [78, 30]),
    ],
    layers: [{ name: 'Visible', visible: true, count: 3 }],
    bounds: { min: { x: 0, y: 0 }, max: { x: 500, y: 300 } },
    units: 4,
    warnings: [],
  };
  it('bounds the highlighted entities and the measurements drawn with them', () => {
    expect(focusBounds(drawing, { entities: ['1', '2'] })).toEqual({
      min: { x: 20, y: 20 },
      max: { x: 78, y: 30 },
    });
    expect(
      focusBounds(drawing, {
        entities: ['1'],
        measurements: [
          {
            id: -1,
            tool: 'distance',
            points: [
              { x: 25, y: 25 },
              { x: 73, y: 40 },
            ],
          },
        ],
      }),
    ).toEqual({ min: { x: 20, y: 20 }, max: { x: 73, y: 40 } });
    // a recorded view wins; entities that are not in the drawing give nothing to frame
    const view = { min: { x: 1, y: 2 }, max: { x: 3, y: 4 } };
    expect(focusBounds(drawing, { entities: ['1'], view })).toBe(view);
    expect(focusBounds(drawing, { entities: ['9'] })).toBeUndefined();
  });
  it('replays a recorded drawing view as it was on screen, and evidence with room around it', () => {
    const size = { width: 400, height: 200 };
    const anchor = anchorFromPreviewState(
      'dxf',
      { 'dxf.view': { center: { x: 50, y: 25 }, scale: 4 } },
      { drawing: size },
    );
    if (anchor?.kind !== 'dxf' || !anchor.view) throw new Error('Expected a drawing view.');
    const view = {
      min: { x: anchor.view.min[0], y: anchor.view.min[1] },
      max: { x: anchor.view.max[0], y: anchor.view.max[1] },
    };
    const focus = { entities: [], view };
    expect(focusFill(focus)).toBe(1);
    expect(framedView(view, size, 500, focusFill(focus))).toEqual({
      center: { x: 50, y: 25 },
      scale: 4,
    });
    expect(focusFill({ entities: ['1'], view })).toBe(0.6);
  });
  it('frames the evidence at about 60% of the canvas, with room around one hole', () => {
    expect(
      framedView(
        { min: { x: 20, y: 20 }, max: { x: 78, y: 30 } },
        { width: 580, height: 400 },
        500,
      ),
    ).toEqual({ center: { x: 49, y: 25 }, scale: 6 });
    // one 10 mm hole in a 500 mm plate is shown with 2% of the plate around it
    const hole = framedView(
      { min: { x: 20, y: 20 }, max: { x: 21, y: 21 } },
      { width: 600, height: 600 },
      500,
    );
    expect(hole.scale).toBeCloseTo(36);
  });
});
