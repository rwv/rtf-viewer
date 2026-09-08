# Verification record

Environment: 7 September 2026, Linux x86-64; Node 24.13.0; pnpm 10.33.0; Rust 1.98.1; wasm-bindgen CLI/crate 0.2.128; TypeScript 6.0.2; Vite 8.2.2; Vitest 4.1.4; Playwright 1.63.0 with its Chromium. Dependencies are pinned/locked; current official tooling documentation was checked during design rather than copying the upstream workspace wholesale. The chosen TypeScript/Vitest/esbuild versions are tested pins, not a claim to be the newest registry versions.

## Executed checks

| Command | Result |
| --- | --- |
| `cargo fmt --all -- --check` | Passed |
| `cargo clippy --workspace --all-targets -- -D warnings` | Passed |
| `pnpm test:rust` | 29 native parser tests passed, including bounded arbitrary-input sweep and resource ceilings |
| `pnpm check:contract` | Generated Rust/TypeScript model declarations match byte-for-byte |
| `pnpm test` | 19 tests passed across geometry, cancellation and reused image-header inspection |
| `pnpm build` | Real Rust-to-WASM library and production example built |
| `pnpm typecheck` | Library, example and browser-test types passed |
| `pnpm test:browser` | 14 production Chromium tests passed |
| `pnpm test:package` | Fresh tarball install, public declaration check, Vite build and browser engine probe passed |

The final combined run is `pnpm check`. This local evidence does not claim a remotely executed CI run. The checked-in GitHub Actions workflow repeats the gates from a clean checkout.

## Behavioral evidence

- The independent exact-line fixture has two 216 × 216 pt pages, with 15 and 9 lines. Page 1 starts at y=18 pt; its last line starts at y=186 pt. Page 2 starts with marker 16.
- Rendering that layout at 72 PPI produces 216 × 216 pixels; 144 PPI with scale 1.25 produces 540 × 540. The serialized layout is unchanged. The 144-PPI page bitmap is 432 × 432 and becomes width 0 after caller close.
- Unicode, escaped DBCS bytes/font switches, scoped bold and skipped destination text are asserted through the real Worker/WASM path.
- PNG/JPEG fixtures produce two 36 × 27 pt image rectangles, and the declared image regions contain the expected non-white raster content.
- Abort terminates the owned Worker. Late image decode after abort is closed. Destroy during viewer load rejects with AbortError. Separate canvases render concurrently; a shared target rejects contention. Borrowed viewer destruction preserves its engine.
- Font changes invalidate loaded layout. A change during measurement rejects that layout attempt. An explicit relayout advances the revision; painting never measures again.
- The LibreOffice 25.2.3.2-produced sample matches one page, 288 × 360 pt paper, 384 × 480 raster, reading order and all line breaks. Indent coordinates are checked against the independently exported PDF. Symmetric nearby-ink coverage against its PNG passes with a documented four-pixel tolerance; text/line/count/size assertions prevent a missing-content pass. Actual metric differences remain recorded in [compatibility](compatibility.md).

## Distribution

`artifacts/rtf-viewer-0.1.0.tgz` contains ESM JavaScript, public declarations, generated contract declarations, parser Worker, wasm-bindgen glue and a real `.wasm` file. A temporary application outside the workspace installs only this archive and its own Vite/TypeScript dependencies. It builds and renders two pages, checks line continuation, creates/closes a bitmap and tests borrowed viewer ownership. No repository source, Rust toolchain, submodule or development symlink is used by that consumer.

The final verified consumer build contains 22,042 bytes application JS, 2,664 bytes Worker and 307,818 bytes WASM (raw sizes). The packed library archive is 221,415 bytes. `artifacts/package-verification.json` records the exact filenames, sizes and successful behavioral result. The application JS includes the consumer probe and viewer import; these are measurements of this build, not universal bundle-size promises.

The final `pnpm check` completed with exit code 0: 29 native tests, 19 Vitest tests, 14 production browser tests and the separate packed-consumer integration. The full local output is retained in ignored `artifacts/final-verification.log`.

## Remaining limitations

No supplied synthetic fixture currently has a known content/page failure. The real LibreOffice sample produces compatibility diagnostics and has small font/rasterization differences. It is one document, not a representative office-document corpus. Word and TextEdit were unavailable; no output is falsely attributed to them.

True list numbering, table geometry, stylesheet inheritance, headers/footers, notes, section-specific pages, vector image drawing and full complex-script typography remain outside this first rendering-chain delivery. Font coverage across operating systems, Firefox/WebKit, other consumer bundlers and maximum-size performance remain unverified. WMF/EMF recognition retains placeholder geometry and diagnostics; the concrete rtf.js reuse experiment is documented separately.

The project is a local Git repository. It has no configured remote, npm publication or hosted deployment.
