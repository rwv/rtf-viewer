# rtf-viewer

A standalone, read-only RTF document engine for the browser. Rust reads original bytes; WebAssembly runs parsing in a dedicated Worker; TypeScript measures and paginates in points; Canvas 2D paints retained page geometry.

The primary API serves applications that need complete page counts, page canvases and caller-owned ImageBitmaps. A separate, framework-free viewer and local-file example serve readers.

## Status

Design and source research are in progress. The API below is **proposed, not yet available**. This repository is independent and has no conversion server or automatic third-party font requests. The first delivery targets the complete M0–M2 path, with a narrow inline PNG/JPEG extension. It does not claim full RTF fidelity.

## Intended usage (proposed)

```ts
import { RtfDocument } from 'rtf-viewer';

const document = await RtfDocument.load(file, { signal });
// load resolves only after fonts, resources and all pages are laid out.
await document.renderPage(canvas, 0, { ppi: 144, scale: 1 });
const bitmap = await document.renderPageToBitmap(0, { ppi: 300 });
try {
  consumePage(bitmap);
} finally {
  bitmap.close(); // caller owns returned bitmaps
  document.destroy();
}
```

Page indexes are zero-based. Layout dimensions are points (1/72 inch). Pixel dimensions are `ceil(points × ppi / 72 × scale × pixelRatio)`; defaults are 96 PPI, scale 1, pixelRatio 1. DPR is explicit and never changes wrapping or page count.

## Design and evidence

- [Architecture](docs/architecture.md)
- [Roadmap and acceptance gates](docs/roadmap.md)
- [Support matrix](docs/support-matrix.md)
- [Testing and compatibility evidence](docs/testing.md)
- [Reuse evaluation](docs/reuse-evaluation.md)
- [Engineering rules](AGENTS.md)

Normative reference: Microsoft [Rich Text Format Specification 1.9.1](https://officeprotocoldoc.z19.web.core.windows.net/files/Archive_References/%5BMSFT-RTF%5D.pdf), 19 March 2008, 278 pages. Architecture reference: [office-open-xml-viewer](https://github.com/yukiyokotani/office-open-xml-viewer), inspected at commit `04d5597676b7532b463db9eb5951d99334a153fe`. This project does not repackage DOCX as RTF.
