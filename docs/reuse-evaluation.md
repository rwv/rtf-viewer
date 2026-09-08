# Upstream reuse evaluation

Status: complete for the initial English-only viewer. The decision is to reuse a
small attributed source subset for PNG/JPEG header inspection and to keep the
RTF parser, layout engine, and WMF/EMF work independent.

## Sources and fixed revisions

The primary reference was
[office-open-xml-viewer](https://github.com/yukiyokotani/office-open-xml-viewer)
at commit `04d5597676b7532b463db9eb5951d99334a153fe`, whose root package version is
`0.86.1`. The published package `@silurus/ooxml@0.86.1` is MIT licensed. The npm
registry reports 70 files and 16,050,360 bytes unpacked.

The WMF/EMF comparison used [rtf.js](https://github.com/tbluemel/rtf.js) at
commit `85fddf55b2f262bfd450769120c18c9ccef1f21c`, matching the published
`rtf.js@3.0.9`. Its most recent commit in that checkout is dated 9 October 2022;
the npm release is dated 16 July 2022. It is MIT licensed and depends on
`codepage@^1.15.0`. The npm registry reports 102 files and 11,451,978 bytes
unpacked.

The research read the real manifests, export maps, generated declarations,
build scripts, README usage, and implementation files. The relevant upstream
paths were:

- `package.json`, `vite.config.ts`, `scripts/bundle-declarations.mjs`;
- `packages/core/src/index.ts`, `image/raster-dimensions.ts`, `image/wmf.ts`,
  `image/emf.ts`, and the font modules;
- `packages/docx/src/index.ts`, `document.ts`, `parser-model.ts`,
  `line-layout.ts`, and `paragraph-measure.ts`;
- rtf.js `index.js`, `webpack/base.config.js`, `src/wmfjs/`, `src/emfjs/`, and
  the declarations shipped only in its npm tarball.

## Installed-package and browser probe

The isolated probe used pnpm 10.28.1, Vite 8.0.8, TypeScript 7.0.2, system
Chromium, and these exact dependencies:

```text
@silurus/ooxml 0.86.1
rtf.js          3.0.9
```

The successful public APIs were:

```ts
import { DocxDocument } from '@silurus/ooxml/docx';
import { WMFJS } from 'rtf.js';

const docx = await DocxDocument.load(docxBytes, { mode: 'main' });
const svg = new WMFJS.Renderer(wmfBytes).render({
  width: '240px', height: '180px', xExt: 240, yExt: 180, mapMode: 8,
});
```

Commands:

```sh
pnpm add @silurus/ooxml@0.86.1 rtf.js@3.0.9
pnpm add -D vite@8.0.8 typescript@7.0.2 playwright-core@1.59.1
pnpm build
node verify-browser.mjs
```

The production build passed. In headless Chromium, `DocxDocument.load` parsed
the public upstream DOCX sample, reported six pages, reported the first page as
595.3 by 841.9 points, and produced 6,422 Markdown characters.
`WMFJS.Renderer` parsed the public upstream WMF sample and returned an SVG with
one top-level child. This establishes that both supported APIs work in a real
production bundle and browser; it is not a fidelity claim.

The dynamic-import measurement separated each package's code in the same build:

| Emitted artifact | Raw bytes | gzip bytes | Consequence |
| --- | ---: | ---: | --- |
| OOXML DOCX JS chunk | 1,480,607 | 418,350 | Full DOCX parse/layout/paint graph |
| DOCX parser WASM | 1,839,187 | 760,553 | Required parser asset |
| DOCX render-worker asset | 1,665,184 | 491,111 | Emitted self-contained worker; not necessarily fetched in main mode |
| DOCX support chunks | 27,306 | 9,197 | Comments and UI runtime in this graph |
| rtf.js top-level import | 2,237,092 | 850,471 | Pulls its RTF, WMF, and EMF bundles |

The installed `@silurus/ooxml` source declarations exposed a critical package
boundary: `packages/core/src/index.ts` exports `sniffRasterDimensions`, WMF/EMF
helpers, font measurement helpers, and Unicode line-break helpers, but the
published package does not expose a `core` subpath. Neither `dist/index.mjs` nor
`dist/types/index.d.ts` exports `sniffRasterDimensions`. A clean Vite build of
this attempted public import failed with `MISSING_EXPORT`:

```ts
import { sniffRasterDimensions } from '@silurus/ooxml';
```

This failure is useful evidence: an npm dependency cannot provide that small
primitive through supported API. Importing an internal hashed chunk would bind
the viewer to an unpublished implementation detail.

The source-only version of the complete upstream dimension sniffer built to
4,234 bytes raw and 1,755 bytes gzip in an isolated Vite page. That complete
module still recognized GIF, BMP, WebP, and TIFF and imported upstream budget
and TIFF contracts. The adopted PNG/JPEG extraction is smaller and matches the
initial RTF image scope.

The source of the reproducible file-input package probe is under
`experiments/reuse/`. Generated `dist`, `node_modules`, and the upstream sample
files are intentionally excluded.

## DOCX model and layout coupling

`DocxDocument` is a useful OOXML engine, but it is the wrong abstraction for an
RTF document. Its public load path starts a dedicated parser Worker, loads
`docx_parser_bg.wasm`, retains a DOCX model, registers embedded and Google-font
substitutes, constructs layout services, paginates by OOXML section rules, and
owns DOCX review, bookmark, field, header/footer, and raw-part state.

The size of the relevant source reflects that boundary: `document.ts` is 1,795
lines, `parser-model.ts` 1,937 lines, `line-layout.ts` 6,460 lines, and
`paragraph-measure.ts` 349 lines at the fixed commit. `line-layout.ts` consumes
DOCX run types and Word-specific numbering, fields, document grids, kinsoku,
floating-object wrap, compatibility projections, font script slots, math, and
retained-layout services. `paragraph-measure.ts` is an adapter over the same
DOCX context rather than a format-neutral text measurer.

Mapping RTF into that graph would require inventing DOCX-only inputs and would
make RTF semantics depend on WordprocessingML defaults. It would also duplicate
the new project's Rust/WASM parser and Worker ownership with a second parser
runtime. The headless name does not make its model format-neutral.

The Unicode pair and kinsoku helpers are cleaner source candidates, but they
carry a generated Unicode 17 line-break table or East Asian policy that the
initial English-only scope does not need. They remain a reference for a later
international line-breaking milestone, when their Unicode-version provenance
and generated tables can be evaluated as a coherent unit.

The font modules similarly contain useful ideas but are coupled to Canvas/DOM
probing, embedded OOXML fonts, Google-font substitution, and registry lifetime.
This project must share one explicit font configuration between measurement and
paint, so lifting an isolated measurement function now would not establish the
required ownership or invalidation contract.

## WMF and EMF evaluation

rtf.js has real public renderer classes:

- `WMFJS.Renderer(ArrayBuffer).render({ width, height, xExt, yExt, mapMode })`;
- `EMFJS.Renderer(ArrayBuffer).render({ width, height, wExt, hExt, xExt, yExt,
  mapMode })`.

Both return `SVGElement`. The implementation creates DOM and SVG nodes directly,
so it cannot run in the parser Worker or produce this project's structured-clone
model. It would add a second retained representation and require SVG-to-Canvas
composition and explicit resource cleanup.

Packaging also works against a narrow adoption. The documented top-level import
loads the package's three prebuilt UMD bundles and produced a 2.24 MB application
chunk. The tarball's individual minified WMF and EMF bundles are 55,709 and
56,032 bytes, but direct bundle paths are not typed package entrypoints. A direct
Node 22 ESM import of `rtf.js` failed because `index.js` uses extensionless
imports such as `./dist/RTFJS.bundle`; Vite repaired these during bundling.

The renderers implement useful GDI subsets, but unsupported records are grouped
with the default case and only logged when logging is enabled. For example, the
EMF path lists text output, bitmap transfer, transforms, alpha blending, and
gradient fill among records that are skipped. That silent partial rendering
conflicts with the project's machine-readable unsupported-content diagnostics.
Malformed input does produce renderer-specific exceptions, but no record-level
diagnostic contract is exposed.

The code is valuable as an MIT reference and as a future corpus/oracle candidate.
It is not adopted as an npm dependency, source copy, or submodule for the initial
PNG/JPEG milestone. WMF/EMF support should be a later explicit capability with
its own record support matrix and diagnostics.

## Route decision

| Route | Result | Decision |
| --- | --- | --- |
| `@silurus/ooxml` npm dependency | Supported `DocxDocument` works, but small core helpers are unpublished and the DOCX graph emits large JS/WASM/Worker assets | Reject for runtime reuse |
| office-open-xml-viewer submodule/fork | Provides all source, but imports another pnpm/Cargo workspace and preserves strong DOCX semantics | Reject |
| Attributed source subset | Pure byte inspection is isolated, testable, and useful before browser decode | Adopt PNG/JPEG subset only |
| `rtf.js` npm dependency | WMF renderer works in Chromium, but the supported import is large, DOM/SVG-bound, and silently skips many records | Defer/reject for initial runtime |
| rtf.js source/submodule | Avoids the top-level bundle but imports a 6,726-line, 248,919-byte WMF/EMF/SVG subsystem that needs new diagnostics and ownership integration | Defer |

## Adopted source and maintenance contract

`packages/rtf-viewer/src/vendor/raster-dimensions.ts` derives from
office-open-xml-viewer's `packages/core/src/image/raster-dimensions.ts` at the
fixed commit above. It retains PNG IHDR parsing and JPEG SOF traversal, including
browser-natural EXIF orientation handling. It removes GIF, BMP, WebP, TIFF,
OOXML budget constants, and all other public helpers.

The local API is only `sniffRasterDimensions(Uint8Array)`. It reports declared
dimensions without decoding pixels; the caller remains responsible for its
image limits. Tests cover normal PNG and JPEG headers, a 60,000 by 60,000
declaration for pre-decode rejection, corrupt PNG structure, a malformed JPEG
segment, truncated input, and an unsupported SVG header.

License and provenance are recorded in `THIRD_PARTY_NOTICES.md` and
`third-party/office-open-xml-viewer/`. An upstream update is deliberate: compare
the fixed source path, review security/correctness changes in PNG and JPEG
parsing, reapply the recorded narrowing, and run the focused tests. There is no
runtime dependency on the research checkout and no uncommitted submodule state.
