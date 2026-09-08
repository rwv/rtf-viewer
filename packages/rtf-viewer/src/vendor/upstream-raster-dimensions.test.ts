import { expect, it } from 'vitest';
import { sniffRasterDimensions as sniffActualUpstreamRasterDimensions } from '../../../../third-party/office-open-xml-viewer/upstream/packages/core/src/image/raster-dimensions.js';

type DeclaredUpstreamSniffer =
  typeof import('@rtf-viewer/upstream-raster-dimensions').sniffRasterDimensions;

const sniffContract: DeclaredUpstreamSniffer = sniffActualUpstreamRasterDimensions;

it('keeps the build-time declaration aligned with the pinned upstream source', () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  png.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(png.buffer).setUint32(16, 320);
  new DataView(png.buffer).setUint32(20, 200);

  expect(sniffContract(png)).toEqual({ width: 320, height: 200 });
});
