# office-open-xml-viewer source provenance

- Upstream: <https://github.com/yukiyokotani/office-open-xml-viewer>
- Fixed commit: `04d5597676b7532b463db9eb5951d99334a153fe`
- Upstream version at that commit: `0.86.1`
- Source file: `packages/core/src/image/raster-dimensions.ts`
- Local file: `packages/rtf-viewer/src/vendor/raster-dimensions.ts`
- License: MIT; see `LICENSE` in this directory.

This is a source-only extraction. The upstream repository is neither a Git
submodule nor a workspace dependency.

Local changes retain only the PNG IHDR and JPEG SOF/EXIF dimension sniffers,
remove GIF, BMP, WebP, and TIFF support, remove OOXML image-budget constants and
policies, keep helper functions module-private, and expose only
`sniffRasterDimensions(Uint8Array)`. Focused local tests cover supported headers,
large declared dimensions, and malformed or unsupported input.
