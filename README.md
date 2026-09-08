# rtf-viewer

A standalone, read-only RTF document engine for modern browsers. Rust parses original bytes in a WebAssembly Worker. TypeScript prepares local fonts and images, measures text and paginates in points. Canvas 2D paints reusable page geometry.

The framework-free engine serves applications that need complete page counts, page canvases and caller-owned ImageBitmaps. A separate lightweight viewer and example let readers open local RTF files, turn pages, zoom and export PNGs.

## Current release

`0.1.0` is a working local package, **not published to the npm registry**. The initial M0–M2 rendering path and inline PNG/JPEG extension are implemented. Tests cover byte parsing, generated contracts, geometry, real browser output, cancellation and installation into a separate production-built consumer. See [verification](docs/verification.md) for the measured results.

Supported subsets include Unicode and common Windows/East Asian codepages, scoped direct text styles, font/color tables, paragraph alignment/indents/spacing, explicit and automatic pages, and inline PNG/JPEG pictures. Unsupported content is available through diagnostics. Named styles, true list numbering, table geometry, headers/footers, section-specific geometry and WMF/EMF drawing need further work; this release does not claim full RTF fidelity. Table text fallback is not table support.

## Run the example

Prerequisites for developing this repository: Node.js 22.12+ (Node 24 tested), pnpm 10.33.0, and Rust via rustup. The pinned Rust toolchain and WASM target are in `rust-toolchain.toml`.

```sh
corepack enable
pnpm install --frozen-lockfile
cargo install wasm-bindgen-cli --version 0.2.128 --locked
pnpm dev
```

Open the local Vite address printed by the command. The example opens an original CC0 showcase and accepts local `.rtf` files. No conversion service is used. The example serves its licensed test fonts locally; the core library bundles or downloads no fonts.

```sh
pnpm build                 # library, WASM, Worker and production example
pnpm exec playwright install chromium
pnpm check                 # native, contract, geometry, build, browser, packed-consumer gates
```

A development build needs Rust; a package consumer needs only the prebuilt JS, WASM and Worker shipped in the tarball.

## Install the local package

```sh
pnpm build
pnpm --dir packages/rtf-viewer pack --pack-destination ../../artifacts
# Run in your own application, using the absolute path to this tarball:
pnpm add /path/to/rtf-viewer/artifacts/rtf-viewer-0.1.0.tgz
```

`pnpm test:package` automates packing, installing into a fresh temporary application, checking declarations, building with Vite and exercising the production browser API. No source checkout or submodule is needed by the consumer. The package name is provisional until registry ownership is established.

## Document engine

These APIs are implemented. Input is a `Blob` (including `File`), `ArrayBuffer`, or `Uint8Array`. Byte views are copied, never detached. Fetch a URL yourself if your application needs network input.

```ts
import { RtfDocument } from 'rtf-viewer';

const input = document.querySelector<HTMLInputElement>('#file')!.files![0];
const canvas = document.querySelector<HTMLCanvasElement>('#page')!;
const controller = new AbortController();
const rtf = await RtfDocument.load(input, { signal: controller.signal });

try {
  console.log(rtf.pageCount);        // complete count after fonts/resources/layout
  console.log(rtf.getPageSize(0));   // points; page indexes start at 0
  console.log(rtf.diagnostics);      // bounded { code, message, offset } notices
  await rtf.renderPage(canvas, 0, { ppi: 144 });
  const bitmap = await rtf.renderPageToBitmap(0, { ppi: 300 });
  try {
    // Draw or transfer this page to your own downstream image pipeline.
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  } finally {
    bitmap.close();                 // the caller owns returned bitmaps
  }
} finally {
  rtf.destroy();
}
```

`getPageLayout(index)` returns deeply frozen, structured-cloneable page geometry. `model` exposes the frozen generated semantic model. Neither contains DOM nodes, Canvas contexts or WASM pointers. `layoutDocument(model, services)` is also exported for custom measurement and geometry testing; it returns plain geometry and does not prepare browser resources.

For all pages, call `renderPageToBitmap(index)` for indexes `0 .. pageCount - 1`, consume/close each bitmap, then destroy the document. This bounds image memory independently of the total page count.

## Resolution and lifecycle

Backing pixels are `ceil(points × ppi / 72 × scale × pixelRatio)` on each axis. Defaults: `ppi: 96`, `scale: 1`, `pixelRatio: 1`. DPR is explicit in the engine; the viewer uses the display DPR. Changing these values never changes line breaks or page count. Canvas CSS size belongs to the caller/viewer.

- Load resolves only after all pages are known. Abort rejects with `AbortError`, terminates the dedicated parsing Worker and releases partial resources. Use the load signal to cancel before a document exists. A default 30-second parser timeout is configurable with `parseTimeoutMs` (1–120,000 ms).
- Different canvas targets may render concurrently. Concurrent renders on the same target reject. Cancellation or failure can leave a partially painted caller canvas; retry to replace it. Bitmap requests use independent temporary canvases.
- `destroy()` is idempotent and cancels pending work. Retained metadata stays readable; resource operations reject afterward. Caller canvases, caller font faces and already returned bitmaps are never destroyed by the engine.
- Fonts must be ready before layout. Supply `fonts: { 'RTF family': 'Prepared CSS family' }` and optional `fallbackFont` for reproducibility. These are family names, not URLs. The engine waits for those registered fonts but does not register them itself. Browser font events mark `needsRelayout`; call `await rtf.relayout()` before rendering again. A change during layout rejects that attempt instead of publishing mixed metrics. System-font changes that emit no event require explicit relayout.

## Lightweight viewer

```ts
import { RtfViewer } from 'rtf-viewer/viewer';

const viewer = new RtfViewer(canvas);
await viewer.load(file);            // viewer owns this document
await viewer.goToPage(1);           // zero-based; document must have page 2
await viewer.setScale(1.25);
viewer.destroy();                  // aborts load/render and destroys its document

const borrowed = RtfViewer.fromDocument(canvas, existingDocument);
await borrowed.goToPage(0);
borrowed.destroy();                // existingDocument remains caller-owned
```

A borrowed viewer rejects `load()`. An owning viewer cancels/replaces previous loads and destroys the previous document. Repeated viewer destruction is safe. Continuous scrolling, search and selection remain on the roadmap.

## Hosting and limits

Vite 8 production builds and native browser modules are verified. Worker and WASM URLs are resolved relative to the library with `new URL(..., import.meta.url)`. `workerUrl` and `wasmUrl` can point to copies of the shipped assets when the host bundler cannot discover them. They are trusted deployment overrides, not a custom parser protocol. Serve WASM as `application/wasm` and JavaScript as modules; CSP must allow the application's Worker and WASM compilation. No automatic third-party requests are made.

The initial limits include 16 MiB input, 256 group depth, 2 million lexical tokens/text units, 100,000 blocks, 256 images, 8 MiB per embedded image, 32 million decoded image pixels, 2,000 pages and 32 million pixels per output canvas. Further physical/text bounds are documented in [architecture](docs/architecture.md). A diagnostic is a compatibility notice, not a claim that the rest of an arbitrary document is fully reproduced.

## Design and evidence

- [Architecture and public contracts](docs/architecture.md)
- [Roadmap and acceptance gates](docs/roadmap.md)
- [Feature support matrix](docs/support-matrix.md)
- [Testing strategy](docs/testing.md)
- [Producer compatibility report](docs/compatibility.md)
- [Upstream reuse evaluation](docs/reuse-evaluation.md)
- [Engineering constraints](AGENTS.md)

Normative reference: Microsoft [Rich Text Format Specification 1.9.1](https://officeprotocoldoc.z19.web.core.windows.net/files/Archive_References/%5BMSFT-RTF%5D.pdf), 19 March 2008, 278 pages. Architecture reference: [office-open-xml-viewer](https://github.com/yukiyokotani/office-open-xml-viewer), inspected at commit `04d5597676b7532b463db9eb5951d99334a153fe`. Only a small attributed image-header module is reused; see [third-party notices](THIRD_PARTY_NOTICES.md).
