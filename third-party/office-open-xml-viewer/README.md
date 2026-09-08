# office-open-xml-viewer source provenance

- Upstream: <https://github.com/yukiyokotani/office-open-xml-viewer>
- Fixed commit: `04d5597676b7532b463db9eb5951d99334a153fe`
- Upstream version at that commit: `0.86.1`
- Source file: `packages/core/src/image/raster-dimensions.ts`
- Upstream checkout: `third-party/office-open-xml-viewer/upstream`
- Local adapter: `packages/rtf-viewer/src/vendor/raster-dimensions.ts`
- License: MIT; see `LICENSE` in this directory.

The fixed revision is a shallow Git submodule. The library build imports the
upstream TypeScript source directly and bundles the reachable implementation
into `rtf-viewer`; package consumers do not need the submodule or the upstream
workspace. The upstream package's DOCX model, parser, workers, WASM, and build
dependencies are not part of this project's runtime.

The local adapter admits only PNG and JPEG signatures and exposes only
`sniffRasterDimensions(Uint8Array)`. The upstream implementation remains
unmodified. Focused local tests cover supported headers, large declared
dimensions, and malformed or unsupported input. Updating the submodule pointer
therefore brings upstream parser fixes into a reviewed dependency update while
the adapter preserves this project's narrower format contract.
