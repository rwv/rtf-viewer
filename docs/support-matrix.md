# RTF support matrix

This matrix describes the 1.x rendering baseline. The major version establishes the public API contract; it does not imply complete RTF coverage.

**Verified** means the named evidence checks the stated subset, not the entire specification feature. **Partial** identifies known omissions. **Planned** has no current implementation claim. Native tests are in `crates/rtf-parser/tests/parser.rs`; geometry tests in `packages/rtf-viewer/src/layout.test.ts`; production browser tests in `tests/engine.spec.ts` and `tests/browser.spec.ts`.

| Feature | RTF 1.9.1 reference | Status | Evidence and boundary |
| --- | --- | --- | --- |
| Groups, control parameters, delimiters, escaped text | pp. 7–10 | Verified subset | Scoped state restoration; bounded names/parameters; raw byte scanning |
| Binary payload boundaries | pp. 7–8, 14, 150 | Verified | Braces/slashes remain opaque; truncated and negative lengths reject |
| Ignorable unknown destinations | pp. 9–10 | Verified | Whole subtree skipped, including nested known destinations; loss diagnosed |
| Unicode u/uc, signed UTF-16 and upr/ud | pp. 14–16 | Verified subset | Scope, control/binary fallback, surrogate pairs, Unicode alternate branch |
| ANSI/codepage/font charset | pp. 12–14, 17–20 | Partial | Windows-125x, Shift-JIS/EUC-JP, GBK/GB18030, Big5, EUC-KR, Mac Roman/Cyrillic, KOI8-R/U, ISO-8859 aliases and UTF-8/16LE/16BE via encoding_rs; exact-byte fixtures, malformed sequences and font cpg overrides tested. Extra numeric aliases are compatibility coverage, not a claim of normative RTF requirements; unavailable mappings still diagnose fallback |
| Font table | pp. 17–20 | Partial | IDs, names, charsets/codepages; no embedded-font registration or full associated-script font slots |
| Color table | pp. 20–22 | Verified subset | RGB, automatic colors, text/highlight lookup |
| Direct character styles and plain | Character Text section | Verified subset | Font/size, bold, italic, underline, strike, color, highlight, hidden text; baseline shifts implemented; complex underline/symbol-font rules omitted |
| Paragraph styles and pard | pp. 78–86 | Verified subset | Left/center/right/justify, physical/first-line indents, before/after spacing, exact/minimum/multiple line spacing |
| Tabs and line breaks | Paragraph Text section | Partial | Default tab interval and forced breaks; custom stops, leaders, decimal alignment deferred |
| Physical paper/margins and explicit pages | p. 49 | Verified subset | Point geometry; explicit blank pages; landscape default-paper handling; section overrides diagnosed |
| Automatic pagination | Paragraph/Page Information | Verified subset | Exact-line fixture matches independent 15+9 reference; no widow/orphan or keep-with-next algorithm yet |
| English and common Chinese | Unicode/font sections | Partial | Exact decoded text and fixed-font browser images checked; complete bidi, dictionary breaking and East Asian typography unverified |
| Canvas and ImageBitmap engine | Browser API | Verified | Geometry independent of PPI/scale/DPR; integral 150-PPI dimensions, fractional rounding, output limits and caller disposal |
| Font completion and explicit relayout | Browser API | Verified subset | Empty/known-unrelated completions ignored; relevant family changes invalidate geometry, require explicit relayout and increment layoutRevision. Hosts own cache refresh; eventless system-font changes require explicit relayout |
| Worker/cancellation/destruction | Browser API | Verified subset | Worker termination, pre-abort, owned/borrowed viewer, canvas contention and late-resource cleanup tests |
| Local-file viewer | Application | Verified | Upload, page navigation, zoom and downloaded PNG |
| PNG/JPEG pictures | pp. 148–152 | Partial | Inline hex/binary payload, authored goal/scale, bounded decode and retained rectangles; crop/float/shape properties diagnosed |
| Stylesheet cascade | Style Sheet | Planned | Definitions skipped with diagnostic; direct formatting retained |
| Lists and numbering | List Table / Paragraph Text | Partial fallback only | Cached listtext/pntext retained; actual numbering/restarts/overrides planned M3 |
| Ordinary tables | Table Definitions | Partial text fallback only | Reading-order separators retained with diagnostics; geometry, padding, borders and pagination planned M3 |
| Merges, nested tables, oversized rows | Table Definitions | Planned M3/M4 | No layout support claim |
| Sections, headers/footers, notes | Corresponding body sections | Planned M4 | Unsupported destinations/section geometry diagnosed; simple section break fallback only |
| Fields | Fields | Partial fallback only | Static fldrslt text; instructions neither evaluated nor fetched |
| WMF/EMF | pp. 148–152 | Partial recognition only | Bytes/type retained with placeholder and diagnostics; rtf.js runtime evaluated, drawing deferred |
| Shapes, floats and text boxes | Drawing Objects | Planned | Unsupported controls/destinations diagnosed |
| OLE objects | Objects | Never executed | Object destinations skipped; future static previews separate |
| Editing/round-trip | Outside read-only scope | Out of scope | No save API |

## Producer evidence

Seven original CC0 synthetic fixtures isolate rules. One actual LibreOffice 25.2.3.2 export is accompanied by an independently generated PDF and PNG. The current engine matches its page size, page count, reading order and line breaks; small metric/rasterization differences are documented in [compatibility](compatibility.md). No Word or TextEdit output has been verified. Passing this fixture does not establish general office-document fidelity.

## Known unsupported/failing classes

Documents whose appearance depends on stylesheet inheritance, real table geometry, generated numbering, headers/footers, section-specific paper settings, WMF/EMF records or complex script layout will differ or show placeholders. These are explicit future milestones. Current supplied synthetic samples render without a known content loss; the real sample produces compatibility diagnostics. See [verification](verification.md) for actual test results and remaining evidence gaps.
