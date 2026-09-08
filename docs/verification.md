# Verification record

Verification has three separate purposes: understand RTF rules, preserve rendering behavior, and prove the distributed package works. A passing self-rendered image is not an independent fidelity reference. Commands and fixture policy are in [testing](testing.md).

## Current source checks

The release/tooling cleanup passed `pnpm check` locally on Linux with Node 24.13.0, pnpm 10.33.0, Rust 1.98.1, wasm-bindgen 0.2.128, TypeScript 6.0.2, Vite 8.2.2 and Playwright 1.63.0:

| Check | Result |
| --- | --- |
| Native Rust | 29 parser tests passed |
| Generated contract | Byte-for-byte Rust/TypeScript match |
| Pure logic and upstream adapter | 21 tests passed, including wrapped-tab geometry and the actual upstream signature |
| Builds and type checking | Library, example, public declarations, Worker and Node build code passed |
| Production browser | 15 tests passed, including inherited font-name handling |
| Installed package | One Playwright consumer passed after a fresh npm install, strict public API compilation and Vite production build |

The consumer asserts two pages with 15 and 9 lines, continuation text, physical Canvas dimensions, caller-owned ImageBitmap close, and borrowed viewer ownership. Both automatic asset discovery and explicit Worker/WASM URLs work at `/viewer/`; no request failed. It compiles every documented public type and exercises `RtfDocument`, `layoutDocument`, and `pixelSize`. The archive and report are written to ignored `artifacts/` and tied together by SHA-256.

The source import uses upstream commit `04d5597676b7532b463db9eb5951d99334a153fe`. Its adapter probe is 3,671 bytes raw / 1,388 gzip; the full upstream checkout is a development cost, not npm package content. The packed package has no submodule files or upstream declaration dependency. Source maps intentionally preserve source/license provenance. See [reuse evaluation](reuse-evaluation.md) for the public-package and source-import experiments.

Release Please v17.6.0 was exercised in an isolated clone with the actual configuration and a synthetic `fix:` commit. Its dry-run found `v1.0.1` and proposed `v1.0.2`, updating only the root/public package versions, root changelog, and manifest. No Cargo file changed. After [implementation PR #6](https://github.com/rwv/rtf-viewer/pull/6) passed a [clean GitHub checkout and full verification](https://github.com/rwv/rtf-viewer/actions/runs/34196646334), the environment-scoped token successfully created [release PR #7](https://github.com/rwv/rtf-viewer/pull/7). Dependabot also completed its initial submodule update check. The release PR remains the maintainer's publication gate; creating it is not an npm publication.

## Independent rendering evidence

The committed LibreOffice 25.2.3.2 sample is compared to an independently exported PDF/PNG: page count, paper size, line text, indent coordinates and nearby-ink coverage are checked. Known metric/rasterization differences are documented in [compatibility](compatibility.md). Fixed test fonts keep this comparison reproducible.

No supplied synthetic fixture currently has a known content/page failure. One LibreOffice sample is not a representative corpus. Word/TextEdit references, Firefox/WebKit, additional bundlers, broad complex-script behavior and maximum-size performance remain unverified. Unsupported RTF features remain listed in the [support matrix](support-matrix.md).

## v1.0.1: GitHub Actions to npm

[`v1.0.1`](https://github.com/rwv/rtf-viewer/releases/tag/v1.0.1) was published by [Actions run 34192800727](https://github.com/rwv/rtf-viewer/actions/runs/34192800727) through npm OIDC and GitHub Environment `npm`. The registry and GitHub archives were identical: 222,636 bytes, SHA-256 `da5fa55f07e40e252e3929097aed0818ef7017610b18e09752ddf02fecd75fdf`. Registry provenance matched the workflow, tag and commit; a separate registry-installed consumer passed the production build and browser checks.

The [historical verification record](https://github.com/rwv/rtf-viewer/blob/f765968c3e01cffa7aa40214d1cfda6a0194cb60/docs/verification.md) retains earlier commands, measurements and bootstrap details. These historical package sizes are not promises about later builds. GitHub release assets and their associated reports are the authoritative evidence for each published version.
