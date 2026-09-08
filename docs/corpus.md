# Producer compatibility corpus

The corpus is the set of real RTF documents checked into this repository together with the
provenance needed to reproduce them and the differences from their independent references that
are currently known. It exists so that the next fidelity work is chosen from measurements rather
than from whichever difference was noticed last.

`fixtures/corpus.json` is the machine-readable record. `scripts/corpus.ts` validates it, runs in
`pnpm test`, and can be run directly with `pnpm check:corpus`.

## What every entry records

| Field       | Purpose                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `producer`  | Application, version, the `\generator` string in the file itself, operating system and packages |
| `features`  | The RTF areas the document actually exercises                                                   |
| `artifacts` | Source, the RTF document, and the independent references, each with a SHA-256 and its tool      |
| `fonts`     | Font family, distribution package, file path and SHA-256 as installed when generating           |
| `commands`  | The exact commands that regenerate each artifact                                                |
| `deltas`    | Every known difference from the references, classified and measured                             |

The validator fails on a missing file, a stale hash, an unknown delta classification, missing
producer provenance, a document without an independent reference, and on any `.rtf` in
`fixtures/real` that no entry describes. A producer document without provenance is worse than no
document at all, so adding one without a manifest entry breaks the build.

## Classifying a delta

Each delta names the layer that would have to change to close it. The classification is what
makes the corpus actionable: a font-substitution difference is not a layout bug and must not be
"fixed" in layout.

| Classification | Meaning                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------- |
| `parse`        | The document model does not carry what the file says                                           |
| `font`         | Text measurement differs from the producer's, including substituted faces and line-box metrics |
| `layout`       | The model is right but positions, sizes or pagination are computed differently                 |
| `paint`        | Geometry is right but what reaches the canvas is not                                           |

`status` is `open` for a difference we intend to close and `accepted` for one that follows from a
deliberate difference in method, such as comparing a retained line rectangle against a PDF ink box.
`issue` links the tracking issue.

## Current contents

| Document                        | Producer             | Exercises                                                            | Open deltas |
| ------------------------------- | -------------------- | -------------------------------------------------------------------- | ----------- |
| `libreoffice-25.2.3.2-text`     | LibreOffice 25.2.3.2 | Character styles, indents, spacing, CJK font fallback, line breaking | 0           |
| `libreoffice-24.2.7.2-table`    | LibreOffice 24.2.7.2 | Table rows, boundaries, padding, borders, cross-page continuation    | 2           |
| `libreoffice-24.2.7.2-list`     | LibreOffice 24.2.7.2 | List tables, levels, generated numbering, restarts, hanging indents  | 0           |
| `libreoffice-24.2.7.2-metafile` | LibreOffice 24.2.7.2 | WMF picture, embedded EMF comment records, embedded DIB blits        | 0           |

Measured comparisons are in [compatibility](compatibility.md). No Microsoft Word or Apple TextEdit
artifact is included because neither producer is available here; that coverage stays an open
validation task and no handcrafted file is labelled as their output.

## Adding a document

1. Generate the RTF with a real application and keep its source where the format allows one.
   Record the application version, the operating system, the installed packages and the fonts
   that were actually used, including their file hashes.
2. Generate at least one reference that this engine did not produce: a PDF from the producer, a
   text extraction, or a rasterised page. Record the tool and version for each.
3. Compare the engine against the reference and record every difference you can measure, with the
   number and its unit, classified as above. An unmeasured impression is not a delta.
4. Add the entry to `fixtures/corpus.json` and run `pnpm check:corpus`.

Self-rendered output is never a reference. A snapshot of this engine detects regressions in this
engine; it says nothing about fidelity to a producer.

## Observed producer behaviour

These are properties of the producer, not deltas of this engine. They are recorded because they
change what a fixture can prove.

- LibreOffice 24.2.7.2 exports an HTML table's `border` attribute as `\clbrdr*` controls but drops
  a CSS `border` property on the same cells, so the CSS form yields a table with padding and no
  borders at all.
- The same version exports a `width="100%"` HTML table with cell boundaries far outside the page,
  including `\cellx65533`. The table fixture therefore declares explicit column widths.
- LibreOffice writes `\clvertalc` on every exported table cell regardless of the source's
  vertical alignment.
- LibreOffice 24.2.7.2 insets cell content about 0.42 pt further left than the file asks for. Its
  own drawn cell rules sit on the boundaries the engine computes, columns declaring the same
  hairline left border differ from each other by 0.05 pt, and the document declares no `\li` or
  `\fi` anywhere, so the inset is neither the border, nor an indent, nor a boundary difference.
  It is recorded as accepted rather than reverse-engineered: a rule fitted to three points that
  reproduces 0.45 / 0.40 / 0.45 pt would be a coincidence, not a finding.
