# Roadmap

The long-term target is a specification-backed browser viewer with steadily improving fidelity. The first delivery is M0–M2, followed by the independently testable M3 slices below. No milestone is complete merely because its interfaces exist.

| Milestone | Dependencies | Deliverable | Acceptance | Current status |
| --- | --- | --- | --- | --- |
| Reuse gate | Source/spec access | Installed published-package prototype; source/API review; A/B/C comparison | Concrete capability runs; production build observed; decision recorded | In progress |
| M0 | Reuse gate | Standalone Git repo, English plan, pnpm/Cargo builds, CI, redistributable synthetic fixture | Clean install/build, generated contracts checked | Plan written; build pending |
| M1 | M0 | Byte tokenizer, scoped state/destinations, encodings, Unicode, font/color tables, direct styles, bounded errors | Native rule tests and browser WASM assertions | Planned |
| M2a | M1 | Font preparation and retained paragraph geometry | Exact-content/geometry tests; common English/Chinese font render | Planned |
| M2b | M2a | Paper geometry, explicit/automatic pages, canvas/bitmap engine | Known page counts and positions; resolution-independent layout | Planned |
| M2c | M2b | Local-file example, lightweight viewer, cancellation/destruction, packed consumer | Upload, navigation, zoom, export, production Worker/WASM loads | Planned |
| M3a | M2 | Inline PNG/JPEG with dimensions and resource bounds | Decode/placement/disposal and image-bomb tests | Candidate early extension |
| M3b | M2 | Common list/numbering tables, restart/override handling | Isolated numbering fixtures plus producer documents | Planned |
| M3c | M2 | Ordinary tables, borders/padding and cross-page fragments | Cell geometry, no overlaps, continuation tests and producer references | Planned |
| M3d | M3a–c | Real-document compatibility report and install contract | Word/LibreOffice/TextEdit provenance; named failures; npm tarball test | Planned; available producers will be recorded honestly |
| M4 | M3 | Sections, headers/footers, page fields, notes, more complex tables | Story/section invariants and independent page references | Planned |
| M5 | Resource adapter gate | WMF/EMF, floating pictures/shapes/text boxes | Metafile record diagnostics, bounded decode and producer corpus | Planned; evaluate rtf.js first |
| M6 | Stable geometry | Bidi/East Asian refinement, selection/search, scroll virtualization | Script-specific reference corpus and accessibility/performance checks | Planned |
| M7 | Serializable layout | Worker font/layout/paint, progressive layout | Main/Worker parity, cancellation and memory measurements | Planned |
| Later | Evidence-driven | Math and other advanced content | Separate model, renderer and compatibility gates | Planned |

## Initial execution order

1. Finish source/spec research and runnable reuse prototype.
2. Write design first, then build the Rust model/parser and generated contract.
3. Build deterministic point-based paragraph layout and Canvas paint.
4. Prove browser loading, automatic pagination and per-page bitmap export.
5. Add independent LibreOffice-produced reference fixture if the installed producer is usable.
6. Pack and install into an isolated application; test its production output.
7. Reconcile documentation with measured results and record remaining failures.

## M3 boundaries that must be explicit

Merged cells, nested tables, split rows and rows taller than a page are distinct features. Basic tables are incomplete until normal cell content and cross-page behavior work. Lists must model numbering semantics; displaying cached list text is only partial support. Inline PNG/JPEG does not imply WMF/EMF or arbitrary DrawingML shapes. WMF/EMF evaluation must include rtf.js's separate renderers and licenses, including production import behavior and unsupported record visibility.

Editing, source-format saving and round-trip fidelity are outside the initial read-only project. Embedded objects are not executed.
