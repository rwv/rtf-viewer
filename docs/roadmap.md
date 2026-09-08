# Roadmap

The long-term target is a specification-backed browser viewer with steadily improving fidelity. Version 1.0 establishes the M0–M2 API and rendering baseline, followed by the independently testable M3 slices below. No milestone is complete merely because its interfaces exist.

| Milestone | Dependencies | Deliverable | Acceptance | Current status |
| --- | --- | --- | --- | --- |
| Reuse gate | Source/spec access | Installed published-package prototype; source/API review; A/B/C comparison | Concrete capability runs; production build observed; decision recorded | Complete: real public API production/browser prototype |
| M0 | Reuse gate | Standalone Git repo, English plan, pnpm/Cargo builds, CI, redistributable synthetic fixture | Clean install/build, generated contracts checked | Implemented; clean-install gates in CI |
| M1 | M0 | Byte tokenizer, scoped state/destinations, encodings, Unicode, font/color tables, direct styles, bounded errors | Native rule tests and browser WASM assertions | Implemented subset; broader encodings/style semantics remain partial |
| M2a | M1 | Font preparation and retained paragraph geometry | Exact-content/geometry tests; common English/Chinese font render | Verified |
| M2b | M2a | Paper geometry, explicit/automatic pages, canvas/bitmap engine | Known page counts and positions; resolution-independent layout | Verified |
| M2c | M2b | Local-file example, lightweight viewer, cancellation/destruction, packed consumer | Upload, navigation, zoom, export, production Worker/WASM loads | Verified |
| M3a | M2 | Inline PNG/JPEG with dimensions and resource bounds | Decode/placement/disposal and image-bomb tests | Inline subset delivered early; cropping/shape scope remains |
| M3b | M2 | Common list/numbering tables, restart/override handling | Isolated numbering fixtures plus producer documents | Planned |
| M3c | M2 | Ordinary tables, borders/padding and cross-page fragments | Cell geometry, no overlaps, continuation tests and producer references | Planned |
| M3d | M3a–c | Real-document compatibility report and install contract | Word/LibreOffice/TextEdit provenance; named failures; npm tarball test | One LibreOffice report and packed consumer delivered; Word/TextEdit and broad corpus open |
| M4 | M3 | Sections, headers/footers, page fields, notes, more complex tables | Story/section invariants and independent page references | Planned |
| M5 | Resource adapter gate | WMF/EMF, floating pictures/shapes/text boxes | Metafile record diagnostics, bounded decode and producer corpus | Planned; evaluate rtf.js first |
| M6 | Stable geometry | Bidi/East Asian refinement, selection/search, scroll virtualization | Script-specific reference corpus and accessibility/performance checks | Planned |
| M7 | Serializable layout | Worker font/layout/paint, progressive layout | Main/Worker parity, cancellation and memory measurements | Planned |
| Later | Evidence-driven | Math and other advanced content | Separate model, renderer and compatibility gates | Planned |

## Maintenance foundation

The repository uses Release Please for release preparation, environment-scoped GitHub credentials for the release bot, and npm OIDC for publication. A pinned upstream source import replaces the initial image-helper copy; Dependabot proposes submodule and dependency updates for review. Build and browser/package checks run before merging those updates. The [release procedure](releasing.md) and [reuse evaluation](reuse-evaluation.md) describe the boundaries.

The issue #5 maintenance slice expands compatibility codepages, filters irrelevant font completions while preserving explicit relayout, and corrects integral raster sizes at 150 PPI. The production browser gate now runs in Chromium, Firefox and WebKit. This closes specific M1/M2 compatibility gaps without extending the table, list or complex-script fidelity claims. See [verification](verification.md) for the source/package distinction and measured results.

## M3 boundaries that must be explicit

Merged cells, nested tables, split rows and rows taller than a page are distinct features. Basic tables are incomplete until normal cell content and cross-page behavior work. Lists must model numbering semantics; displaying cached list text is only partial support. Inline PNG/JPEG does not imply WMF/EMF or arbitrary DrawingML shapes. WMF/EMF evaluation must include rtf.js's separate renderers and licenses, including production import behavior and unsupported record visibility.

Editing, source-format saving and round-trip fidelity are outside the read-only project. Embedded objects are not executed.

## Next concrete work

1. M3b: parse actual list tables/overrides and resolve numbered markers; retain cached list text as compatibility evidence, not the primary numbering engine.
2. M3c: introduce real row/cell blocks, then fixed-width ordinary tables and measured cross-page fragments. Separate merge/oversize/nesting fixtures before extending the claim.
3. Grow the producer corpus, prioritizing permission-cleared Word/TextEdit files and table/list/image cases. Keep current LibreOffice deltas recorded.
4. Implement a bounded WMF/EMF adapter after auditing rtf.js's separate renderers and upstream GDI players for record diagnostics. Public imports and bundle costs are already measured; raster placeholders must remain visible until a decoder is validated.
5. Expand the installed-package gate to additional bundlers and platforms; retain the Chromium/Firefox/WebKit production checks as the browser baseline.

Rendering lifecycle maintenance: Canvas and bitmap completion checks reject superseded layout revisions, with deterministic browser regression coverage.
