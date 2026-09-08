# API reference

The public browser API is supported throughout 1.x. All examples below use implemented APIs.

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
  console.log(rtf.pageCount); // complete count after layout
  console.log(rtf.getPageSize(0)); // points; indexes are zero-based
  console.log(rtf.diagnostics); // bounded compatibility notices
  await rtf.renderPage(canvas, 0, { ppi: 144 });

  const bitmap = await rtf.renderPageToBitmap(0, { ppi: 300 });
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  } finally {
    bitmap.close(); // returned bitmaps belong to the caller
  }
} finally {
  rtf.destroy(); // safe to call more than once
}
```

`RtfDocument.load()` resolves only after fonts, images, and all page geometry are ready. Abort rejects with `AbortError`, terminates the dedicated parsing Worker, and releases partial resources. The default parser timeout is 30 seconds; `parseTimeoutMs` accepts 1–120,000 ms.

`getPageLayout(index)` returns deeply frozen, structured-cloneable geometry. A page carries `lines` and `decorations`; a decoration is a `RuleFragment`, a filled rectangle in points painted before the lines, currently used for table borders. `model` exposes the frozen semantic model, including bounded embedded-image bytes. Neither value contains DOM nodes, Canvas contexts, decoded image objects, WASM pointers, or other live engine state.

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

Measurement and paint use the same font configuration. A browser font-completion event sets `rtf.needsRelayout` when it contains a font family used by the document's text, paragraph marks, or configured fallback. Empty events and completions for known unrelated families are ignored; a completion for a used family invalidates conservatively even if only some weights or characters may be affected. System-font changes, already-loaded faces added to `document.fonts`, and other changes that do not emit a completion event still require an explicit relayout. WebKit may omit `loadingdone` for a script-initiated font load, so a host that adds or loads a font itself must call `relayout()` and refresh its caches after that operation rather than relying only on the event.

The host owns page-count snapshots and rendered-page caches, so relayout remains explicit. Cache rendered pages under `rtf.layoutRevision`; never reuse entries from an older revision. To react to browser font loading, subscribe after loading the RTF document, then check `needsRelayout` after the engine's listener has processed the event. The following pattern serializes refreshes, blocks stale cached output immediately, closes cached bitmaps, and reports relayout failures. `setCachedPagesUsable`, `updatePageCount`, and `reportError` are host functions:

```ts
let fontRefresh = Promise.resolve();
const fontCompletion = () => {
  if (rtf.needsRelayout) setCachedPagesUsable(false);
  fontRefresh = fontRefresh
    .then(async () => {
      if (rtf.destroyed || !rtf.needsRelayout) return;
      await rtf.relayout();
      for (const bitmap of renderedPages.values()) bitmap.close();
      renderedPages.clear();
      updatePageCount(rtf.pageCount);
      setCachedPagesUsable(true);
    })
    .catch((error) => reportError(error));
};

document.fonts.addEventListener('loadingdone', fontCompletion);
// Later, before destroying the surrounding view:
document.fonts.removeEventListener('loadingdone', fontCompletion);
```

Backing pixels are `ceil(points × ppi / 72 × scale × pixelRatio)` on each axis, except values within four relative machine epsilons of a positive integer are treated as that integer to avoid floating-point overshoot. Genuine fractional extents still round upward: a 6 × 8 inch page at 150 PPI is exactly 900 × 1200 pixels. Page dimensions and output transform values must be positive and finite. The defaults are `ppi: 96`, `scale: 1`, and `pixelRatio: 1`. These paint settings do not change line breaks or page count. Canvas CSS size belongs to the caller.

Different canvas targets may render concurrently. Concurrent renders on the same target reject. Cancellation or failure can leave a caller canvas partially painted; a subsequent render replaces it. `destroy()` cancels pending work and frees engine-owned resources while leaving caller canvases, caller font faces, and previously returned bitmaps alone.

## Lightweight viewer

The optional viewer owns its document by default and supplies page navigation and zoom around a caller-owned canvas:

```ts
import { RtfViewer } from 'rtf-viewer/viewer';

const viewer = new RtfViewer(canvas);
await viewer.load(file);
await viewer.goToPage(1); // zero-based; the document must have page 2
await viewer.setScale(1.25);
viewer.destroy();

const borrowed = RtfViewer.fromDocument(canvas, rtf);
await borrowed.goToPage(0);
borrowed.destroy(); // the borrowed document remains caller-owned
```

A borrowed viewer rejects `load()`. An owning viewer cancels and replaces earlier loads. Continuous scrolling, search, selection, and editing are outside this v1 viewer.

## Public API and versioning

The package has two JavaScript API entry points and one deployment-asset subpath:

- `rtf-viewer`: runtime exports `RtfDocument`, `layoutDocument`, and `pixelSize`; type exports `CanvasTarget`, `RtfInput`, `LoadOptions`, `RenderOptions`, `PageSize`, `TextFragment`, `ImageFragment`, `RuleFragment`, `Fragment`, `LineLayout`, `PageLayout`, `DocumentLayout`, `TextMetricsPt`, `LayoutServices`, `LayoutOptions`, `Diagnostic`, `DocumentModel`, and `TextStyle`.
- `rtf-viewer/viewer`: `RtfViewer`.
- `rtf-viewer/assets/*`: access to the shipped files under `dist`, intended for hosts that must copy or address the parser Worker, wasm-bindgen module, or WASM binary explicitly.

These exports are supported throughout 1.x. Removing or renaming an export, changing an existing field or discriminated union, or changing the documented ownership and lifecycle rules requires a new major version.

RTF coverage will continue to grow in minor releases. A minor release may add backward-compatible optional fields and diagnostic codes. Adding a required field or an incompatible member to a public discriminated union requires a new major version and, for the semantic model, a new schema version. Consumers should still retain an unknown/default path for data loaded from a newer package and check `model.schemaVersion` when persisting or validating model snapshots. Patch releases may correct parsing, layout, or paint behavior within the documented contract, so pixel output should be treated as renderer output rather than a frozen serialization format.

`layoutDocument(model, services)` is public for custom measurement and geometry work. It returns plain structured-cloneable values and does not prepare browser resources.

## Hosting and limits

Worker and WASM URLs are resolved relative to the installed module with `new URL(..., import.meta.url)`. If a bundler cannot discover them, `workerUrl` and `wasmUrl` may point to deployed copies of the shipped assets. Serve JavaScript as modules and WASM as `application/wasm`; CSP must allow the application's Worker and WASM compilation. The library makes no automatic third-party request.

Default resource ceilings include 16 MiB input, 256 nested groups, 2 million lexical tokens/text units, 100,000 blocks including page breaks, 256 images, 8 MiB per embedded image, 32 million decoded image pixels, 2,000 pages, and 32 million pixels per output canvas. The full bounds and ownership rules are in [architecture](https://github.com/rwv/rtf-viewer/blob/main/docs/architecture.md). A diagnostic reports unsupported or approximated content; it is not evidence that every other part of an arbitrary document reproduced faithfully.

A render that overlaps a successful `relayout()` rejects if its layout revision has changed before completion. Discard a rejected Canvas render and retry; discarded ImageBitmaps are closed by the engine. Concurrent renders to separate canvases remain supported when the layout stays unchanged.
