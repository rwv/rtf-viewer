# Compatibility fixtures and independent reference

This document records the current fixture evidence. Synthetic fixtures state an objective semantic or geometry expectation. The LibreOffice artifacts and their exports record observed producer results; they are compatibility evidence rather than a normative interpretation of RTF. Their provenance and classified deltas are also held machine-readably in `fixtures/corpus.json`, described in [corpus](corpus.md) and checked by `pnpm check:corpus`.

## Synthetic fixtures

All synthetic files and image sources are original CC0 material. Run `python3 scripts/generate-reference.py` from the repository root to recreate them. The script requires Python 3 and Pillow. The image payloads were first generated with Pillow 12.1.1 and regenerate byte-identically under Pillow 12.3.0.

| Fixture                     | Isolated purpose                                                 | Objective expectations useful in tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `common-text-styles.rtf`    | Direct character styles                                          | One Letter page; six paragraphs; the literal ranges are respectively plain, bold, italic, underlined, struck, and bold + italic + underlined. Every reset occurs before the paragraph end.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `unicode-en-zh.rtf`         | English and Chinese Unicode using `\uc1` and `\uN?` fallback     | One Letter page; decoded lines are `English: Hello, world!`, `Chinese: 中文 你好世界`, and `Mixed: RTF 文本 2026.`; fallback question marks do not survive decoding.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `automatic-pagination.rtf`  | Automatic pagination on explicit small paper                     | Two 216 × 216 pt pages with 18 pt margins and 180 × 180 pt usable area; 24 distinct paragraphs use exact 12 pt line spacing (`\sl-240`). Lines 01–15 occupy page 1 and lines 16–24 page 2. There is no `\page` control.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `explicit-pages.rtf`        | Explicit page breaks                                             | Exactly three Letter pages containing one marker each: page one, page two, and page three.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `indents-spacing.rtf`       | First-line and hanging indents plus paragraph/line spacing       | One Letter page with 90 pt horizontal and 72 pt vertical margins. Paragraph 1 has left/right indents of 36 pt, a +18 pt first-line indent, 12 pt before, and 18 pt after: first-line x = 144 pt, continuation x = 126 pt, right edge = 486 pt. Paragraph 2 has a 54 pt left indent and -18 pt first-line indent: first-line x = 126 pt, continuation x = 144 pt; its line spacing is 1.5 lines.                                                                                                                                                                                                                                     |
| `inline-png-jpeg.rtf`       | Inline raster image decoding                                     | One Letter page; one PNG and one JPEG, each declares 16 × 12 source pixels and 720 × 540 twip goals, so each layout rectangle is 36 × 27 pt. Embedded payload bytes equal the adjacent files in `assets/`.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `list-numbering.rtf`        | Generated list numbering                                         | One 216 × 216 pt page with 18 pt margins. One list table declares an arabic level and a lower-letter level whose template names both counters; a second declares a bullet level; a third override restarts at seven. The resolved markers are `1.`, `2.`, `2.a)`, `2.b)`, `3.`, `•`, `•`, `7.`, `8.`. Level one hangs at 18 pt and level two at 36 pt, each with a 9 pt hanging first line, so first lines begin at x = 27 and 45 pt. Every paragraph also carries a cached `CACHED` marker that the resolved number replaces.                                                                                                      |
| `ordinary-table.rtf`        | Single-level table geometry, borders and cross-page continuation | Exactly two 216 × 216 pt pages with 18 pt margins. Three columns end at 60, 120 and 180 pt from the left margin; every cell has 3 pt horizontal and 2 pt vertical padding, so content begins at x = 21, 81 and 141 pt. Outer borders are 1 pt and inner borders 0.5 pt, each centred on its boundary. Rows start at y = 18, 34, 50, 78 and 102 pt; the fourth row uses an exact 24 pt height. The last row is 8 lines tall, breaks after its seventh line at y = 188 pt and continues at the top of page two, where `After the table.` follows at y = 32 pt. Exact 12 pt line spacing keeps every position independent of the font. |
| `table-cell-fill-align.rtf` | Vertical cell alignment and cell shading                         | One 216 × 216 pt page with 18 pt margins, the same three columns and padding as `ordinary-table.rtf`. The header row declares `\trcbpat`, so all three cells fill with `#e6e6e6` over y = 18–34 pt. In the second row a `\clshdng5000` blend of `#205493` over `#e6e6e6` fills `#839dbd` over y = 34–62 pt, and beside that two-line cell the centred line sits at y = 42 pt and the bottom-aligned line at y = 48 pt. The third row has an exact 24 pt height, so its centred line sits at y = 68 pt while its plain neighbours sit at 64 pt. `After the table.` follows at y = 86 pt.                                             |
| `table-merged-cells.rtf`    | Horizontally merged cells                                        | One 216 × 216 pt page with the same three columns and padding as `ordinary-table.rtf`. The header merges the first two columns, so its cell reaches 120 pt from the left margin and no wall is drawn on the 78 pt boundary; the last row merges the final two, so no wall is drawn on the 138 pt boundary. The middle row keeps all three columns and all four walls. Every row is one line tall, because a merged-away cell contributes no blank line, so rows start at y = 18, 34 and 50 pt and `After the table.` follows at y = 66 pt.                                                                                          |
| `showcase.rtf`              | Original redistributable combined example                        | Exactly two 432 × 540 pt pages with 45 pt margins. Page 1 contains the title, styles, hanging paragraph, English/Chinese Unicode, and a PNG displayed at 72 × 54 pt. Page 2 starts at the explicit `\page` and contains its marker plus a JPEG displayed at 72 × 54 pt.                                                                                                                                                                                                                                                                                                                                                             |

LibreOffice 25.2.3.2 was used as a secondary sanity check for the first seven fixtures, not as the source of their expectations. It produced the page counts above and placed automatic markers 01–15 on the first page and 16–24 on the second. `ordinary-table.rtf` states geometry derived from the specification rules in [spec notes](spec-notes.md); the producer comparison for tables is the separate LibreOffice 24.2.7.2 artifact below.

## Real LibreOffice text artifact

`fixtures/real/libreoffice-25.2.3.2.rtf` is a real LibreOffice RTF export, not a handcrafted file carrying a producer label. Its RTF generator field is `LibreOffice/25.2.3.2$Linux_X86_64 LibreOffice_project/520$Build-2`. It was generated on Debian GNU/Linux 13.6 (trixie), x86-64, with:

- LibreOffice 25.2.3.2, Debian packages `libreoffice-core` and `libreoffice-writer` version `4:25.2.3-2+deb13u6`.
- Liberation fonts package `fonts-liberation` version `1:2.1.5-3`.
- Liberation Serif Regular at `/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf`, SHA-256 `9caef765d2e891c10dd73658894f01e660fe0c1c83e0bda7d6edf561d8f623d4`.
- Liberation Sans Regular at `/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf`, SHA-256 `bade59d822652f76e6941aa87b40a87c13d1cc70db98ededb5011127efafd1d3`.
- LibreOffice selected FreeSans for the Chinese glyphs because Liberation Serif does not contain them. The observed fallback was `fonts-freefont-ttf` version `20211204+svn4273-2`, SHA-256 `ad5b4b55537a7ef413aa7cbae8e6e9104030f4f1588db66d8907e3724298cb85` for `FreeSans.ttf`.

The source and export commands were:

```sh
python3 scripts/generate-reference.py
mkdir -p fixtures/reference
profile_dir=$(mktemp -d /tmp/rtf-lo-profile.XXXXXX)
profile_url="file://${profile_dir}"
libreoffice -env:UserInstallation="${profile_url}" --headless \
  --convert-to 'rtf:Rich Text Format' --outdir /tmp \
  fixtures/real/libreoffice-25.2-source.html
mv /tmp/libreoffice-25.2-source.rtf fixtures/real/libreoffice-25.2.3.2.rtf
libreoffice -env:UserInstallation="${profile_url}" --headless \
  --convert-to 'pdf:writer_pdf_Export' --outdir fixtures/reference \
  fixtures/real/libreoffice-25.2.3.2.rtf
pdftotext -layout fixtures/reference/libreoffice-25.2.3.2.pdf \
  fixtures/reference/libreoffice-25.2.3.2.txt
pdftoppm -singlefile -png -r 96 \
  fixtures/reference/libreoffice-25.2.3.2.pdf \
  fixtures/reference/libreoffice-25.2.3.2-page-1
```

The independent reference PDF was exported by reopening the generated RTF. Poppler 25.03.0 (`poppler-utils` Debian version `25.03.0-5+deb13u4`) produced the text and PNG derivatives. The PDF is one 288 × 360 pt page; the 96 PPI PNG is 384 × 480 pixels.

Coordinates below are PDF points from the top-left page corner, extracted with `pdftotext -bbox-layout`. A tolerance of 0.25 pt is appropriate when checking this exact committed PDF. Comparisons against a fresh export should use a wider tolerance because PDF timestamps, exporter versions, and rasterizers can change.

| Marker                              |   x min |   y min |   x max |   y max | Observation                                                               |
| ----------------------------------- | ------: | ------: | ------: | ------: | ------------------------------------------------------------------------- |
| First title line, `LibreOffice RTF` |  36.100 |  48.610 | 170.938 |  68.698 | 18 pt Liberation Sans Bold                                                |
| `Plain ... underlined` first line   |  36.100 | 101.908 | 239.926 | 115.192 | Mixed direct styles, 12 pt Liberation Serif                               |
| Indented paragraph first line       |  90.100 | 139.508 | 244.264 | 152.792 | 36 pt left indent plus 18 pt first-line indent, with 0.1 pt export offset |
| Indented paragraph continuation     |  72.100 | 153.308 | 239.308 | 166.592 | 36 pt left indent, with 0.1 pt export offset                              |
| `Unicode text:`                     |  36.100 | 180.908 | 100.996 | 194.192 | Liberation Serif portion                                                  |
| `中文,`                             | 136.700 | 177.788 | 163.700 | 195.032 | FreeSans fallback has different ascent/descent                            |
| `Continuation Marker`               |  36.100 | 216.810 | 210.916 | 236.898 | Second heading on the same physical page                                  |
| `Final marker: LO-25.2.3.2.`        |  36.100 | 273.208 | 165.976 | 286.492 | Final baseline region                                                     |

The committed PNG was visually inspected at its native 384 × 480 resolution. It shows one unclipped page, correct bold/italic/underline distinctions, the intended three-line indented paragraph, legible Chinese fallback glyphs, and no overlap. The plain-text reference preserves the reading order and ends with one form-feed page terminator.

## Engine comparison against the reference

The browser engine was run against the real LibreOffice RTF through the production-built test harness at 96 PPI with the bundled Liberation fonts and FreeSans fallback. It produced one 288 × 360 pt page and a 384 × 480 pixel raster, exactly matching the reference page count and physical/raster sizes. It preserved all text in the same reading order and made the same ten line breaks, including the title split after `RTF` and the three-line indented paragraph.

The table compares the engine's retained line rectangle with Poppler's bounding box for the corresponding LibreOffice PDF text. `Δx` and `Δy` are engine minus reference in points. A line rectangle and a PDF ink box do not have identical semantics, so these deltas establish a practical baseline rather than a pixel-equality requirement.

| Marker                 |       Engine x/y |    Reference x/y |           Δx/Δy | Engine/reference right edge |
| ---------------------- | ---------------: | ---------------: | --------------: | --------------------------: |
| `LibreOffice RTF`      |  36.000 / 48.000 |  36.100 / 48.610 | -0.100 / -0.610 |           171.000 / 170.938 |
| `Reference`            |  36.000 / 68.000 |  36.100 / 69.310 | -0.100 / -1.310 |           123.000 / 123.076 |
| `Plain ... underlined` | 36.000 / 100.000 | 36.100 / 101.908 | -0.100 / -1.908 |           235.000 / 239.926 |
| `words.`               | 36.000 / 114.000 | 36.100 / 115.708 | -0.100 / -1.708 |             69.000 / 68.392 |
| Indented first line    | 90.000 / 138.000 | 90.100 / 139.508 | -0.100 / -1.508 |           241.000 / 244.264 |
| Indented continuation  | 72.000 / 152.000 | 72.100 / 153.308 | -0.100 / -1.308 |           238.000 / 239.308 |
| `Unicode text...`      | 36.000 / 180.000 | 36.100 / 177.788 | -0.100 / +2.212 |           215.000 / 217.700 |
| `Continuation Marker`  | 36.000 / 216.000 | 36.100 / 216.810 | -0.100 / -0.810 |           211.000 / 210.916 |
| `This sentence...`     | 36.000 / 248.000 | 36.100 / 249.408 | -0.100 / -1.408 |           235.000 / 238.564 |
| `Final marker...`      | 36.000 / 272.000 | 36.100 / 273.208 | -0.100 / -1.208 |           164.000 / 165.976 |

The engine raster was also visually inspected at native resolution. Text remains unclipped and non-overlapping; bold, italic, underline, paragraph indentation, and Chinese fallback are visibly present. The engine reported bounded compatibility notices for unsupported LibreOffice metadata, stylesheet, footnote, and section controls. Those notices did not alter the page dimensions, text order, or line breaks. This comparison does not claim general LibreOffice fidelity beyond this fixture.

## Real LibreOffice table artifact

`fixtures/real/libreoffice-24.2.7.2-table.rtf` is a real LibreOffice export whose `\generator` field is `LibreOffice/24.2.7.2$Linux_X86_64 LibreOffice_project/420$Build-2`. It was generated on Ubuntu 24.04.4 LTS, x86-64, with `libreoffice-core` 4:24.2.7-0ubuntu0.24.04.4, `libreoffice-writer` 4:24.2.7-0ubuntu0.24.04.6, `fonts-liberation` 1:2.1.5-3 and `poppler-utils` 24.02.0-1ubuntu9.9. The exact font files and hashes are in `fixtures/corpus.json`.

```sh
profile_dir=$(mktemp -d /tmp/rtf-lo-profile.XXXXXX)
libreoffice -env:UserInstallation="file://${profile_dir}" --headless \
  --convert-to 'rtf:Rich Text Format' --outdir /tmp \
  fixtures/real/libreoffice-24.2-table-source.html
mv /tmp/libreoffice-24.2-table-source.rtf fixtures/real/libreoffice-24.2.7.2-table.rtf
libreoffice -env:UserInstallation="file://${profile_dir}" --headless \
  --convert-to 'pdf:writer_pdf_Export' --outdir fixtures/reference \
  fixtures/real/libreoffice-24.2.7.2-table.rtf
pdftotext -layout fixtures/reference/libreoffice-24.2.7.2-table.pdf \
  fixtures/reference/libreoffice-24.2.7.2-table.txt
pdftoppm -png -r 96 fixtures/reference/libreoffice-24.2.7.2-table.pdf \
  fixtures/reference/libreoffice-24.2.7.2-table-page
```

The document is a twelve-row, three-column bordered table on 288 × 360 pt pages with 36 pt margins, preceded by a heading and followed by one paragraph. The reference PDF is three pages. Cell boundaries are 36, 86.25, 128.25 and 266.25 pt; declared cell padding is 2.25 pt on every side; header-row borders are 0.75 pt and body borders 0.05 pt, which the engine clamps to a visible 0.25 pt.

The engine was run against this file through the production-built harness with the bundled Liberation fonts. It produced three pages of 288 × 360 pt, preserved the reading order, and made the same line breaks inside cells: every line it emitted appears unbroken in Poppler's text extraction of the reference, including `A note long enough to wrap` / `inside its own cell.` and `Row 01 continues the table past` / `the first page.` It reports no table diagnostic at all.

| Measurement                        |                            Engine |                           Reference | Delta and classification                                       |
| ---------------------------------- | --------------------------------: | ----------------------------------: | -------------------------------------------------------------- |
| Page count                         |                                 3 |                                   3 | equal                                                          |
| Body cell content left edges       |            38.25 / 88.50 / 130.50 |              38.70 / 88.90 / 130.95 | +0.40 to +0.45 pt producer inset (`layout`)                    |
| Centred header cell left edges     |          46.125 / 95.75 / 188.125 |              46.55 / 96.30 / 188.10 | same centring, within the same inset (`layout`)                |
| Single-line row pitch              |                          23.50 pt |                            24.15 pt | -0.65 pt per row from the line box (`font`)                    |
| Two-line note row, first text line |                          97.75 pt |                            99.69 pt | vertical centring not applied (`layout`)                       |
| Two-line note row, `North`         |                          97.75 pt |                           105.44 pt | vertical centring not applied (`layout`)                       |
| Row broken across pages 1 and 2    | Zone 01, after its last text line | Zone 01, between its two text lines | different break offset from the pitch delta (`layout`)         |
| Rule across the top of page 2      |                              none |                             y 36 pt | collapsed borders leave the edge to the previous row (`paint`) |

Every remaining delta above is recorded in `fixtures/corpus.json` with its measurement and the issue that tracks it. Vertical cell alignment was an open `layout` delta until issue #25; the producer's centring is now reproduced and only the line-box residual remains inside the row. The pitch delta accumulates: by the end of the table the engine is roughly one row ahead, so page three begins with `Zone 10` rather than `Total`. Page count, column geometry and in-cell line breaking match; vertical alignment, the producer's extra border inset and the continuation rule do not. This comparison does not claim general LibreOffice table fidelity beyond this fixture.

## Real LibreOffice list artifact

`fixtures/real/libreoffice-24.2.7.2-list.rtf` is a real LibreOffice export with the same provenance as the table artifact above; the exact packages and font hashes are in `fixtures/corpus.json`. It declares four lists and nine `\listoverride` entries, and uses `\levelnfc0`, `\levelnfc23` and `\levelnfc255`, `\levelfollow0` and `\levelfollow2`, and both `\levelstartat1` and `\levelstartat7`.

The engine resolves its numbering from the list table rather than from the cached `\listtext`, and the result is identical to Poppler's extraction of the producer's own PDF, marker for marker:

| Reference marker | Engine marker | Level |
| ---------------- | ------------- | ----- |
| `1.`             | `1.`          | 0     |
| `2.`             | `2.`          | 0     |
| `1.`             | `1.`          | 1     |
| `2.`             | `2.`          | 1     |
| `3.`             | `3.`          | 0     |
| `•`              | `•`           | 0     |
| `•`              | `•`           | 0     |
| `7.`             | `7.`          | 0     |
| `8.`             | `8.`          | 0     |

The deeper level restarts under each parent and the override's start value of seven is honoured. The one recorded delta is that the producer pads its cached marker with a leading space the generated marker does not reproduce; the level template declares only the placeholder and a full stop, so that space is the producer's own padding rather than something the document asks for.

## Artifact hashes

These SHA-256 values identify the exact committed evidence. A regenerated PDF will normally differ because LibreOffice writes creation metadata; use the geometry and content assertions above when validating a new export.

| File                                                       | SHA-256                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `scripts/generate-reference.py`                            | `2246552e6f595e4e045bda2ebf4396a40342f721e8a35f6b7ba7d3e8e7bb2728` |
| `fixtures/synthetic/automatic-pagination.rtf`              | `a0ab18dee28ec428950996d17ff90264ee1117c0c18081155863b133b1639f82` |
| `fixtures/synthetic/common-text-styles.rtf`                | `2e5b38277d97700e4c2ccf17207b5db0c4c3f979aed5c5b4d70af9484f8ad916` |
| `fixtures/synthetic/explicit-pages.rtf`                    | `e8b1d2c5984eeeed2fba1e6a41251b25ba1fb21f7171a5495b86d6128f5ffe14` |
| `fixtures/synthetic/indents-spacing.rtf`                   | `1a8e4000ab32d3f834efcb805269ca0b4ee19766c3e1078900ab607fadda048a` |
| `fixtures/synthetic/inline-png-jpeg.rtf`                   | `a1d435caffb685306a6b164126d216c390e65275d58dcfadb7109a2a34224d0b` |
| `fixtures/synthetic/list-numbering.rtf`                    | `4c0d798dd8788718865cbb725f7dd9d7385d987443c924fae68cd5e37dc42ab0` |
| `fixtures/synthetic/ordinary-table.rtf`                    | `66ac0a4be1ff97861e245f0493d782f3d06e50773612865c8d0bcb5eceb9ee25` |
| `fixtures/synthetic/table-cell-fill-align.rtf`             | `47a804b3e15697f9067536d665372ac5d4dfc4e3e92d3bb25aafb4f766802cf1` |
| `fixtures/synthetic/table-merged-cells.rtf`                | `368fd13e24e8b6d9322fd676572ad2525b4e466a42aa24013fa8e1f25a7b0ef1` |
| `fixtures/synthetic/showcase.rtf`                          | `5b95c4b96e83ae7753fe5d9d593e810ed3d6a49f6d30fa376307c3c4c519e198` |
| `fixtures/synthetic/unicode-en-zh.rtf`                     | `a74d0d972f1691466cc5d66e466c4347bc4ecc14601af63c9adb4b78103935c1` |
| `fixtures/synthetic/assets/inline-pattern.jpg`             | `956aacee65305f533bbc1b946d2b77e1dfca714c45c1bfb2159ced90bd9883e1` |
| `fixtures/synthetic/assets/inline-pattern.png`             | `1e0d06ba4b5c8eb9ecac3da3ba1eb641aab369a28fabb5734575d98361fc77fa` |
| `fixtures/real/libreoffice-25.2-source.html`               | `8020b119a4cf9084fe3b1d0953e2257e71a3dc5ecb3040b22343a3b50c6417df` |
| `fixtures/real/libreoffice-25.2.3.2.rtf`                   | `5eb55a887fb0fef6efe445baf46a021e318af1abac1a938bf402090840e9c9d3` |
| `fixtures/reference/libreoffice-25.2.3.2.pdf`              | `f63425a88eb3b54f48addb13b9e2b6003d442e3c442d46845cf7da9a1f3c515c` |
| `fixtures/reference/libreoffice-25.2.3.2.txt`              | `5f2bab1f375c329a9fc04eb34bae4b3bb1f89fb2a4c240634621bb97319de5a6` |
| `fixtures/reference/libreoffice-25.2.3.2-page-1.png`       | `077a4b322e3bc87723033ee0bac4c630ffe46decaf57b3c9f798b214e99bf829` |
| `fixtures/real/libreoffice-24.2-table-source.html`         | `8c1a4272b8502ae484bcf284cd40a60c19c6e4c4172a805595dfab0e68bf8728` |
| `fixtures/real/libreoffice-24.2.7.2-table.rtf`             | `30591ba1660f61583c23d676805181a024d4f411d3ca10d8aeed62f2c7cdc966` |
| `fixtures/reference/libreoffice-24.2.7.2-table.pdf`        | `4ef3f8091d1e1b81f30e819d935ca1ce53d6f5169ae9202483b643f6c4907a1c` |
| `fixtures/reference/libreoffice-24.2.7.2-table.txt`        | `62f28edfc19ed06112238c83476c20feb0ef901ea0ef4a884d089eba1518076b` |
| `fixtures/reference/libreoffice-24.2.7.2-table-page-1.png` | `3ba02f5d16f6133b3c9d8f93c5cece45c5602efe4c99294e978282678bee7fa3` |
| `fixtures/reference/libreoffice-24.2.7.2-table-page-2.png` | `b7c9dc3184b5a24b3de74a4b47ccda04765109371a0f584f33e02c3e9eb26946` |
| `fixtures/reference/libreoffice-24.2.7.2-table-page-3.png` | `b2c4346c6c1ec2eaf7fc2aad2027fb46f95f0643fda6a7fe93081a0afc5c59e9` |
| `fixtures/real/libreoffice-24.2-list-source.html`          | `812372516d0603ffe72429f0fdfb76ae7876bba9bb062595470615206203363b` |
| `fixtures/real/libreoffice-24.2.7.2-list.rtf`              | `bfb36cebd2ca9e9318f59a8f392a2ffe21d7001cc61581cc143561e493eaf290` |
| `fixtures/reference/libreoffice-24.2.7.2-list.pdf`         | `949fa19f4befef6b0a6012c7800cd5b60059b64c739d84861045bb566978d703` |
| `fixtures/reference/libreoffice-24.2.7.2-list.txt`         | `26e2886a7bd5ca99aa50f2281609894acdd4df33881c72832e633070001460c4` |
| `fixtures/reference/libreoffice-24.2.7.2-list-page-1.png`  | `35ccaedee29101b41c17ccf8e87ac3cd86bc9a41a8731caac7815ec418ec0a92` |

No Microsoft Word or Apple TextEdit producer artifact is included because neither producer was available. Their compatibility remains unverified; no handcrafted fixture is labeled as either producer. See [corpus](corpus.md) for how to add one.
