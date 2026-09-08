import { describe, expect, it } from 'vitest';
import { sniffRasterDimensions } from './raster-dimensions.js';

function putBeU16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function putBeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  putBeU32(bytes, 16, width);
  putBeU32(bytes, 20, height);
  return bytes;
}

function jpegHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(15);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xc0, 0x00, 0x07, 0x08]);
  putBeU16(bytes, 11, height);
  putBeU16(bytes, 13, width);
  return bytes;
}

function jpegWithExifOrientation(width: number, height: number, orientation: number): Uint8Array {
  const exif = new Uint8Array(32);
  exif.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49]);
  const view = new DataView(exif.buffer);
  view.setUint16(8, 42, true);
  view.setUint32(10, 8, true);
  view.setUint16(14, 1, true);
  view.setUint16(16, 0x0112, true);
  view.setUint16(18, 3, true);
  view.setUint32(20, 1, true);
  view.setUint16(24, orientation, true);

  const app1 = new Uint8Array(4 + exif.length);
  app1.set([0xff, 0xe1]);
  putBeU16(app1, 2, exif.length + 2);
  app1.set(exif, 4);

  const frame = jpegHeader(width, height).subarray(6);
  const bytes = new Uint8Array(2 + app1.length + frame.length);
  bytes.set([0xff, 0xd8]);
  bytes.set(app1, 2);
  bytes.set(frame, 2 + app1.length);
  return bytes;
}

describe('sniffRasterDimensions', () => {
  it('reads PNG IHDR dimensions without decoding pixels', () => {
    expect(sniffRasterDimensions(pngHeader(1920, 1080))).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it('surfaces a declared PNG size large enough for the caller to reject', () => {
    expect(sniffRasterDimensions(pngHeader(60_000, 60_000))).toEqual({
      width: 60_000,
      height: 60_000,
    });
  });

  it('walks JPEG segments to the first start-of-frame marker', () => {
    expect(sniffRasterDimensions(jpegHeader(3264, 2448))).toEqual({
      width: 3264,
      height: 2448,
    });
  });

  it('returns browser-natural axes for rotated JPEG EXIF orientation', () => {
    expect(sniffRasterDimensions(jpegWithExifOrientation(400, 100, 6))).toEqual({
      width: 100,
      height: 400,
    });
  });

  it('returns null for malformed, truncated, and unsupported headers', () => {
    const corruptPng = pngHeader(10, 10);
    corruptPng[12] = 0;
    expect(sniffRasterDimensions(corruptPng)).toBeNull();
    expect(sniffRasterDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1]))).toBeNull();
    expect(sniffRasterDimensions(new TextEncoder().encode('<svg/>'))).toBeNull();
  });
});
