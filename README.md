# rtf-viewer

`rtf-viewer` is a standalone, read-only RTF document engine for modern browsers. It parses original bytes in a WebAssembly Worker, lays out every page in points, and paints retained page geometry to Canvas 2D or caller-owned `ImageBitmap` objects. It has no framework dependency and does not use a conversion service.

Version 1.0.0 is the supported public API baseline. It deliberately implements a bounded subset of RTF rather than claiming complete format fidelity. Unicode and common Windows/East Asian codepages, direct text formatting, paragraph layout, pagination, and inline PNG/JPEG pictures are supported within the documented limits. Tables and lists have text fallbacks only; stylesheet inheritance, headers/footers, section-specific page geometry, and WMF/EMF drawing remain incomplete. See the [support matrix](https://github.com/rwv/rtf-viewer/blob/main/docs/support-matrix.md) before choosing it for a document corpus.

## Install

The v1.0.0 GitHub Release archive is the initial distribution path:

```sh
npm install https://github.com/rwv/rtf-viewer/releases/download/v1.0.0/rtf-viewer-1.0.0.tgz
```

The release also includes `SHA256SUMS`; verify the archive against it when your installation process requires an integrity check.

The npm name is `rtf-viewer`; its first registry publication is pending npm account authentication. After version 1.0.0 is visible on the npm registry, the usual command is:

```sh
npm install rtf-viewer
```

Package consumers need only the shipped ESM JavaScript, declarations, parser Worker, and WASM assets. They do not need Rust, wasm-bindgen, or this source checkout.

## Render a document

Input may be a `Blob` (including `File`), `ArrayBuffer`, or `Uint8Array`. Byte views are copied and never detached. Fetch URL input in your application so its network and credential policy stays under your control.

```ts
import { RtfDocument } from 'rtf-viewer';

const input = window.document.querySelector<HTMLInputElement>('#file')!.files![0];
const canvas = window.document.querySelector<HTMLCanvasElement>('#page')!;
const controller = new AbortController();
const rtf = await RtfDocument.load(input, {
  signal: controller.signal,
  fallbackFont: 'serif',
});

try {
  console.log(rtf.pageCount);       // complete count after layout
  console.log(rtf.getPageSize(0));  // points; indexes are zero-based
  console.log(rtf.diagnostics);     // bounded compatibility notices
  await rtf.renderPage(canvas, 0, { ppi: 144 });

  const bitmap = await rtf.renderPageToBitmap(0, { ppi: 300 });
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  } finally {
    bitmap.close();                       // returned bitmaps belong to the caller
  }
} finally {
  rtf.destroy();                           // safe to call more than once
}
```

`RtfDocument.load()` resolves only after fonts, images, and all page geometry are ready. Abort rejects with `AbortError`, terminates the dedicated parsing Worker, and releases partial resources. The default parser timeout is 30 seconds; `parseTimeoutMs` accepts 1–120,000 ms.

`getPageLayout(index)` returns deeply frozen, structured-cloneable geometry. `model` exposes the frozen semantic model, including bounded embedded-image bytes. Neither value contains DOM nodes, Canvas contexts, decoded image objects, WASM pointers, or other live engine state.

## Fonts, resolution, and lifecycle

The engine never downloads fonts. Register the fonts your application permits, then map RTF family names to prepared CSS family names:

```ts
const rtf = await RtfDocument.load(bytes, {
  fonts: {
    Arial: 'My Prepared Arial',
    'Times New Roman': 'My Prepared Times',
  },
  fallbackFont: 'My Prepared Serif',
});
```

Measurement and paint use the same font configuration. Browser font events set `rtf.needsRelayout`; call `await rtf.relayout()` before rendering again. System-font changes that do not emit an event require an explicit relayout too.

Backing pixels are `ceil(points × ppi / 72 × scale × pixelRatio)` on each axis. The defaults are `ppi: 96`, `scale: 1`, and `pixelRatio: 1`. These paint settings do not change line breaks or page count. Canvas CSS size belongs to the caller.

Different canvas targets may render concurrently. Concurrent renders on the same target reject. Cancellation or failure can leave a caller canvas partially painted; a subsequent render replaces it. `destroy()` cancels pending work and frees engine-owned resources while leaving caller canvases, caller font faces, and previously returned bitmaps alone.

## Lightweight viewer

The optional viewer owns its document by default and supplies page navigation and zoom around a caller-owned canvas:

```ts
import { RtfViewer } from 'rtf-viewer/viewer';

const viewer = new RtfViewer(canvas);
await viewer.load(file);
await viewer.goToPage(1);   // zero-based; the document must have page 2
await viewer.setScale(1.25);
viewer.destroy();

const borrowed = RtfViewer.fromDocument(canvas, rtf);
await borrowed.goToPage(0);
borrowed.destroy();         // the borrowed document remains caller-owned
```

A borrowed viewer rejects `load()`. An owning viewer cancels and replaces earlier loads. Continuous scrolling, search, selection, and editing are outside this v1 viewer.

## Public API and versioning

The package has two JavaScript API entry points and one deployment-asset subpath:

- `rtf-viewer`: runtime exports `RtfDocument`, `layoutDocument`, and `pixelSize`; type exports `CanvasTarget`, `RtfInput`, `LoadOptions`, `RenderOptions`, `PageSize`, `TextFragment`, `ImageFragment`, `Fragment`, `LineLayout`, `PageLayout`, `DocumentLayout`, `TextMetricsPt`, `LayoutServices`, `LayoutOptions`, `Diagnostic`, `DocumentModel`, and `TextStyle`.
- `rtf-viewer/viewer`: `RtfViewer`.
- `rtf-viewer/assets/*`: access to the shipped files under `dist`, intended for hosts that must copy or address the parser Worker, wasm-bindgen module, or WASM binary explicitly.

These exports are supported throughout 1.x. Removing or renaming an export, changing an existing field or discriminated union, or changing the documented ownership and lifecycle rules requires a new major version.

RTF coverage will continue to grow in minor releases. A minor release may add backward-compatible optional fields and diagnostic codes. Adding a required field or an incompatible member to a public discriminated union requires a new major version and, for the semantic model, a new schema version. Consumers should still retain an unknown/default path for data loaded from a newer package and check `model.schemaVersion` when persisting or validating model snapshots. Patch releases may correct parsing, layout, or paint behavior within the documented contract, so pixel output should be treated as renderer output rather than a frozen serialization format.

`layoutDocument(model, services)` is public for custom measurement and geometry work. It returns plain structured-cloneable values and does not prepare browser resources.

## Hosting and limits

Worker and WASM URLs are resolved relative to the installed module with `new URL(..., import.meta.url)`. If a bundler cannot discover them, `workerUrl` and `wasmUrl` may point to deployed copies of the shipped assets. Serve JavaScript as modules and WASM as `application/wasm`; CSP must allow the application's Worker and WASM compilation. The library makes no automatic third-party request.

Default resource ceilings include 16 MiB input, 256 nested groups, 2 million lexical tokens/text units, 100,000 blocks including page breaks, 256 images, 8 MiB per embedded image, 32 million decoded image pixels, 2,000 pages, and 32 million pixels per output canvas. The full bounds and ownership rules are in [architecture](https://github.com/rwv/rtf-viewer/blob/main/docs/architecture.md). A diagnostic reports unsupported or approximated content; it is not evidence that every other part of an arbitrary document reproduced faithfully.

## Development

Development requires Node.js 22.12 or newer (Node 24 is tested), pnpm 10.33.0, Rust through rustup, and wasm-bindgen CLI 0.2.128. The Rust toolchain and WASM target are pinned in `rust-toolchain.toml`.

```sh
corepack enable
pnpm install --frozen-lockfile
cargo install wasm-bindgen-cli --version 0.2.128 --locked
pnpm dev

pnpm exec playwright install chromium
pnpm check
```

`pnpm check` runs the native parser tests, generated-contract drift check, unit and layout tests, release guards, production builds, type checking, Chromium integration, and npm installation of the packed archive into a separate consumer. The consumer verifies a non-root deployment path and both automatic and explicit Worker/WASM URLs. Release maintainers should follow the [release procedure](https://github.com/rwv/rtf-viewer/blob/main/docs/releasing.md).

Further documentation:

- [Architecture and public contracts](https://github.com/rwv/rtf-viewer/blob/main/docs/architecture.md)
- [Feature support matrix](https://github.com/rwv/rtf-viewer/blob/main/docs/support-matrix.md)
- [Verification record](https://github.com/rwv/rtf-viewer/blob/main/docs/verification.md)
- [Testing strategy](https://github.com/rwv/rtf-viewer/blob/main/docs/testing.md)
- [Producer compatibility report](https://github.com/rwv/rtf-viewer/blob/main/docs/compatibility.md)
- [Roadmap](https://github.com/rwv/rtf-viewer/blob/main/docs/roadmap.md)
- [Upstream reuse evaluation](https://github.com/rwv/rtf-viewer/blob/main/docs/reuse-evaluation.md)
- [Engineering constraints](https://github.com/rwv/rtf-viewer/blob/main/AGENTS.md)
- [Third-party notices](https://github.com/rwv/rtf-viewer/blob/main/THIRD_PARTY_NOTICES.md)

The normative format reference is Microsoft's [Rich Text Format Specification 1.9.1](https://officeprotocoldoc.z19.web.core.windows.net/files/Archive_References/%5BMSFT-RTF%5D.pdf), dated 19 March 2008.
