import { describe, expect, it } from 'vitest';
import { pixelSize } from './paint.js';

describe('physical page raster dimensions', () => {
  it('does not add a pixel to integral extents at 150 PPI', () => {
    expect(pixelSize({ width: 432, height: 576 }, { ppi: 150 })).toMatchObject({
      width: 900,
      height: 1200,
    });
    expect(pixelSize({ width: 612, height: 792 }, { ppi: 150 })).toMatchObject({
      width: 1275,
      height: 1650,
    });
    expect(
      pixelSize({ width: 432, height: 576 }, { ppi: 150, scale: 1.1, pixelRatio: 2 }),
    ).toMatchObject({ width: 1980, height: 2640 });
  });

  it('still rounds fractional extents upward, including small fractions', () => {
    expect(pixelSize({ width: 72.01, height: 72.5 }, { ppi: 150 })).toMatchObject({
      width: 151,
      height: 152,
    });
    expect(pixelSize({ width: 900 + 1e-9, height: 900 - 1e-9 }, { ppi: 72 })).toMatchObject({
      width: 901,
      height: 900,
    });
    expect(pixelSize({ width: 1e-20, height: 0.1 }, { ppi: 72 })).toMatchObject({
      width: 1,
      height: 1,
    });
  });

  it('enforces the rounded dimension and total pixel limits', () => {
    expect(pixelSize({ width: 32767, height: 1 }, { ppi: 72 }).width).toBe(32767);
    expect(pixelSize({ width: 1000, height: 32000 }, { ppi: 72 })).toMatchObject({
      width: 1000,
      height: 32000,
    });
    expect(() => pixelSize({ width: 32767.000001, height: 1 }, { ppi: 72 })).toThrow(RangeError);
    expect(() => pixelSize({ width: 1000.000001, height: 32000 }, { ppi: 72 })).toThrow(RangeError);
  });

  it('rejects invalid page sizes and overflowing or underflowing transforms', () => {
    for (const value of [0, -1, NaN, Infinity, -Infinity]) {
      expect(() => pixelSize({ width: value, height: 72 })).toThrow(RangeError);
      expect(() => pixelSize({ width: 72, height: value })).toThrow(RangeError);
      for (const option of ['ppi', 'scale', 'pixelRatio']) {
        expect(() => pixelSize({ width: 72, height: 72 }, { [option]: value })).toThrow(RangeError);
      }
    }
    expect(() => pixelSize({ width: 72, height: 72 }, { ppi: Number.MAX_VALUE, scale: 2 })).toThrow(
      RangeError,
    );
    expect(() => pixelSize({ width: 72, height: 72 }, { ppi: Number.MIN_VALUE })).toThrow(
      RangeError,
    );
  });
});
