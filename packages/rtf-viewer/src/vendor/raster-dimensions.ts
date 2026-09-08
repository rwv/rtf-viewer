/*
 * Derived from office-open-xml-viewer at commit
 * 04d5597676b7532b463db9eb5951d99334a153fe:
 * packages/core/src/image/raster-dimensions.ts
 * Copyright (c) 2026 Yuki Yokotani. Licensed under the MIT License.
 *
 * Local changes: retain only PNG and JPEG dimension sniffing, remove OOXML
 * budget policy and other image formats, and expose one narrow function.
 * See THIRD_PARTY_NOTICES.md and third-party/office-open-xml-viewer/README.md.
 */

interface RasterDimensions {
  width: number;
  height: number;
}

function beU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function beU32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] << 24)
    | (bytes[offset + 1] << 16)
    | (bytes[offset + 2] << 8)
    | bytes[offset + 3]
  ) >>> 0;
}

function isJpegExifPayload(payload: Uint8Array): boolean {
  return payload.length >= 6
    && payload[0] === 0x45
    && payload[1] === 0x78
    && payload[2] === 0x69
    && payload[3] === 0x66
    && payload[4] === 0x00
    && payload[5] === 0x00;
}

function sniffJpegExifOrientation(payload: Uint8Array): number | null {
  if (payload.length < 14 || !isJpegExifPayload(payload)) return null;

  const tiffOffset = 6;
  const little = payload[tiffOffset] === 0x49 && payload[tiffOffset + 1] === 0x49;
  const big = payload[tiffOffset] === 0x4d && payload[tiffOffset + 1] === 0x4d;
  if (!little && !big) return null;

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  if (view.getUint16(tiffOffset + 2, little) !== 42) return null;
  const ifdRelativeOffset = view.getUint32(tiffOffset + 4, little);
  const ifdOffset = tiffOffset + ifdRelativeOffset;
  if (ifdRelativeOffset < 8 || ifdOffset + 2 > payload.length) return null;

  const entryCount = view.getUint16(ifdOffset, little);
  const entriesOffset = ifdOffset + 2;
  const readableEntryCount = Math.min(
    entryCount,
    Math.floor((payload.length - entriesOffset) / 12),
  );
  for (let index = 0; index < readableEntryCount; index += 1) {
    const entryOffset = entriesOffset + index * 12;
    if (view.getUint16(entryOffset, little) !== 0x0112) continue;
    if (view.getUint16(entryOffset + 2, little) !== 3) continue;
    if (view.getUint32(entryOffset + 4, little) !== 1) continue;
    const orientation = view.getUint16(entryOffset + 8, little);
    if (orientation >= 1 && orientation <= 8) return orientation;
  }
  return null;
}

function orientJpegDimensions(
  dimensions: RasterDimensions,
  orientation: number | null,
): RasterDimensions {
  return orientation !== null && orientation >= 5 && orientation <= 8
    ? { width: dimensions.height, height: dimensions.width }
    : dimensions;
}

function sniffJpegSof(bytes: Uint8Array): RasterDimensions | null {
  const length = bytes.length;
  let offset = 2;
  let orientation: number | null = null;
  let sawExif = false;
  let dimensions: RasterDimensions | null = null;

  while (offset + 1 < length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) {
      return dimensions ? orientJpegDimensions(dimensions, orientation) : null;
    }
    if (offset + 3 >= length) return null;

    const segmentLength = beU16(bytes, offset + 2);
    const isStartOfFrame = marker >= 0xc0
      && marker <= 0xcf
      && marker !== 0xc4
      && marker !== 0xc8
      && marker !== 0xcc;
    if (isStartOfFrame) {
      if (segmentLength < 7 || offset + 8 >= length) return null;
      dimensions ??= {
        width: beU16(bytes, offset + 7),
        height: beU16(bytes, offset + 5),
      };
    }

    if (segmentLength < 2) return null;
    const segmentEnd = offset + 2 + segmentLength;
    if (segmentEnd > length) {
      return dimensions ? orientJpegDimensions(dimensions, orientation) : null;
    }
    if (marker === 0xe1 && !sawExif) {
      const payload = bytes.subarray(offset + 4, segmentEnd);
      if (isJpegExifPayload(payload)) {
        sawExif = true;
        orientation = sniffJpegExifOrientation(payload);
      }
    }
    offset = segmentEnd;
  }

  return dimensions ? orientJpegDimensions(dimensions, orientation) : null;
}

/**
 * Reads decoder-natural dimensions from a PNG IHDR or JPEG SOF header.
 * JPEG EXIF orientations 5 through 8 swap the returned axes. Returns `null`
 * for other formats and for headers that are too short or malformed.
 */
export function sniffRasterDimensions(bytes: Uint8Array): RasterDimensions | null {
  if (
    bytes.length >= 24
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    if (
      bytes[12] === 0x49
      && bytes[13] === 0x48
      && bytes[14] === 0x44
      && bytes[15] === 0x52
    ) {
      return { width: beU32(bytes, 16), height: beU32(bytes, 20) };
    }
    return null;
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return sniffJpegSof(bytes);
  }

  return null;
}
