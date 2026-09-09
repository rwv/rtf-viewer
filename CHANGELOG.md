# Changelog

This project follows [Semantic Versioning](https://semver.org/). RTF feature coverage can grow in compatible minor releases; the public model and layout evolution rules are documented in the [README](https://github.com/rwv/rtf-viewer#public-api-and-versioning).

## [1.3.0](https://github.com/rwv/rtf-viewer/compare/v1.2.0...v1.3.0) (2026-09-09)


### Features

* draw the bitmap a rasterising producer embeds in a metafile ([#36](https://github.com/rwv/rtf-viewer/issues/36)) ([24ba728](https://github.com/rwv/rtf-viewer/commit/24ba7283d87c15076e5564412044221c7e6e0065)), closes [#35](https://github.com/rwv/rtf-viewer/issues/35)
* measure the line box once per face, and let the caller declare it ([#45](https://github.com/rwv/rtf-viewer/issues/45)) ([1589a27](https://github.com/rwv/rtf-viewer/commit/1589a2756ef43c1e9c29a5880d99eb95379888e3)), closes [#44](https://github.com/rwv/rtf-viewer/issues/44)


### Bug Fixes

* close the edge a page break creates in a split table row ([#43](https://github.com/rwv/rtf-viewer/issues/43)) ([32f172f](https://github.com/rwv/rtf-viewer/commit/32f172fd856e946dcaae2e02bd3dd8b15b3e0a85)), closes [#42](https://github.com/rwv/rtf-viewer/issues/42)


### Performance Improvements

* use unclamped tasks for cooperative yielding ([#46](https://github.com/rwv/rtf-viewer/issues/46)) ([6a09564](https://github.com/rwv/rtf-viewer/commit/6a095643d6d2e96d2b1c0bd042687cb08387fead))
* yield on the work done rather than once per table cell ([#40](https://github.com/rwv/rtf-viewer/issues/40)) ([1ae4965](https://github.com/rwv/rtf-viewer/commit/1ae496523548f487d8487b48383968bf0ef3c434)), closes [#39](https://github.com/rwv/rtf-viewer/issues/39)

## [1.2.0](https://github.com/rwv/rtf-viewer/compare/v1.1.0...v1.2.0) (2026-09-08)


### Features

* honour vertical cell alignment and cell shading ([#26](https://github.com/rwv/rtf-viewer/issues/26)) ([2ca52c1](https://github.com/rwv/rtf-viewer/commit/2ca52c1635be8dd570d0e4ee3f3fd75a8d324908)), closes [#25](https://github.com/rwv/rtf-viewer/issues/25)
* merge horizontally merged table cells into one cell ([#29](https://github.com/rwv/rtf-viewer/issues/29)) ([e68f00b](https://github.com/rwv/rtf-viewer/commit/e68f00b3517db5323db3adba76227e0a3395eed5)), closes [#28](https://github.com/rwv/rtf-viewer/issues/28)
* resolve real list numbering from the document's list tables ([#31](https://github.com/rwv/rtf-viewer/issues/31)) ([7ab6bd7](https://github.com/rwv/rtf-viewer/commit/7ab6bd7222f69363a2052ae49f7432ccd857d70d)), closes [#30](https://github.com/rwv/rtf-viewer/issues/30)


### Bug Fixes

* stop an empty leveltext group panicking, and add the fuzz and performance baseline ([#32](https://github.com/rwv/rtf-viewer/issues/32)) ([9d0e4d7](https://github.com/rwv/rtf-viewer/commit/9d0e4d79841396a0eec13dcf09d0b4dcc90220c2)), closes [#19](https://github.com/rwv/rtf-viewer/issues/19)

## [1.1.0](https://github.com/rwv/rtf-viewer/compare/v1.0.4...v1.1.0) (2026-09-08)


### Features

* ordinary table geometry and a validated producer corpus ([#22](https://github.com/rwv/rtf-viewer/issues/22)) ([2d6ce38](https://github.com/rwv/rtf-viewer/commit/2d6ce383988c4104edb8ab2a33f0b40f010471d5)), closes [#20](https://github.com/rwv/rtf-viewer/issues/20) [#21](https://github.com/rwv/rtf-viewer/issues/21)

## [1.0.4](https://github.com/rwv/rtf-viewer/compare/v1.0.3...v1.0.4) (2026-09-08)


### Bug Fixes

* reject renders superseded by relayout ([#13](https://github.com/rwv/rtf-viewer/issues/13)) ([8868419](https://github.com/rwv/rtf-viewer/commit/8868419ee8ef855ebe94d01a908f78c913201ac9))

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
