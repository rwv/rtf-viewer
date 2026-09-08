# Changelog

This project follows [Semantic Versioning](https://semver.org/). RTF feature coverage can grow in compatible minor releases; the public model and layout evolution rules are documented in the [README](https://github.com/rwv/rtf-viewer#public-api-and-versioning).

## [1.0.3](https://github.com/rwv/rtf-viewer/compare/v1.0.2...v1.0.3) (2026-09-08)


### Bug Fixes

* correct codepage decoding, font invalidation and raster dimensions ([#10](https://github.com/rwv/rtf-viewer/issues/10)) ([9469fb4](https://github.com/rwv/rtf-viewer/commit/9469fb490b8be91495c0de023a163c808bb6795f))

## [1.0.2](https://github.com/rwv/rtf-viewer/compare/v1.0.1...v1.0.2) (2026-09-08)


### Bug Fixes

* bind release retries to the published source tag ([#9](https://github.com/rwv/rtf-viewer/issues/9)) ([7c86d9b](https://github.com/rwv/rtf-viewer/commit/7c86d9bbb681f3ccb29a4d779b85f9e96731332f))
* simplify releases and track upstream image updates ([#6](https://github.com/rwv/rtf-viewer/issues/6)) ([c4c6417](https://github.com/rwv/rtf-viewer/commit/c4c641722052f2f138fc84c64714ef574187f944))

## 1.0.1 - 2026-09-07

Released 7 September 2026. Documentation and publishing update only; runtime behavior and RTF support are unchanged from 1.0.0.

### Changed

- Made the published npm package the primary installation path and updated the GitHub archive fallback.
- Recorded the completed v1.0.0 bootstrap publication and the GitHub Actions OIDC release procedure.
- Bound the npm publishing job to the `npm` GitHub Environment; version tags publish automatically, and manual runs respect the `publish_npm` input.

## 1.0.0

Released 7 September 2026. First supported public API baseline.

### Added

- Browser `RtfDocument` API for bounded byte parsing in a dedicated Rust/WebAssembly Worker, complete pagination, immutable page geometry, Canvas rendering, and caller-owned page bitmaps.
- Framework-free `RtfViewer` entry point for local document loading, page navigation, zoom, and Canvas rendering.
- Public custom-layout and pixel-sizing utilities with generated TypeScript model declarations.
- Explicit cancellation, parser timeouts, repeatable destruction, font invalidation and relayout, render-contention checks, and resource ceilings.
- Verified subsets for Unicode and common Windows/East Asian codepages, font/color tables, scoped direct character styles, paragraph alignment/indents/spacing, explicit and automatic pagination, and inline PNG/JPEG pictures.
- Production Worker/WASM asset resolution and a packed-package consumer test.

### Known limitations

- This release does not claim complete RTF fidelity. Stylesheet inheritance, true list numbering, table geometry, headers/footers, notes, section-specific pages, WMF/EMF drawing, floats/shapes, and full complex-script typography remain incomplete or planned.
- Tables and lists preserve bounded reading-order fallbacks with diagnostics; those fallbacks are not layout or numbering support.
- Chromium with Vite is the verified browser/bundler baseline. Firefox, WebKit, other bundlers, broad producer corpora, and maximum-size performance remain unverified.
- Compatibility evidence covers the synthetic fixture set and one LibreOffice 25.2.3.2 document. It does not establish general LibreOffice, Microsoft Word, or Apple TextEdit fidelity.
