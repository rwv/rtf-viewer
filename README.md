# rtf-viewer

A browser-only RTF document engine: original bytes → Rust/WASM parser → paginated layout → Canvas or ImageBitmap. Use the engine in your application or add the lightweight viewer. No framework, server conversion, or automatic font downloads are required.

The 1.x release supports Unicode and common Windows/East Asian codepages, direct text formatting, paragraphs, real paper sizes, automatic pagination, and inline PNG/JPEG. Version 1.0.3 also fixes ISO-8859, EUC-JP, GB18030 and UTF-16 compatibility decoding, unrelated font invalidation, and integral raster dimensions. Tables and lists currently have text fallbacks; headers, footers, stylesheet inheritance, and WMF/EMF rendering remain incomplete. Check the [support matrix](https://github.com/rwv/rtf-viewer/blob/main/docs/support-matrix.md) for your document corpus.

## Install

```sh
npm install rtf-viewer
```

The package includes JavaScript, TypeScript declarations, the parser Worker, and WASM. npm consumers need neither Rust nor a source checkout. Tested archives and checksums are also available from [GitHub Releases](https://github.com/rwv/rtf-viewer/releases).

## Render a document

Given a local file input and a canvas:

```ts
import { RtfDocument } from 'rtf-viewer';

const file = document.querySelector<HTMLInputElement>('#file')!.files![0];
const canvas = document.querySelector<HTMLCanvasElement>('#page')!;
const rtf = await RtfDocument.load(file);

try {
  console.log(rtf.pageCount); // complete count after loading
  console.log(rtf.getPageSize(0)); // points; page indexes start at zero
  console.log(rtf.diagnostics); // unsupported or approximated content
  await rtf.renderPage(canvas, 0, { ppi: 144 });
} finally {
  rtf.destroy();
}
```

`load()` accepts `Blob`, `File`, `ArrayBuffer`, or `Uint8Array`. For an image pipeline, use `await rtf.renderPageToBitmap(index, { ppi: 300 })` and close each returned bitmap with `bitmap.close()` when finished. Layout uses points; PPI, scale, and pixel ratio change output pixels without changing line breaks or page count.

An `AbortSignal` cancels loading or rendering. Destroying a document releases its resources and is safe to repeat. Returned bitmaps and supplied canvases belong to the caller. Prepared fonts must be available before layout; relevant font changes require an explicit `relayout()` and refresh of the caller's page cache. Known unrelated font completions are ignored. Renders whose layout is superseded before completion reject and can be retried. See the [API reference](https://github.com/rwv/rtf-viewer/blob/main/docs/api.md) for font mapping, cancellation, concurrent rendering, viewer ownership, and asset URL overrides.

## Public API and versioning

| Import                | Purpose                                                                             |
| --------------------- | ----------------------------------------------------------------------------------- |
| `rtf-viewer`          | `RtfDocument`, `layoutDocument`, `pixelSize`, and public model/layout/options types |
| `rtf-viewer/viewer`   | `RtfViewer` for navigation and zoom around a supplied canvas                        |
| `rtf-viewer/assets/*` | Shipped Worker/WASM assets for explicit deployment                                  |

The [1.x API contract](https://github.com/rwv/rtf-viewer/blob/main/docs/api.md#public-api-and-versioning) includes these exports, public fields, and ownership rules. Incompatible changes require a major version. Format coverage can grow compatibly in minor releases; fixes can change rendered pixels. This is a read-only library, with no editing or round-trip promise.

## Relationship to office-open-xml-viewer

[office-open-xml-viewer](https://github.com/yukiyokotani/office-open-xml-viewer) informed the separation of parsing, layout, painting, and UI. Its image-header implementation is imported from a pinned Git submodule and bundled into this package. Dependabot proposes upstream commit updates, which run through our adapter, parser, layout, browser, and package tests before merge.

This shares the small image implementation without running the upstream OOXML build or adapting RTF into DOCX-specific models. Its current npm package does not expose that helper as a public API. If a suitable public entry becomes available, an npm dependency is the preferred replacement. The [reuse evaluation](https://github.com/rwv/rtf-viewer/blob/main/docs/reuse-evaluation.md) records actual imports, measurements, and the limits of this relationship.

## Development

Use Node from [.node-version](https://github.com/rwv/rtf-viewer/blob/main/.node-version), pnpm 10.33.0, and Rust through rustup. Keep Cargo and wasm-bindgen on `PATH` (on Unix, source `"$HOME/.cargo/env"` after installing Rust).

```sh
git clone --recurse-submodules https://github.com/rwv/rtf-viewer.git
cd rtf-viewer
corepack enable
pnpm install --frozen-lockfile
cargo install wasm-bindgen-cli --version 0.2.128 --locked
pnpm dev
```

For an existing checkout, run `git submodule update --init --recursive`. The submodule is a source dependency only: do not install or build its workspace.

```sh
pnpm exec playwright install --with-deps chromium firefox webkit
pnpm check
```

`pnpm check` covers formatting, lint, Rust format/clippy/tests, generated contracts, deterministic layout, typed browser/Worker/build code, production browser tests, and a fresh npm installation of the packed archive. The [contributor guide](https://github.com/rwv/rtf-viewer/blob/main/CONTRIBUTING.md) describes fast checks, required CI gates, and dependency updates. See [testing](https://github.com/rwv/rtf-viewer/blob/main/docs/testing.md) for individual commands and independent reference outputs.

## Releases and contributing

Use Conventional Commit titles for squash-merged PRs: `fix:` for patches, `feat:` for minor releases, and `!` for breaking changes. Release Please maintains the version/changelog PR. Merging that PR creates the tag and release; Actions verifies the package and publishes it through the `npm` GitHub Environment using OIDC, then verifies the registry download and runs the installed consumer again. Manual dispatch is reserved for recovery. See the [release procedure](https://github.com/rwv/rtf-viewer/blob/main/docs/releasing.md).

Start with the [engineering constraints](https://github.com/rwv/rtf-viewer/blob/main/AGENTS.md), [architecture](https://github.com/rwv/rtf-viewer/blob/main/docs/architecture.md), and [roadmap](https://github.com/rwv/rtf-viewer/blob/main/docs/roadmap.md). Compatibility evidence lives in the [producer report](https://github.com/rwv/rtf-viewer/blob/main/docs/compatibility.md) and [verification record](https://github.com/rwv/rtf-viewer/blob/main/docs/verification.md). Source reuse and licenses are listed in [third-party notices](https://github.com/rwv/rtf-viewer/blob/main/THIRD_PARTY_NOTICES.md).

The normative reference is Microsoft's [Rich Text Format Specification 1.9.1](https://officeprotocoldoc.z19.web.core.windows.net/files/Archive_References/%5BMSFT-RTF%5D.pdf), dated 19 March 2008.
