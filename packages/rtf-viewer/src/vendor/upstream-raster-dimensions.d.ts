declare module '@rtf-viewer/upstream-raster-dimensions' {
  interface UpstreamRasterDimensions {
    width: number;
    height: number;
  }

  export function sniffRasterDimensions(bytes: Uint8Array): UpstreamRasterDimensions | null;
}
