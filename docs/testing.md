# Testing strategy

Tests distinguish specification interpretation, geometry, runtime integration, regressions and fidelity. A nonempty canvas proves none of these by itself.

## Native parser

Small byte fixtures isolate scoped state restoration, signed parameters and invalid delimiters; escaped braces/backslash/hex; raw and escaped multibyte codepages; font-level codepage overrides; uc defaults/scope; fallback controls and binary tokens; surrogate pairs; unknown destinations; font/color tables; plain/pard; malformed nesting, truncated binary and resource limits. Assert decoded text, resolved properties, offsets and diagnostic codes. Deterministic arbitrary-byte tests verify no panic, not just valid examples.

The model generator derives TS from Rust. A separate drift check fails if committed TS differs. Browser tests invoke the actual WASM through the emitted Worker and assert semantic results, not a JS substitute.

## Pure layout

Inject a deterministic measurer into layout tests. Assert source text preservation, word/CJK/grapheme boundaries, first-line/hanging indents, alignment, spacing modes, explicit breaks and automatic page counts. Check finite coordinates, bounded line boxes, progress for oversized content and zero dependence on paint resolution. Table tests check that column widths sum to the row width, that neighbouring cells do not overlap, that padding insets content, that at-least and exact row heights behave differently, that a row continues across a page at a line boundary with each fragment closed by its borders, and that an invalid cell boundary is skipped rather than producing overlapping geometry. Vertical alignment is checked for centre and bottom offsets in a row taller than the cell, for an unchanged cell that already fills its row, and for a split row that keeps its content at the top; shading is checked for the blend at zero, full and intermediate intensity and for the fill rectangle covering exactly the cell box. Horizontal merges are checked for the widened content box and for the boundary the merge removes. List markers are checked for their position at the paragraph start, each level-follow value and hanging-indent alignment of the wrapped body. They assert coordinates and colours, not snapshots of internal objects.

## Browser and distribution

Playwright loads a production-built example in Chromium, Firefox and WebKit. Explicitly load fixed local test fonts. Check text metrics, representative pixel locations, Canvas dimensions, ImageBitmap dimensions/close, Worker parse output, AbortError, repeated destroy, late-resource disposal, canvas contention and viewer ownership. Exercise file upload, page navigation, zoom and PNG download. Track requests so required WASM/Worker assets return successfully and no third-party resources are fetched. Install the three engines with `pnpm exec playwright install --with-deps chromium firefox webkit`; use `--project chromium` (or `firefox`/`webkit`) for a focused run.

The issue #5 regressions assert exact Unicode text for 15 compatibility encoding cases plus three UTF-16 ASCII-range cases through the real WASM Worker. Separate assertions verify that 150-PPI Canvas and ImageBitmap extents match physical paper, without changing layout. Font tests load actual local FontFace resources and distinguish unrelated completions from changes that require explicit relayout. Chromium and Firefox must emit native completion events in that test. WebKit can omit completion for a script-initiated load; there the event-filter assertion uses the real loaded face in an equivalent event, and the API documents explicit host relayout for eventless changes. Native tests also cover expanded numeric mappings, malformed sequences and font-level overrides.

A separate temporary consumer uses `npm install --ignore-scripts` to install the `.tgz` produced by `pnpm pack`, compiles the public declarations, builds with Vite and executes headless API tests against its production output at `/viewer/`. Both automatic asset discovery and explicit Worker/WASM URLs must work from the installed package without reaching into this repository. Consumers do not install Rust or initialize submodules. The report records the archive SHA-256; publication verifies those same bytes.

The consumer is a normal Playwright test in `tests/package.spec.ts`, with a separate configuration so it needs no example server. It compiles every public type export and exercises all three engine runtime exports. Package versions, file inclusion, source notices, automatic/explicit asset URLs, page continuation, bitmap dimensions and ownership are asserted. Passing evidence is written only after all assertions succeed. The release workflow verifies the archive checksum and version before publication; Release Please owns version/changelog/tag generation.

## Fixtures and provenance

- `fixtures/synthetic`: original minimal public-domain (CC0) documents, each with a stated rule or purpose. Keep bytes unambiguous; use binary fixture generation when needed.
- `fixtures/real`: documents actually generated by an identified application. Record application/version, OS, font family and file hashes. Keep a reproducible source and generation command where possible.
- `fixtures/reference`: independent reference images/PDF/text with provenance and allowed redistribution. The specification PDF is linked, not vendored.
- `fixtures/corpus.json`: the machine-readable record tying each real document to its producer, fonts, references and classified deltas. `scripts/corpus.ts` validates it in `pnpm test` and fails on a stale hash, a missing file, an unknown delta classification or a producer document nobody described. See [corpus](corpus.md).

Use installed LibreOffice to generate a real producer sample and PDF reference when available. Word and TextEdit require verified producer access; never label a handcrafted file as their output. Missing producer coverage is an open validation task, not a simulated pass. Distinguish normative rules from producer disagreements and maintain named failing samples.

## Visual evidence

Fixed-font browser snapshots detect rendering regressions. They are not proof of external fidelity. Compare representative pages to a separate desktop producer export; record page count, text, geometry and observed differences. A human/agent review must inspect the image when establishing a baseline. Do not update snapshots solely to make tests pass. Environmental font/rasterizer differences need investigation.

## Acceptance log

The final implementation report must record actual commands, versions, pass/fail counts, asset sizes, independent comparison results and unresolved failures. CI runs the repeatable native, contract, TS, build, browser and packed-consumer gates from a clean checkout.

## Current executable gates

`pnpm check` runs native Rust tests, generated-contract drift verification, Vitest geometry/resource tests, library/example builds, TypeScript checking, production Playwright tests and a newly installed tarball consumer. CI also checks Rust formatting and clippy. Cargo builds, tests, and contract generation use the committed lockfile with `--locked`. Browser integration invokes the real compiled Rust parser.

| Command               | Scope                                                                         |
| --------------------- | ----------------------------------------------------------------------------- |
| `pnpm test:rust`      | Byte parser and resource bounds                                               |
| `pnpm check:contract` | Rust-generated model matches the committed TypeScript                         |
| `pnpm test`           | Deterministic geometry, lifecycle, upstream image adapter and corpus manifest |
| `pnpm check:corpus`   | Corpus manifest against the files on disk, on its own                         |
| `pnpm build`          | WASM, browser library, declarations and example                               |
| `pnpm typecheck`      | Browser, Worker, tests and Node build configuration                           |
| `pnpm test:browser`   | Production example and engine integration; run after build                    |
| `pnpm test:package`   | Pack once, install outside the workspace, type-check, build and run           |

Upstream commit updates use the same complete CI gate. The Git submodule is initialized during source checkout, but its workspace is never installed or built. Both the original upstream signature and our PNG/JPEG behavior are checked. `artifacts/build-meta.json` records the actual build inputs and outputs for dependency/size review. The packed consumer contains bundled JavaScript and uses no submodule.

The independent visual test compares the actual LibreOffice-generated reference PNG with engine ink using a documented four-pixel neighborhood at 96 PPI, paired with exact line text, page count, physical size and indent assertions. It is a tolerant regression check for one known producer document, not a general fidelity score. No project-generated image is used as its own correctness oracle.

Use `pnpm generate:types` after model changes; `pnpm check:contract` must pass before committing. Test outputs, screenshots, packed archives and size measurements are written to ignored `artifacts/` or `test-results/`. Reference generation needs LibreOffice/Pillow/Poppler but ordinary CI consumes the committed licensed artifacts and does not require those tools.

## Engineering gate

`pnpm check` also runs Prettier, selected Oxlint correctness/Promise rules, Rust fmt/clippy, and all four TypeScript configurations. `quality` runs formatting, syntax lint, workflow validation and PR title validation before browser setup; `verify` runs the full gate. Both Playwright configurations and Vitest reject focused tests in CI. See [CONTRIBUTING.md](../CONTRIBUTING.md) for commands and generated/upstream exclusions.

The package consumer also runs after publication against the exact npm version and tested integrity, including npm signature/provenance verification. Archive and registry modes share the same geometry, declaration and resource-loading assertions. Every install/build subprocess is asynchronous with a 60-second timeout; runtime page errors fail the test. See [release verification](releasing.md#postpublication-verification).
