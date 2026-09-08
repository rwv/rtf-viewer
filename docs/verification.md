# Verification record

This page records the local v1.0.0 verification on 7 September 2026 and the earlier implementation baseline. Remote runs are recorded separately in [GitHub Actions](https://github.com/rwv/rtf-viewer/actions); registry publication is a separate step.

Environment: Linux x86-64; Node 24.13.0; pnpm 10.33.0; Rust 1.98.1; wasm-bindgen CLI/crate 0.2.128; TypeScript 6.0.2; Vite 8.2.2; Vitest 4.1.4; Playwright 1.63.0 with its Chromium. Dependencies are pinned/locked; current official tooling documentation was checked during design rather than copying the upstream workspace wholesale. The chosen TypeScript/Vitest/esbuild versions are tested pins, not a claim to be the newest registry versions.

The final release build uses esbuild 0.28.1. GitHub's initial dependency scan identified development-server advisories in the earlier esbuild pin and the isolated reuse experiment's Vite pin. They were updated to esbuild 0.28.1 and Vite 8.0.16 respectively before tagging v1; neither development dependency ships as a runtime dependency of the public package.

## Executed checks

| Command | Result |
| --- | --- |
| `cargo fmt --all -- --check` | Passed |
| `cargo clippy --workspace --all-targets -- -D warnings` | Passed |
| `pnpm test:rust` | 29 native parser tests passed, including bounded arbitrary-input sweep and resource ceilings |
| `pnpm check:contract` | Generated Rust/TypeScript model declarations match byte-for-byte |
| `pnpm test` | 19 tests passed across geometry, cancellation and reused image-header inspection |
| `pnpm test:release` | 5 release guard tests passed: dated notes, version/tag/source checks, main ancestry and altered archive rejection |
| `pnpm build` | Real Rust-to-WASM library and production example built |
| `pnpm typecheck` | Library, example and browser-test types passed |
| `pnpm test:browser` | 14 production Chromium tests passed |
| `pnpm test:package` | Fresh npm tarball install with scripts disabled, public declarations, Vite subpath build and automatic/explicit asset probes passed |
| `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12` | Workflow validation passed |

The combined gate is `pnpm check`. The [first remote Verify run](https://github.com/rwv/rtf-viewer/actions/runs/34188748998) passed on release-preparation commit `373599c`, including the complete checks from a clean GitHub-hosted Ubuntu 24.04 runner. The tag-triggered Release workflow repeats verification before creating downloadable assets. A separate local clone of implementation commit `65f1709` also passed `pnpm install --frozen-lockfile`, `pnpm build` and `pnpm typecheck` with no generated assets carried over; its WASM was rebuilt from source.

## Behavioral evidence

- The independent exact-line fixture has two 216 × 216 pt pages, with 15 and 9 lines. Page 1 starts at y=18 pt; its last line starts at y=186 pt. Page 2 starts with marker 16.
- Rendering that layout at 72 PPI produces 216 × 216 pixels; 144 PPI with scale 1.25 produces 540 × 540. The serialized layout is unchanged. The 144-PPI page bitmap is 432 × 432 and becomes width 0 after caller close.
- Unicode, escaped DBCS bytes/font switches, scoped bold and skipped destination text are asserted through the real Worker/WASM path.
- PNG/JPEG fixtures produce two 36 × 27 pt image rectangles, and the declared image regions contain the expected non-white raster content.
- Abort terminates the owned Worker. Late image decode after abort is closed. Destroy during viewer load rejects with AbortError. Separate canvases render concurrently; a shared target rejects contention. Borrowed viewer destruction preserves its engine.
- Font changes invalidate loaded layout. A change during measurement rejects that layout attempt. An explicit relayout advances the revision; painting never measures again.
- The LibreOffice 25.2.3.2-produced sample matches one page, 288 × 360 pt paper, 384 × 480 raster, reading order and all line breaks. Indent coordinates are checked against the independently exported PDF. Symmetric nearby-ink coverage against its PNG passes with a documented four-pixel tolerance; text/line/count/size assertions prevent a missing-content pass. Actual metric differences remain recorded in [compatibility](compatibility.md).

## Distribution

The v1.0.0 run of `pnpm check` completed with exit code 0. Its separate consumer installed `rtf-viewer-1.0.0.tgz` through `npm install --ignore-scripts` and rendered at the `/viewer/` deployment base. Both bundled asset discovery and explicit URLs to copies of the installed Worker/WASM passed; the report contains no request failures. The output retained two pages with 15 and 9 lines and produced the expected 432-pixel bitmap.

The final local v1 archive is 222,463 bytes. Its consumer build emits 22,426 bytes application JS, a 2,671-byte Worker, and 307,941 bytes WASM. `artifacts/package-manifest.json`, `artifacts/SHA256SUMS`, and `artifacts/package-verification.json` tie the tested archive to its checksum; `artifacts/v1-verification.log` records the successful full check after the development dependency fixes. The README-only adjustment was also rebuilt and its tarball consumer rerun successfully in `artifacts/v1-package-final.log`. The release workflow rebuilds from the tag and publishes its own verified archive and measurements, which are authoritative for the downloadable release. Sizes are raw measurements of the named build, not universal bundle promises.

### Earlier implementation evidence

The pre-release package probe used `artifacts/rtf-viewer-0.1.0.tgz`. That historical archive contained ESM JavaScript, public declarations, generated contract declarations, parser Worker, wasm-bindgen glue and a real `.wasm` file. A temporary application outside the workspace installed only this archive and its own Vite/TypeScript dependencies. It built and rendered two pages, checked line continuation, created/closed a bitmap and tested borrowed viewer ownership. No repository source, Rust toolchain, submodule or development symlink was used by that consumer.

That pre-release consumer build contained 22,042 bytes application JS, 2,664 bytes Worker and 307,941 bytes WASM (raw sizes). Its packed library archive was 221,430 bytes. `artifacts/package-verification.json` recorded the exact filenames, sizes and successful behavioral result. The application JS included the consumer probe and viewer import; these are historical measurements of that build, not universal bundle-size promises or measurements of the final v1 archive.

The baseline `pnpm check` completed with exit code 0: 29 native tests, 19 Vitest tests, 14 production browser tests and the separate packed-consumer integration. The full local output was retained in ignored `artifacts/final-verification.log`.

## Remaining limitations

No supplied synthetic fixture currently has a known content/page failure. The real LibreOffice sample produces compatibility diagnostics and has small font/rasterization differences. It is one document, not a representative office-document corpus. Word and TextEdit were unavailable; no output is falsely attributed to them.

True list numbering, table geometry, stylesheet inheritance, headers/footers, notes, section-specific pages, vector image drawing and full complex-script typography remain outside the v1 rendering baseline. Font coverage across operating systems, Firefox/WebKit, other consumer bundlers and maximum-size performance remain unverified. WMF/EMF recognition retains placeholder geometry and diagnostics; the concrete rtf.js reuse experiment is documented separately.

Remote CI, GitHub Release creation, and npm availability are separate release results and are not asserted by this local record. See the [release procedure](releasing.md) for those gates.
