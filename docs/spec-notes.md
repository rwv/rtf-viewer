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

Lengths are converted at the semantic boundary: 20 twips = 1 point (p. 8). Default paper is 612 × 792 pt, margins are 90 pt left/right and 72 pt top/bottom, and default tab interval is 36 pt (pp. 41–42, 49). Section-specific dimensions and margins are separate state (`pgwsxn`, `pghsxn`, and section margin controls, p. 74); schema version 1 diagnoses these because its single page object cannot represent mixed sections.

## Pictures

`pict` contains a type, dimensions, and either hexadecimal data or `bin` bytes. PNG, JPEG, WMF, and EMF controls are defined on pp. 148–150. `picwgoal`/`pichgoal` are desired twip dimensions; `picw`/`pich` are raster pixels but metafile extents. Scaling defaults to 100 percent (pp. 149–150).

The paired form `{\*\shppict{\pict...}}{\nonshppict{\pict...}}` contains alternatives, so a reader must not emit both (p. 149). PNG/JPEG are rendered after signature and size checks. WMF/EMF bytes are preserved with a diagnostic until a bounded converter is integrated; browsers cannot display them natively.

## Deferred tables and lists

RTF has no table group. Rows run from `trowd` to `row`; `cell` closes a cell, paragraphs use/inherit `intbl`, and row definitions may appear at the start, end, or both (pp. 77–78, 93–96). The initial model consumes controls, retains reading-order cell text with separators, and reports `unsupported-table`; it does not claim table layout.

Word 97+ numbering uses `listtable`, `listoverridetable`, paragraph `ls`, and `ilvl` (pp. 30–35, 87). Until semantic counters exist, the reader intentionally renders `listtext`, the flat marker supplied for old readers, and suppresses the list definition. Old `pntext` has the same fallback role relative to starred `pn` instructions (pp. 84–87). Rendering both semantic numbering and compatibility text would duplicate markers.

## Resource policy

The specification permits rejecting strongly illegal or probably malicious data (p. 12). The implementation caps input bytes, nesting, tokens, decoded text, paragraphs, image count, image bytes, and diagnostics. Binary underrun, group imbalance, and hard resource-limit violations return a typed parse error; unsupported but bounded content produces diagnostics and preserves later body content.
