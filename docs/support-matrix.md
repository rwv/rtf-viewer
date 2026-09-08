# RTF support matrix

**Planned** means no completed implementation claim. **Partial** means only the stated subset works. **Verified** means a named automated test or independent evidence checks the stated behavior; it never means the entire specification feature is supported.

| Feature | RTF 1.9.1 reference | Status | Evidence / boundary |
| --- | --- | --- | --- |
| Groups, escapes, control parameters | pp. 7–10 | Planned | Native tokenizer/state tests required |
| Binary payload boundaries | pp. 7–8, 14, 150 | Planned | Braces and slashes within bin data |
| Ignorable unknown destinations | pp. 9–10 | Planned | Must skip whole scope; report loss |
| Unicode u/uc, signed UTF-16 | pp. 14–16 | Planned | Fallback tokens, group boundaries, surrogate pairs |
| ANSI/codepage/font charset | pp. 12–14, 17–20 | Planned | Common Windows and East Asian codepages first |
| Font and color tables | pp. 17–22 | Planned | No automatic font downloads |
| Direct character styles, plain | Character Text section | Planned | Bold/italic/underline/strike/color/size; stylesheets separate |
| Paragraph properties, pard | pp. 78–86 | Planned | Alignment, indent, spacing, line breaks |
| Physical paper and margins | p. 49 | Planned | Explicit and automatic pagination |
| English and common Chinese | Unicode and font sections | Planned | Full bidi and East Asian rules excluded |
| Canvas and ImageBitmap engine | Browser API | Planned | Pixel dimensions and lifecycle tests |
| Local-file lightweight viewer | Application layer | Planned | Upload/navigation/zoom/export |
| PNG/JPEG pictures | pp. 148–152 | Planned | Inline goal size; crop/float separate |
| Stylesheet cascade | Style Sheet section | Planned | Diagnostics until implemented |
| Lists and numbering | List Table / Paragraph Text | Planned M3 | Real numbering, overrides and restart |
| Ordinary tables | Table Definitions | Planned M3 | Padding, borders and pagination required |
| Merges, nested tables, oversized rows | Table Definitions | Planned M3/M4 | Separate fixtures and explicit policies |
| Headers/footers/sections/fields/notes | Corresponding body sections | Planned M4 | Field results must not execute instructions |
| WMF/EMF | pp. 148–152 | Planned | rtf.js and upstream source reuse evaluation |
| Shapes, floats, text boxes | Drawing Objects | Planned | No silent flattening claim |
| Bidi, complex-script/East Asian typography | Relevant language sections | Planned | Common CJK display is not full support |
| OLE objects | Objects | Never executed | Future static fallback only |
| Editing and round-trip | Outside read-only scope | Out of scope | No save API |

Update this table after checks pass, with test locations and producer report links. Unsupported control words and destinations must remain visible in document diagnostics.
