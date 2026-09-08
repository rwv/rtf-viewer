# RTF 1.9.1 parser rules used by this project

Primary source: Microsoft, _Rich Text Format (RTF) Specification, Version 1.9.1_, 19 March 2008. References are printed PDF page numbers. The longer research record, including suggested future tests, is in the adjacent research workspace and is not required at runtime.

## Token and group rules

- Parse bytes, not a pre-decoded string. RTF may contain eight-bit text and `\binN` may contain any byte value. Raw CR/LF is normally ignored (pp. 7–8).
- A case-sensitive control word is backslash plus ASCII letters, optionally followed immediately by a signed decimal parameter. Its name is at most 32 letters; readers must accept up to ten parameter digits for 32-bit controls. One following space is a consumed delimiter. A non-space delimiter remains the next input token (pp. 7–8).
- Backslash plus a non-letter is a control symbol with no delimiter. This includes escaped braces/backslash, `\'hh`, `\~`, `\-`, `\_`, and `\*` (pp. 9, 143).
- `{` saves complete parser state and `}` restores it. Formatting can change anywhere, and group close is an implicit property restoration (pp. 9–10, 213).
- Unknown ordinary controls are ignored. `\*` followed by an unknown destination makes the entire containing group ignorable, including nested groups. A skipper must still recognize `\binN`; brace counting alone is unsafe (pp. 10, 208–209).
- `\binN` consumes exactly N following bytes after the normal single delimiter. Braces, backslashes, spaces, CR/LF, and NUL inside that payload have no syntax role (pp. 149–151).

## Destinations

Destinations route text; their contents are not body text by default. `fonttbl`, `colortbl`, metadata, headers, notes, object data, and picture bytes must not leak into body runs. Destination changes are valid at group start (pp. 9–11).

`\upr` contains an ANSI alternative and a starred `\ud` Unicode alternative. A Unicode reader selects `ud` once and suppresses the ANSI copy (pp. 15–16). Field instructions are inert; a static reader may show `fldrslt` but must not execute or fetch from `fldinst`.

Skipping is sticky: once an unknown/unsupported destination is being skipped, a nested known destination such as `fldrslt` or `pict` cannot reactivate output. Intentional compatibility containers (`field`, `upr`, and `shppict`) are modeled separately so their selected child can be routed.

## Unicode and code pages

`\ucN` is group-scoped and defaults to 1. `\uN` emits one signed 16-bit UTF-16 code unit and suppresses the next `uc` fallback characters (pp. 14–15). Suppression counts tokens, rather than blindly advancing bytes: a control word/symbol counts as one, and a whole `\binN` plus payload counts as one. The terminating space after `\u` does not count. `{` or `}` ends fallback suppression before the brace. Consecutive surrogate code units form supplementary characters; the specification demonstrates this on p. 115.

The document code page comes from `ansi`/`mac`/`pc`/`pca` and `ansicpg` (pp. 12–14). A font run uses its font-table `cpg` when present, otherwise the code page implied by `fcharset`, otherwise the document page. `cpg` overrides `fcharset` (pp. 17–20). Buffer adjacent encoded bytes so a DBCS character is not decoded one byte at a time. Charset 2/code page 42 is Symbol-font data and needs deliberate font mapping rather than a generic decoder (pp. 15, 19).

The `ansicpg` behavior and possible-value table on pp. 13–14 are the normative basis. For compatibility with existing files, the parser also recognizes UTF-16LE/BE (1200/1201), Mac Cyrillic (10007), KOI8-U (21866), ISO-8859 numeric aliases (28592–28598, 28600, 28603–28606, and 38598), EUC-JP/EUC-KR (51932/51949), and GB18030 (54936). This additional list records compatibility coverage, not an RTF requirement. These mappings use the pinned `encoding_rs` decoders and their Encoding Standard semantics; for example, 949 and 51949 share the EUC-KR decoder, while 28598 and 38598 differ in text direction metadata rather than decoded Unicode scalar values. A codepage without an `encoding_rs` decoder falls back to Windows-1252 and reports `unsupported-codepage` when non-ASCII input requires that fallback. Because UTF-16 is not ASCII-compatible, select the decoder before applying an ASCII-only shortcut.

## Defaults and paragraphs

`plain` resets character formatting; `pard` resets paragraph formatting; `sectd` resets section formatting. These operations are independent. Without `pard` or `sectd`, properties inherit into the next paragraph or section. Optional `defchp` and `defpap` groups define document-specific reset values (pp. 23, 71–72, 77–78, 130–132).

`par` ends a paragraph, `line` inserts an in-paragraph break, `page` forces a page break, and `sect` ends both a section and paragraph (pp. 142–143). Paragraph properties can occur anywhere in the paragraph (pp. 78–80), so the final paragraph model is resolved at flush. A positive `sl` is minimum line spacing, a negative value is exact, and `slmult1` denotes a multiple of single spacing (p. 80).

Lengths are converted at the semantic boundary: 20 twips = 1 point (p. 8). Default paper is 612 × 792 pt, margins are 90 pt left/right and 72 pt top/bottom, and default tab interval is 36 pt (pp. 41–42, 49). Section-specific dimensions and margins are separate state (`pgwsxn`, `pghsxn`, and section margin controls, p. 74); the document model diagnoses these because its single page object cannot represent mixed sections.

## Pictures

`pict` contains a type, dimensions, and either hexadecimal data or `bin` bytes. PNG, JPEG, WMF, and EMF controls are defined on pp. 148–150. `picwgoal`/`pichgoal` are desired twip dimensions; `picw`/`pich` are raster pixels but metafile extents. Scaling defaults to 100 percent (pp. 149–150).

The paired form `{\*\shppict{\pict...}}{\nonshppict{\pict...}}` contains alternatives, so a reader must not emit both (p. 149). PNG/JPEG are rendered after signature and size checks.

Browsers cannot display WMF or EMF natively, and the specification says nothing about their contents beyond naming the controls, so the record layouts come from [MS-WMF] and [MS-EMF]. The bytes are always preserved. In addition, a metafile whose drawing is a bitmap is drawn from that bitmap: `META_STRETCHDIB` (0x0F43), `META_DIBSTRETCHBLT` (0x0B41) and `META_DIBBITBLT` (0x0940) in a WMF, and `EMR_STRETCHDIBITS` (81), `EMR_BITBLT` (76) and `EMR_STRETCHBLT` (77) in an EMF, each addressing a `BITMAPINFOHEADER` DIB. A WMF may also carry an entire EMF split across `META_ESCAPE` MFCOMMENT records with the `WMFC` identifier, which is reassembled and read the same way. Uncompressed DIBs at 1, 4, 8, 16, 24 and 32 bits per pixel are decoded, bottom-up rows and 4-byte row padding included; a compressed DIB and a metafile with no blit at all both keep the placeholder. Playing back vector records remains out of scope, so drawing a bitmap is reported as an approximation: the blit's raster operation and any clipping are not applied.

## Tables

RTF has no table group. Rows run from `trowd` to `row`; `cell` closes a cell, paragraphs use or inherit `intbl`, and row definitions may appear at the start of the row, after the cell text, or both (pp. 77-78, 93-96). Because the definition is not group scoped in practice, the reader keeps the row definition outside the saved group state and applies whichever definition is current when `row` arrives.

`\cellx` gives the right boundary of a cell in twips from the same origin as `\trleft`, which defaults to the left margin. Cell widths therefore come from consecutive boundaries, and the first cell starts at `\trleft`. `\trrh` is zero for an automatic height, positive for a minimum and negative for an exact height. `\trgaph` is half the space between cells and acts as the default horizontal cell inset.

Cell padding uses paired controls: `\clpadl` and friends carry the value, `\clpadfl` and friends the unit selector, where 3 means twips and 0 means "ignore the value" (pp. 96-98). The row-level `\trpaddl`/`\trpaddfl` pair supplies a default for cells that declare none. This reader resolves padding as cell value, then row value, then `\trgaph`. It honours a value whose selector is absent, which is a compatibility decision rather than a normative rule: the specification's default selector is 0, but writers that omit the selector entirely still emit twips. A selector that is present and is not 3 rejects the value and reports `unsupported-table-padding-unit`.

Border sides are selected by `\clbrdrt`, `\clbrdrl`, `\clbrdrb` and `\clbrdrr` for a cell and by `\trbrdrt`, `\trbrdrl`, `\trbrdrb`, `\trbrdrr`, `\trbrdrh` and `\trbrdrv` for a row; the `\brdr*` controls that follow describe the selected side (pp. 98-101). `\brdrw` is a twip width, `\brdrcf` a colour-table index, and `\brdrnone`/`\brdrnil` remove the border. An explicit cell side always wins, including when it is `\brdrnone`; otherwise an outer edge falls back to the matching row border and an inner edge to `\trbrdrh` or `\trbrdrv`. Widths clamp to 0.25-12 pt so that a hairline stays visible and an absurd width cannot cover the page. Every border style is retained in the model but currently drawn as a solid rule.

Vertical cell alignment comes from `\clvertalt`, `\clvertalc` and `\clvertalb` and defaults to the top (p. 96). It positions the cell's content inside the resolved row height, so it only has an effect where a cell is shorter than its row. A row that continues across a page has no single fragment holding the alignment target, so those fragments keep their content at the top and say so.

Cell shading is authored as a triple: `\clcbpat` names the background colour, `\clcfpat` the foreground, and `\clshdng` the percentage of foreground laid over background in hundredths of a percent (pp. 96-98). The model keeps the three as authored rather than one resolved colour, because a blend is not an entry in the document's colour table; layout mixes them, defaulting to automatic white behind and automatic black in front. Without a `\clshdng`, only a declared background fills the cell. Row-level `\trcbpat`, `\trcfpat` and `\trshdng` supply a default for cells that declare none. Background pattern controls such as `\clbghoriz` are drawn as that flat blend and report `approximated-table-cell-pattern`.

A horizontally merged range is written as a `\clmgf` cell followed by `\clmrg` continuations (p. 96). A continuation extends the preceding cell's right boundary and contributes its content, so text a writer placed in a merged-away cell is not lost. The range keeps the first cell's padding, borders, alignment and shading, except its right border, which comes from the definition owning the final boundary, because that is where the stroke is drawn. Writers emit a bare `\cell` for every merged-away cell; that empty paragraph is punctuation, not content, so it does not add a blank line to the range. A `\clmrg` with nothing to its left is malformed: it becomes an ordinary cell and reports `invalid-table-merge`.

Vertical merges (`\clvmgf`, `\clvmrg`), nested tables (`\itap` above 1, `\nestrow`), repeating header rows (`\trhdr`) and keep-together rows (`\trkeep`) are separate features. A vertical merge spans rows, which a row-independent layout cannot express. Each keeps its fallback and reports a specific diagnostic; none of them is implied by ordinary table support.

A row whose definition is unusable never loses text. With no `\cellx` at all, with boundaries that do not increase, with more cells than boundaries, or with no `\row` before the document ends, the cell content is emitted in reading order with a named diagnostic.

## Lists and numbering

Word 97+ numbering uses `listtable`, `listoverridetable`, paragraph `ls`, and `ilvl` (pp. 30-35, 87). A paragraph's `\ls` names a list _override_, which names a `\list` by `\listid`; the level comes from `\ilvl`.

`\leveltext` is a length-prefixed string whose placeholder characters hold the index of the level whose counter to substitute. `\levelnumbers` is not length prefixed: its bytes are the one-based offsets into that template which are placeholders, terminated by the group's literal semicolon. A level with no placeholder, such as a bullet, is literal text. `\levelnfc` selects the format: 0 arabic, 1 and 2 roman, 3 and 4 letters, 22 leading-zero arabic, 23 bullet and 255 none. Any other value renders as arabic and reports `unsupported-list-number-format`, because rendering nothing would lose the marker entirely.

Counters are document-order state, so the parser owns them and emits a resolved marker per paragraph rather than leaving layout to count. A level's counter takes its start value on first use and increments afterwards; advancing a level restarts every deeper level. `\levelstartat` inside a `\lfolevel` override replaces the level's own start.

A level's `\li` and `\fi` are defaults: they apply only where the paragraph declares no indents of its own, because `\ls` and `\ilvl` can arrive before or after the paragraph's own indent controls.

`\listtext` is the flat marker a writer supplies for old readers. It is collected apart from the body and used only where no definition resolves, because rendering both the generated number and the cached text would duplicate the marker. Old `pntext` has the same fallback role relative to starred `pn` instructions (pp. 84-87), which remain unsupported.

## Resource policy

The specification permits rejecting strongly illegal or probably malicious data (p. 12). The implementation caps input bytes, nesting, tokens, decoded text, paragraphs, image count, image bytes, and diagnostics. Binary underrun, group imbalance, and hard resource-limit violations return a typed parse error; unsupported but bounded content produces diagnostics and preserves later body content.
