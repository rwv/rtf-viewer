# Upstream reuse evaluation

Status: experiment in progress. No runtime reuse decision is final until the installed-package prototype completes.

## Inspected source

Reference repository: [office-open-xml-viewer](https://github.com/yukiyokotani/office-open-xml-viewer), commit `04d5597676b7532b463db9eb5951d99334a153fe` (source package version 0.86.1). Read `package.json`, `docs/api-architecture-0.76.md`, `docs/docx-layout-context-fragments-design.md`, `packages/docx/src/document.ts`, `line-layout.ts`, `paragraph-measure.ts`, and core image/font modules. The research checkout is outside this repository and is not a build dependency.

The public root exports format entrypoints and optional renderers; source availability does not establish a supported `core` import. DOCX line layout imports numbering, fields, floating-wrap policy, script slots, document grid and Word compatibility projections. Accepting an RTF paragraph by inventing these inputs would be a semantic and maintenance liability. A complete-source fork is therefore a candidate only if the concrete prototype establishes a benefit that outweighs that coupling.

## Routes to compare

| Route | Candidate | Main question | Preliminary cost |
| --- | --- | --- | --- |
| A: npm public API | Format document API / optional image renderer | Is a format-neutral primitive actually exported? | Runtime graph and asset overhead must be measured |
| B: fixed submodule or fork | DOCX layout and supporting core | Can RTF enter without fake DOCX semantics? | Own pnpm/Cargo workspaces, patches and upstream coordination |
| C: attributed source subset | Raster dimension guard or text boundary utility | Is behavior isolated, valuable and testable? | Small provenance/update burden; no upstream build chain |
| A/B/C: rtf.js | WMFJS / EMFJS renderers | Public production imports, limits, record diagnostics and license | SVG/DOM dependency may constrain Worker reuse |

The completed report will include published versions, actual import entries, commands, production-browser results, JS/WASM/Worker sizes, licenses and final decisions. No submodule or source extraction has been added yet.
