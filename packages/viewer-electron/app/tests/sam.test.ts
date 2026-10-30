/**
 * SAM 3.1: its object prompt, its reply's record, the one_bit mask decoded, the mask traced as an
 * outline on the picture, and the model's box standing in when SAM gives none.
 */
import { describe, expect, it } from 'vitest';
import { decodeOneBitMask, SamMaskError } from '../src/desktop/models/sam-mask';
import { boxSegmenter, samSegmenter } from '../src/desktop/models/segmentation';
import { maskPolygon } from '../src/domain/models/mask-polygon';
import { pixelBox, samBoxPrompt, samRecord } from '../src/domain/models/sam';
import { jpeg, samReply } from './fabrication-fixtures';

const picture = {
  image: { type: 'image/jpeg' as const, data: jpeg(64, 64) },
  width: 64,
  height: 64,
};
const signal = () => new AbortController().signal;

describe('SAM 3.1 replies', () => {
  it('reads the box and mask of a real reply, and decodes its one_bit mask', () => {
    const record = samRecord(samReply)!;
    expect(record).toEqual({
      bounds: { left: 16, top: 16, right: 48, bottom: 48 },
      frame: { width: 64, height: 64 },
      mask: { width: 32, height: 32, payload: '!!!!!(y:SRo?iX' },
      confidence: 0.8904109597206116,
    });
    // The mask lies over the box SAM found, the square, so every cell of it is set.
    const raster = decodeOneBitMask(record.mask.payload, 32, 32);
    expect(raster).toHaveLength(32 * 32);
    expect(raster.every((cell) => cell === 1)).toBe(true);
  });

  it('traces the mask as an outline on the picture, in fractions of its size', () => {
    const record = samRecord(samReply)!;
    const raster = decodeOneBitMask(record.mask.payload, 32, 32);
    expect(maskPolygon(raster, 32, 32, record)).toEqual([
      [0.25, 0.25],
      [0.75, 0.25],
      [0.75, 0.75],
      [0.25, 0.75],
    ]);
  });

  it('outlines the largest region, its notch kept and its stair steps simplified', () => {
    // an L of 8 × 8 cells less its top-right quarter, a stray cell apart
    const raster = new Uint8Array(10 * 10);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) if (!(x >= 4 && y < 4)) raster[y * 10 + x] = 1;
    raster[9 * 10 + 9] = 1;
    const outline = maskPolygon(raster, 10, 10, {
      bounds: { left: 0, top: 0, right: 10, bottom: 10 },
      frame: { width: 10, height: 10 },
    })!;
    expect(outline).toHaveLength(6);
    expect(outline).toEqual(
      expect.arrayContaining([
        [0, 0],
        [0.4, 0],
        [0.4, 0.4],
        [0.8, 0.4],
        [0.8, 0.8],
        [0, 0.8],
      ]),
    );
    expect(
      maskPolygon(new Uint8Array(4), 2, 2, {
        bounds: { left: 0, top: 0, right: 2, bottom: 2 },
        frame: { width: 2, height: 2 },
      }),
    ).toBeUndefined();
  });

  it('refuses a payload that is malformed, rather than drawing a guess', () => {
    expect(() => decodeOneBitMask('~!!!!!(y:SRo?iX', 32, 32)).toThrow(SamMaskError);
    expect(() => decodeOneBitMask('!!!!!(y:SRo?i', 32, 32)).toThrow('not as long as its length');
    expect(() => decodeOneBitMask('!!!!!(y:SR|?iX', 32, 32)).toThrow('a character it cannot have');
    expect(
      samRecord('<0f>0<|box;x1=16;y1=16;x2=70;y2=47;w=64;h=64|><|mask;x=0;y=0;data=32,32,!x|>'),
    ).toBeUndefined();
    expect(samRecord('No objects found.')).toBeUndefined();
  });

  it('asks with an object prompt in whole pixels, right and bottom inclusive', () => {
    const box = pixelBox({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 64, 64);
    expect(box).toEqual({ left: 16, top: 16, right: 48, bottom: 48 });
    expect(samBoxPrompt(box, 64, 64)).toBe('<0f>0<|box;x1=16;y1=16;x2=47;y2=47;w=64;h=64|>');
  });
});

describe('segmenters', () => {
  it('uses SAM’s outline, with its confidence', async () => {
    const asked: string[] = [];
    const segmenter = samSegmenter(async (_picture, prompt) => {
      asked.push(prompt);
      return samReply;
    }, 'Muse Spark');
    const outline = await segmenter.segment(
      picture,
      { kind: 'box', box: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } },
      signal(),
    );
    expect(asked).toEqual(['<0f>0<|box;x1=16;y1=16;x2=47;y2=47;w=64;h=64|>']);
    expect(outline).toMatchObject({
      source: 'segmentation',
      label: 'outline from SAM 3.1',
      confidence: 0.8904109597206116,
    });
  });

  it('stands the model’s box in for an outline SAM does not give, and says why', async () => {
    const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    const failing = samSegmenter(async () => {
      throw new Error('Provider connection failed.');
    }, 'Muse Spark');
    expect(await failing.segment(picture, { kind: 'box', box }, signal())).toEqual({
      ...(await boxSegmenter('Muse Spark').segment(picture, { kind: 'box', box }, signal())),
      note: 'SAM 3.1 gave no outline: Provider connection failed.',
    });
    const empty = samSegmenter(async () => 'No objects found.', 'Muse Spark');
    expect(await empty.segment(picture, { kind: 'box', box }, signal())).toMatchObject({
      source: 'model-box',
      label: 'box from Muse Spark',
      note: 'SAM 3.1 gave no outline.',
    });
    // words alone give no box to stand in
    expect(
      await failing.segment(picture, { kind: 'text', text: 'hole' }, signal()),
    ).toBeUndefined();
  });
});
