/*
 * The implementation is imported from the pinned office-open-xml-viewer
 * submodule. This adapter keeps rtf-viewer's public behavior limited to PNG
 * and JPEG while allowing reviewed submodule updates to supply upstream fixes.
 * See THIRD_PARTY_NOTICES.md and third-party/office-open-xml-viewer/README.md.
 */

import {
  sniffRasterDimensions as sniffUpstreamRasterDimensions,
} from '@rtf-viewer/upstream-raster-dimensions';

interface RasterDimensions {
  width: number;
  height: number;
}

/**
 * Reads decoder-natural dimensions from a PNG IHDR or JPEG SOF header.
 * JPEG EXIF orientations 5 through 8 swap the returned axes. Returns `null`
 * for other formats and for headers that are too short or malformed.
 */
export function sniffRasterDimensions(bytes: Uint8Array): RasterDimensions | null {
  const isPng = bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
  const isJpeg = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!isPng && !isJpeg) return null;

  const dimensions = sniffUpstreamRasterDimensions(bytes);
  return dimensions === null
    ? null
    : { width: dimensions.width, height: dimensions.height };
}
