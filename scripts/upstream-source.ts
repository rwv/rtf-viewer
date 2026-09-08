import { fileURLToPath } from 'node:url';

export const upstreamRasterDimensionsSpecifier =
  '@rtf-viewer/upstream-raster-dimensions';

export const upstreamRasterDimensionsPath = fileURLToPath(new URL(
  '../third-party/office-open-xml-viewer/upstream/packages/core/src/image/raster-dimensions.ts',
  import.meta.url,
));

export const upstreamSourceAliases = {
  [upstreamRasterDimensionsSpecifier]: upstreamRasterDimensionsPath,
};
