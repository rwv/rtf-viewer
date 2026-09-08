# Verification record

Verification has three separate purposes: understand RTF rules, preserve rendering behavior, and prove the distributed package works. A passing self-rendered image is not an independent fidelity reference. Commands and fixture policy are in [testing](testing.md).

## Current source checks

`pnpm check` passes in full on Linux with Node 22.22.2, pnpm 10.33.0, Rust 1.98.1, wasm-bindgen 0.2.128, TypeScript 7.0.2, Vitest 5.0.0, Vite 8.2.2 and Playwright 1.63.0: formatting, syntax and type-aware lint, Rust fmt/clippy, 62 parser tests and 2 mutation-campaign tests, contract generation checks, 50 unit/adapter/corpus tests, all four TypeScript configurations, 75 production browser cases (25 per engine), and the installed archive consumer. That run used a Node older than the pinned `.node-version`; CI ran the same gate on the pinned version for [pull request #36](https://github.com/rwv/rtf-viewer/pull/36) and on the `v1.2.0` tag.

The ordinary-table slice adds 11 parser tests over row assembly, padding and border resolution and malformed row definitions; 8 geometry tests over column sums, non-overlap, padding, row heights, border rectangles and cross-page continuation; 7 corpus-manifest tests; and 2 browser cases. The synthetic table fixture asserts identical coordinates in all three engines because its exact line spacing makes every position independent of the font.

The metafile slice adds 5 parser tests over the supported bit depths and palette, top-down and bottom-up rows, the blit-selection rule, a crafted record whose offsets do not fit, and each rejected case keeping its placeholder with the right diagnostic; and 1 browser case. That browser case counts coloured pixels against the producer's own rendering rather than asserting pixel equality, because the engine scales a 121 × 81 embedded bitmap while the producer rasterised at its own resolution.

Parse latency and peak live allocation were measured with `pnpm bench:parser` on this Linux
container, release build, median of five parses per shape:

| Shape                     | Input KiB | Blocks | Median ms | Peak KiB |
| ------------------------- | --------: | -----: | --------: | -------: |
| prose, 12000 paragraphs   |      1594 |  12000 |      23.5 |     7609 |
| tables, 5000 rows         |      1300 |   5000 |      15.2 |    18455 |
| list, 20000 items         |       985 |  20002 |      20.6 |    13358 |
| unicode, 12000 paragraphs |       352 |  12000 |      10.0 |     6686 |

The budgets are 300 ms and 48 MiB per shape, roughly fifteen times the observed latency and two
and a half times the observed peak, so a real regression trips them and machine noise does not.
These are parser numbers on one machine; they are a regression baseline, not a promise about any
other hardware. Layout and paint latency remain unmeasured.

Layout and paint latency were measured with `pnpm bench:render` on the same container, Chromium,
production build, median of five runs per shape after one warm run:

| Shape                    | Input KiB | Pages | Fragments | Load ms | Layout ms | Paint ms |
| ------------------------ | --------: | ----: | --------: | ------: | --------: | -------: |
| prose, 2000 paragraphs   |       265 |    87 |    84,000 |   444.3 |     402.1 |      9.9 |
| tables, 1000 rows        |       254 |    22 |    15,000 |   653.8 |     586.1 |     22.5 |
| list, 3000 items         |       146 |    66 |    45,000 |   570.2 |     487.4 |      9.3 |
| unicode, 2000 paragraphs |        83 |    44 |    14,000 |   338.3 |     304.2 |      9.1 |

Load is the whole public path and layout is `relayout()` alone, so the gap between the two columns
is parse plus fonts. Paint is one page at 96 PPI. The budgets are 4,000 ms, 3,600 ms and 150 ms,
about six times the observed medians.

The first run of this benchmark found a defect worth the whole exercise: the table shape took
12,936 ms to lay out, twenty-one times the per-fragment cost of prose. The cause was the yield
cadence, not the geometry. Layout releases the main thread by awaiting a timer, and every call
site yielded on a count of work — every 32 blocks, every 2,048 graphemes, every 32 painted lines —
except the cell path, which yielded once per cell. A nested `setTimeout` is clamped to about four
milliseconds, so a thousand three-cell rows spent three thousand yields, roughly twelve seconds, in
timers rather than in layout. Yields are now counted once for the whole flow, and the same document
lays out in 586 ms. A deterministic test in the fast gate asserts the count: 240 blocks yield seven
times, where the defect yielded 182.

The primitive is still a clamped timer rather than an unclamped task. At about four milliseconds a
yield, the counts above put roughly 250 to 500 ms of each shape's layout in timers rather than in
work, which would make it the largest single cost left. That arithmetic is an estimate, not a
measurement, and confirming or correcting it is issue #41 rather than something folded in here.

**The Worker decision this measurement was for**: laying out a 87-page document costs 402 ms and
painting a page costs 10 ms, both in yield-interrupted slices rather than one block. Moving layout
into a Worker buys a serialization boundary for every fragment and a font-measurement problem —
Canvas metrics are not available to a Worker without transferring or duplicating the font state —
in exchange for removing work that already yields roughly every 32 blocks. On this evidence M7 is
not worth doing for layout latency alone. It stays on the roadmap for the case it actually serves,
a document large enough that even sliced layout is disruptive, and that case needs a document to
be measured, not an assumption.

The seeded mutation campaign found a real panic the first time it ran: an empty `\leveltext`
group sliced a zero-length vector from index one, reachable from any document. It is fixed, and
its minimized input is retained in `fuzz/regressions/` and replayed by the fast gate. A
demonstrated libFuzzer run then managed 196,354 executions in 61 seconds with no further crash.

Negative probes confirmed that focused Playwright/Vitest tests, floating Promises, and Node globals in browser library code are rejected. Actionlint passes. The formatting-only commit preserved canonical emitted JavaScript for all 22 affected TypeScript files.

The shared registry consumer was exercised against the existing 1.0.3 package: its downloaded SHA-256 matched `6d1804cdd3735744efa8c7857cc7ccf1bc10e42cf7f59aa258ddff45f4f7dd9b`, npm signature/provenance verification passed, and declaration compilation plus production rendering passed. Each subsequent release records its own registry outcome in `registry-verification.json`; this prototype does not claim a future package has already passed.

## Version 1.0.3 source checks

The issue #5 fixes passed `pnpm check` locally on Linux with Node 24.13.0, pnpm 10.33.0, Rust 1.98.1, wasm-bindgen 0.2.128, TypeScript 7.0.2, Vitest 5.0.0, Vite 8.2.2 and Playwright 1.63.0. These checks cover the fixes introduced in 1.0.3; the 1.0.2 package does not contain them.

| Check                           | Result                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native Rust                     | 34 parser tests passed, including all requested numeric codepages, UTF-16 ASCII-range bytes, malformed sequences and font cpg overrides                 |
| Generated contract              | Byte-for-byte Rust/TypeScript match                                                                                                                     |
| Pure logic and upstream adapter | 25 tests passed, including integral/fractional raster extents, canvas limits, wrapped-tab geometry and the actual upstream signature                    |
| Builds and type checking        | Library, example, public declarations, Worker and Node build code passed                                                                                |
| Production browser              | 51 tests passed: 17 each in Chromium, Firefox and WebKit, including exact encoding fixtures, 150-PPI Canvas/bitmap sizes and relevant font invalidation |
| Installed package               | One Playwright consumer passed after a fresh npm install, strict public API compilation and Vite production build                                       |

The consumer asserts two pages with 15 and 9 lines, continuation text, physical Canvas dimensions, caller-owned ImageBitmap close, and borrowed viewer ownership. Both automatic asset discovery and explicit Worker/WASM URLs work at `/viewer/`; no request failed. It compiles every documented public type and exercises `RtfDocument`, `layoutDocument`, and `pixelSize`. The packed WASM also decodes UTF-16 ASCII-range bytes and surrogate pairs; an empty font event leaves the document renderable; 150-PPI output has the exact physical dimensions. The archive and report are written to ignored `artifacts/` and tied together by SHA-256.

The reported consumer regression suite was independently reproduced at its pinned source revision before the fix: 51 passing and 30 failing cases across the three engines. The local issue #5 browser assertions likewise failed on the original production bundle before the fix. Expected Unicode text and physical pixel sizes are independent assertions, not snapshots generated by this renderer.

The consumer linked from [issue #5](https://github.com/rwv/rtf-viewer/issues/5), pinned at `253a51cdf8720272cbc7fc32f035ecd5275427a2`, was then run against the packed fix: **81/81 passed**, 27 each in Chromium, Firefox and WebKit. Its command was `pnpm test:unit --run --browser.headless packages/document-renderer/rtf/src/__tests__/index.browser.test.ts`. The tested local archive was 230,655 bytes, SHA-256 `6c45ff9e890bb847865c6f2042d6da5cabb6e5db244075a9bf4acf67c4ea7649`. It retained the source version field `1.0.2` for local testing; these were unpublished fix bytes, not the registry's immutable 1.0.2 artifact. The consumer's original dependency link was restored and its worktree remained clean. Registry verification is repeated against the actual published version and recorded separately from this local archive.

The source import uses upstream commit `04d5597676b7532b463db9eb5951d99334a153fe`. Its adapter probe is 3,671 bytes raw / 1,388 gzip; the full upstream checkout is a development cost, not npm package content. The packed package has no submodule files or upstream declaration dependency. Source maps intentionally preserve source/license provenance. See [reuse evaluation](reuse-evaluation.md) for the public-package and source-import experiments.

Release Please v17.6.0 was exercised in an isolated clone with the actual configuration and a synthetic `fix:` commit. Its dry-run found `v1.0.1` and proposed `v1.0.2`, updating only the root/public package versions, root changelog, and manifest. No Cargo file changed. After [implementation PR #6](https://github.com/rwv/rtf-viewer/pull/6) passed a [clean GitHub checkout and full verification](https://github.com/rwv/rtf-viewer/actions/runs/34196646334), the environment-scoped token successfully created [release PR #7](https://github.com/rwv/rtf-viewer/pull/7). Dependabot also completed its initial submodule update check. The release PR remains the maintainer's publication gate; creating it is not an npm publication.

## Independent rendering evidence

The committed LibreOffice 25.2.3.2 sample is compared to an independently exported PDF/PNG: page count, paper size, line text, indent coordinates and nearby-ink coverage are checked. Known metric/rasterization differences are documented in [compatibility](compatibility.md). Fixed test fonts keep this comparison reproducible.

The LibreOffice 24.2.7.2 table sample is compared to its own exported PDF, Poppler text extraction and rasterised pages. The engine produces the same three pages and the same line breaks inside cells: every line it emits appears unbroken in the producer's text extraction. Cell content left edges are offset by a uniform 0.40 to 0.45 pt because the producer insets content by the cell border in addition to the declared padding. Four differences are measured and classified in `fixtures/corpus.json`, the largest being a 0.65 pt per row line-box shortfall that moves which row breaks across a page. `scripts/corpus.ts` keeps that record honest by failing when a hash, a file or a producer document stops matching the manifest.

The LibreOffice 24.2.7.2 list sample is compared to Poppler's extraction of the producer's own PDF. The engine's generated markers are identical to the producer's, marker for marker, across two levels, bullets and an override that starts at seven; the one recorded difference is that the producer pads its cached marker with a leading space that the level template does not declare.

The LibreOffice 24.2.7.2 metafile sample is compared to the producer's own rasterised page. The engine draws 10,177 coloured pixels at 96 ppi to the reference's 10,384, and the bitmap it reads out of the metafile carries the source SVG's colours exactly. Pixel equality is not asserted and would be the wrong assertion: the producer rasterised at its own resolution and the engine scales a 121 × 81 source into the authored rectangle.

No supplied synthetic fixture currently has a known content/page failure. Four LibreOffice samples are still not a representative corpus, and all come from one application family. Word/TextEdit references, additional bundlers, broad complex-script behavior and maximum-size performance remain unverified. Vertically merged cells, nested tables and repeated header rows have no layout support and are only diagnosed; a metafile drawn with vector records rather than an embedded bitmap still shows its placeholder. Passing the three browser suites does not imply pixel-identical output across browsers. Unsupported RTF features remain listed in the [support matrix](support-matrix.md).

## v1.2.0: Cell alignment and shading, merged cells and real lists

[`v1.2.0`](https://github.com/rwv/rtf-viewer/releases/tag/v1.2.0) was published by [Actions run 34235489864](https://github.com/rwv/rtf-viewer/actions/runs/34235489864) from commit `bdee898c969d8970727a0350553275bccdde08b1`. All four release jobs succeeded in order, the same sequence as v1.1.0: Release Please created the tag and release, `verify` re-ran the complete `pnpm check` on the tagged commit and checked the packed archive against its recorded hashes, `publish` uploaded through npm OIDC and the `npm` GitHub Environment, and `verify-registry` reinstalled the published package.

The registry archive is byte-identical to the tested GitHub asset: 261,613 bytes, SHA-256 `da191bad8c39f3dc046f851fcf04494f955b34e771f5d5769888cce983eacbe1`, integrity `sha512-txup1CILRFRRfxkRPUZp+sDvldy1uI9H1wZTjrMUGx8H+6fpu7KKUJBhd5Epg7FRfLaU6RtB6Qtz2BhN2CVNeQ==`. npm signature verification passed. The registry consumer built and rendered from the installed package with explicit Worker and WASM URLs, producing the expected two pages, fifteen first-page lines and a 432 × 432 bitmap, with no failures. Its report is the [registry verification asset](https://github.com/rwv/rtf-viewer/releases/download/v1.2.0/registry-verification.json).

This release carries vertical cell alignment and cell shading (#25), horizontally merged cells (#28), real list numbering resolved from the document's list tables (#30), and the empty-`\leveltext` panic fix with the fuzz and parse-performance baseline (#19). It is a compatible minor release: `TableCell.verticalAlign` and `TableCell.shading` are optional additions and no existing export changed shape. Documents that previously rendered a list from its cached `\listtext`, or a merged row as separate cells, now render differently, which the [README](../README.md#public-api-and-versioning) reserves for minor releases.

## v1.1.0: Ordinary tables and the producer corpus

[`v1.1.0`](https://github.com/rwv/rtf-viewer/releases/tag/v1.1.0) was published by [Actions run 34223789137](https://github.com/rwv/rtf-viewer/actions/runs/34223789137) from commit `a9b8a9418427540355eaa2d838dea5ab7851595d`. All four release jobs succeeded in order: Release Please created the tag and release, `verify` re-ran the complete `pnpm check` on the tagged commit and checked the packed archive against its recorded hashes, `publish` uploaded through npm OIDC and the `npm` GitHub Environment, and `verify-registry` reinstalled the published package.

The registry archive is byte-identical to the tested GitHub asset: 246,145 bytes, SHA-256 `21dcbb84cfeed41cbf480ad235e70f986b16aecdbde7f16ac70ec5005c73b26e`, integrity `sha512-hABuBPCffgUa2EtxZwr3jhNWTb1uLnL4XsDUgSgPbUnxrG7szFEo0L4hxOuY7oK0EEH1enleBjA8Wt3d2NVKoA==`. npm signature verification passed. The registry consumer built and rendered from the installed package with explicit Worker and WASM URLs, producing the expected two pages, fifteen first-page lines and a 432 × 432 bitmap, with no failures. Its report is the [registry verification asset](https://github.com/rwv/rtf-viewer/releases/download/v1.1.0/registry-verification.json).

This release carries the ordinary-table geometry and the validated producer corpus from [pull request #22](https://github.com/rwv/rtf-viewer/pull/22), closing issues #20 and #21. It is a compatible minor release: `PageLayout.decorations` and `RuleFragment` are additive, and no existing export changed shape. Documents that previously rendered a table as tab-separated reading-order text now render real cell geometry, so their rendered pixels change; the [README](../README.md#public-api-and-versioning) already reserves that for minor releases.

## v1.0.3: Issue #5 fixes

The [1.0.3 release](https://github.com/rwv/rtf-viewer/releases/tag/v1.0.3) carries the tested package, checksum, manifest and package-verification report. Post-publication [registry-consumer evidence](https://github.com/rwv/rtf-viewer/releases/download/v1.0.3/registry-verification.json) records the registry archive's integrity, matching release source and the repeat of the consumer's three-browser regression suite. Release assets distinguish the published bytes from the earlier local prototype above.

## v1.0.2: Release Please publication

[`v1.0.2`](https://github.com/rwv/rtf-viewer/releases/tag/v1.0.2) was published by [Actions run 34198290285](https://github.com/rwv/rtf-viewer/actions/runs/34198290285) after merging Release Please PR #7. The registry archive exactly matched the tested GitHub asset: 228,478 bytes, SHA-256 `eec20bc8235933ebe0055b3fe0fc8f0899b90c153239272be4092f3f523db045`. Its provenance identifies commit `353f7686e2b86a7870f8d32ed520e28e44b7de7c`. This historical release predates the issue #5 fixes above.

## v1.0.1: GitHub Actions to npm

[`v1.0.1`](https://github.com/rwv/rtf-viewer/releases/tag/v1.0.1) was published by [Actions run 34192800727](https://github.com/rwv/rtf-viewer/actions/runs/34192800727) through npm OIDC and GitHub Environment `npm`. The registry and GitHub archives were identical: 222,636 bytes, SHA-256 `da5fa55f07e40e252e3929097aed0818ef7017610b18e09752ddf02fecd75fdf`. Registry provenance matched the workflow, tag and commit; a separate registry-installed consumer passed the production build and browser checks.

The [historical verification record](https://github.com/rwv/rtf-viewer/blob/f765968c3e01cffa7aa40214d1cfda6a0194cb60/docs/verification.md) retains earlier commands, measurements and bootstrap details. These historical package sizes are not promises about later builds. GitHub release assets and their associated reports are the authoritative evidence for each published version.
