use pretty_assertions::assert_eq;
use rtf_parser::{Block, ImageFormat, LineSpacing, ParagraphAlign, Run, parse};

fn model(input: &[u8]) -> rtf_parser::DocumentModel {
    parse(input).expect("fixture should parse")
}

fn codepage_model(codepage: i32, hex: &str) -> rtf_parser::DocumentModel {
    let (pairs, remainder) = hex.as_bytes().as_chunks::<2>();
    assert!(remainder.is_empty());
    let mut escaped = String::with_capacity(hex.len() * 2);
    for pair in pairs {
        assert!(pair.iter().all(u8::is_ascii_hexdigit));
        escaped.push_str("\\'");
        escaped.push(char::from(pair[0]));
        escaped.push(char::from(pair[1]));
    }
    model(format!("{{\\rtf1\\ansi\\ansicpg{codepage} {escaped}}}").as_bytes())
}

fn paragraphs(
    model: &rtf_parser::DocumentModel,
) -> impl Iterator<Item = (&[Run], &rtf_parser::ParagraphStyle)> {
    model.blocks.iter().filter_map(|block| match block {
        Block::Paragraph { runs, style, .. } => Some((runs.as_slice(), style)),
        Block::PageBreak | Block::Row { .. } => None,
    })
}

fn paragraph_text(runs: &[Run]) -> String {
    runs.iter()
        .filter_map(|run| match run {
            Run::Text { text, .. } => Some(text.as_str()),
            Run::Image { .. } => None,
        })
        .collect()
}

fn all_text(document: &rtf_parser::DocumentModel) -> String {
    paragraphs(document)
        .map(|(runs, _)| paragraph_text(runs))
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn parses_delimiters_escapes_and_nested_style_restoration() {
    let document = model(br"{\rtf1\ansi A\b bold\b0  plain \\ \{x\} {\i italic} end\par}");
    assert_eq!(all_text(&document), "Abold plain \\ {x} italic end");
    let (runs, _) = paragraphs(&document).next().unwrap();
    let styled: Vec<_> = runs
        .iter()
        .filter_map(|run| match run {
            Run::Text { text, style } => Some((text.as_str(), style.bold, style.italic)),
            _ => None,
        })
        .collect();
    assert_eq!(
        styled,
        vec![
            ("A", false, false),
            ("bold", true, false),
            (" plain \\ {x} ", false, false),
            ("italic", false, true),
            (" end", false, false),
        ]
    );
}

#[test]
fn unknown_controls_do_not_hide_text_but_starred_destinations_do() {
    let document = model(br"{\rtf1 A\future42 B{\*\future hidden\{\}\~\line}C\par}");
    assert_eq!(all_text(&document), "ABC");
    assert!(
        document
            .diagnostics
            .iter()
            .any(|d| d.code == "unsupported-control")
    );
    assert!(
        document
            .diagnostics
            .iter()
            .any(|d| d.code == "unknown-destination")
    );
}

#[test]
fn skipped_destination_cannot_reenter_visible_or_picture_destinations() {
    let document = model(
        br"{\rtf1 before{\*\future hidden{\fldrslt SECRET}{\pict\pngblip 89504e470d0a1a0a}}after\par}",
    );
    assert_eq!(all_text(&document), "beforeafter");
    assert!(document.images.is_empty());
}

#[test]
fn unicode_fallback_is_token_aware_and_scoped() {
    let document = model(br"{\rtf1\ansi\uc1\u945?\u946\'3f\u947\{\u948\par{\uc0\u949}\u950?\par}");
    assert_eq!(all_text(&document), "αβγδεζ");
    assert_eq!(paragraphs(&document).count(), 1);
}

#[test]
fn unicode_fallback_stops_at_group_boundaries() {
    let document = model(br"{\rtf1\uc2 X\u945?{Y}Z\par}");
    assert_eq!(all_text(&document), "XαYZ");
}

#[test]
fn unicode_surrogate_pair_is_combined() {
    let document = model(br"{\rtf1\uc1\u-10179?\u-8704?\par}");
    assert_eq!(all_text(&document), "😀");
}

#[test]
fn binary_fallback_is_one_unit_and_binary_metacharacters_are_opaque() {
    let mut input = br"{\rtf1\uc1\u945\bin5 ".to_vec();
    input.extend_from_slice(b"{}\\\r\n");
    input.extend_from_slice(br"done\par}");
    let document = model(&input);
    assert_eq!(all_text(&document), "αdone");
}

#[test]
fn decodes_document_and_font_codepages_with_dbcs_buffering() {
    let cyrillic = model(br"{\rtf1\ansi\ansicpg1251 \'cf\'f0\'e8\'e2\'e5\'f2\par}");
    assert_eq!(all_text(&cyrillic), "Привет");

    let japanese =
        model(br"{\rtf1\ansi\ansicpg1252{\fonttbl{\f0\fcharset128 MS Gothic;}}\f0\'82\'a0\par}");
    assert_eq!(all_text(&japanese), "あ");
    assert_eq!(japanese.fonts[0].codepage, Some(932));

    let override_page = model(br"{\rtf1\ansi{\fonttbl{\f0\fcharset128\cpg1251 Test;}}\f0\'cf\par}");
    assert_eq!(all_text(&override_page), "П");
}

#[test]
fn decodes_legacy_and_unicode_codepage_fixtures() {
    let cases = [
        (28592, "a3f364bc", "Łódź"),
        (20866, "f0d2c9d7c5d4", "Привет"),
        (1256, "e3d1cdc8c7", "مرحبا"),
        (1255, "f9ece5ed", "שלום"),
        (874, "e4b7c2", "ไทย"),
        (65001, "e4b8ade69687f09f9880", "中文😀"),
        (932, "93fa967b8cea", "日本語"),
        (51932, "c6fccbdcb8ec", "日本語"),
        (936, "d6d0cec4", "中文"),
        (54936, "d6d0cec4953282369439fc36", "中文𠀀😀"),
        (949, "c7d1b1b9beee", "한국어"),
        (950, "c163c5e9a4a4a4e5", "繁體中文"),
        (10000, "6361668e", "café"),
        (1200, "2d4e87653dd800de", "中文😀"),
        (1201, "4e2d6587d83dde00", "中文😀"),
    ];

    for (codepage, hex, expected) in cases {
        let document = codepage_model(codepage, hex);
        assert_eq!(all_text(&document), expected, "codepage {codepage}");
        assert!(
            document
                .diagnostics
                .iter()
                .all(|diagnostic| diagnostic.code != "unsupported-codepage"),
            "codepage {codepage} should be supported"
        );
    }
}

#[test]
fn decodes_additional_compatibility_codepage_aliases() {
    let cases = [
        (10007, "8ff0e8e2e5f2", "Привет"),
        (21866, "b7a7b4a4b6a6bdad", "ЇїЄєІіҐґ"),
        (28593, "a1b1", "Ħħ"),
        (28594, "c0e0", "Āā"),
        (28595, "bfe0d8d2d5e2", "Привет"),
        (28596, "e5d1cdc8c7", "مرحبا"),
        (28597, "c5ebebdce4e1", "Ελλάδα"),
        (28598, "f9ece5ed", "שלום"),
        (28600, "c0e0", "Āā"),
        (28603, "c2e2", "Āā"),
        (28604, "d0f0", "Ŵŵ"),
        (28605, "a4", "€"),
        (28606, "aaba", "Șș"),
        (38598, "f9ece5ed", "שלום"),
        (51949, "c7d1b1b9beee", "한국어"),
    ];

    for (codepage, hex, expected) in cases {
        let document = codepage_model(codepage, hex);
        assert_eq!(all_text(&document), expected, "codepage {codepage}");
        assert!(
            document
                .diagnostics
                .iter()
                .all(|diagnostic| diagnostic.code != "unsupported-codepage"),
            "codepage {codepage} should be supported"
        );
    }
}

#[test]
fn utf16_decoding_does_not_take_the_ascii_fast_path() {
    for (codepage, hex, expected) in [
        (1200, "4100", "A"),
        (1201, "0041", "A"),
        (1200, "2d4e", "中"),
    ] {
        let document = codepage_model(codepage, hex);
        assert_eq!(all_text(&document), expected, "codepage {codepage}");
    }
}

#[test]
fn truncated_multibyte_sequences_are_replaced_and_diagnosed() {
    for (codepage, hex, expected) in [
        (1200, "41", "�"),
        (1201, "00", "�"),
        (1200, "3dd84100", "�A"),
        (51932, "c6", "�"),
        (54936, "81", "�"),
    ] {
        let document = codepage_model(codepage, hex);
        assert_eq!(all_text(&document), expected, "codepage {codepage}");
        assert!(
            document
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "text-decoding-error"),
            "codepage {codepage} should diagnose a truncated sequence"
        );
        assert!(
            document
                .diagnostics
                .iter()
                .all(|diagnostic| diagnostic.code != "unsupported-codepage"),
            "codepage {codepage} should remain recognized"
        );
    }
}

#[test]
fn font_codepage_override_applies_to_utf16_font_names_and_runs() {
    let document = model(
        br"{\rtf1\ansi\ansicpg1252{\fonttbl{\f0\fcharset0\cpg1200 \'54\'00\'65\'00\'73\'00\'74\'00;}}\f0\'41\'00\par}",
    );

    assert_eq!(document.fonts[0].name, "Test");
    assert_eq!(document.fonts[0].codepage, Some(1200));
    assert_eq!(all_text(&document), "A");
    assert!(
        document
            .diagnostics
            .iter()
            .all(|diagnostic| diagnostic.code != "unsupported-codepage")
    );
}

#[test]
fn decodes_escaped_and_unicode_font_table_names() {
    let escaped = model(br"{\rtf1\ansi{\fonttbl{\f0\fcharset134 \'cb\'ce\'cc\'e5;}}\f0 text\par}");
    assert_eq!(escaped.fonts[0].name, "宋体");
    assert_eq!(escaped.fonts[0].codepage, Some(936));

    let unicode =
        model(br"{\rtf1\ansi\uc1{\fonttbl{\f0\fcharset0 \u23435?\u20307?;}}\f0 text\par}");
    assert_eq!(unicode.fonts[0].name, "宋体");
    assert_eq!(all_text(&unicode), "text");
}

#[test]
fn upr_selects_unicode_copy_once() {
    let document = model(br"{\rtf1\ansi\uc1{\upr{ANSI}{\*\ud Unicode \u945?}}\par}");
    assert_eq!(all_text(&document), "Unicode α");
}

#[test]
fn plain_and_pard_reset_independent_properties() {
    let document = model(br"{\rtf1\b\li720 bold indented\pard still bold\plain plain\par}");
    let (runs, style) = paragraphs(&document).next().unwrap();
    assert_eq!(style.left_indent, 0.0);
    assert_eq!(paragraph_text(runs), "bold indentedstill boldplain");
    let styles: Vec<_> = runs
        .iter()
        .filter_map(|run| match run {
            Run::Text { style, .. } => Some(style.bold),
            _ => None,
        })
        .collect();
    assert_eq!(styles, vec![true, false]);
}

#[test]
fn paragraph_properties_and_spacing_are_resolved_at_flush() {
    let document = model(br"{\rtf1 text\qc\li720\ri360\fi-240\sb120\sa240\sl-360\slmult0\pagebb\par next\sl360\slmult1\par}");
    let paragraphs: Vec<_> = paragraphs(&document).collect();
    assert_eq!(paragraphs[0].1.align, ParagraphAlign::Center);
    assert_eq!(paragraphs[0].1.left_indent, 36.0);
    assert_eq!(paragraphs[0].1.right_indent, 18.0);
    assert_eq!(paragraphs[0].1.first_line_indent, -12.0);
    assert_eq!(paragraphs[0].1.space_before, 6.0);
    assert_eq!(paragraphs[0].1.space_after, 12.0);
    assert_eq!(paragraphs[0].1.line_spacing, LineSpacing::Exact(18.0));
    assert!(paragraphs[0].1.page_break_before);
    assert_eq!(paragraphs[1].1.line_spacing, LineSpacing::Multiple(1.5));
}

#[test]
fn explicit_breaks_preserve_consecutive_blank_pages() {
    let document = model(br"{\rtf1 first\par\page\page second\line line\par}");
    assert_eq!(
        document
            .blocks
            .iter()
            .filter(|b| matches!(b, Block::PageBreak))
            .count(),
        2
    );
    assert_eq!(all_text(&document), "first\nsecond\nline");
}

#[test]
fn defaults_and_explicit_page_geometry_are_points() {
    let defaults = model(br"{\rtf1}");
    assert_eq!(defaults.page.width, 612.0);
    assert_eq!(defaults.page.height, 792.0);
    assert_eq!(defaults.page.margin_left, 90.0);
    assert_eq!(defaults.default_tab, 36.0);

    let explicit = model(
        br"{\rtf1\paperw10000\paperh12000\margl1000\margr1200\margt1400\margb1600\deftab800}",
    );
    assert_eq!(explicit.page.width, 500.0);
    assert_eq!(explicit.page.height, 600.0);
    assert_eq!(explicit.page.margin_left, 50.0);
    assert_eq!(explicit.page.margin_right, 60.0);
    assert_eq!(explicit.page.margin_top, 70.0);
    assert_eq!(explicit.page.margin_bottom, 80.0);
    assert_eq!(explicit.default_tab, 40.0);
}

#[test]
fn section_geometry_is_diagnosed_without_mutating_document_page() {
    let document = model(br"{\rtf1\paperw10000\pgwsxn20000 body\par}");
    assert_eq!(document.page.width, 500.0);
    assert!(
        document
            .diagnostics
            .iter()
            .any(|d| d.code == "unsupported-section-geometry")
    );
}

#[test]
fn parses_hex_png_and_binary_jpeg_with_goal_dimensions() {
    let png =
        model(br"{\rtf1{\pict\pngblip\picw1\pich1\picwgoal720\pichgoal360 89504e470d0a1a0a}\par}");
    assert_eq!(png.images.len(), 1);
    assert_eq!(png.images[0].format, ImageFormat::Png);
    assert_eq!(png.images[0].width, Some(36.0));
    assert_eq!(png.images[0].height, Some(18.0));
    assert!(matches!(
        paragraphs(&png).next().unwrap().0[0],
        Run::Image { .. }
    ));

    let mut jpeg_input = br"{\rtf1{\pict\jpegblip\picw1\pich1\bin6 ".to_vec();
    jpeg_input.extend_from_slice(&[0xff, 0xd8, b'{', b'}', 0xff, 0xd9]);
    jpeg_input.extend_from_slice(br"}after\par}");
    let jpeg = model(&jpeg_input);
    assert_eq!(
        jpeg.images[0].data,
        vec![0xff, 0xd8, b'{', b'}', 0xff, 0xd9]
    );
    assert_eq!(all_text(&jpeg), "after");
}

#[test]
fn non_shape_picture_fallback_is_not_duplicated() {
    let document = model(br"{\rtf1{\*\shppict{\pict\pngblip 89504e470d0a1a0a}}{\nonshppict{\pict\pngblip 89504e470d0a1a0a}}\par}");
    assert_eq!(document.images.len(), 1);
}

#[test]
fn nested_picture_is_skipped_without_losing_outer_parser_state() {
    let document =
        model(br"{\rtf1{\pict\pngblip 89504e47{\pict\jpegblip ffd8ffd9}0d0a1a0a}after\par}");
    assert_eq!(document.images.len(), 1);
    assert_eq!(document.images[0].format, ImageFormat::Png);
    assert_eq!(all_text(&document), "after");
    assert!(
        document
            .diagnostics
            .iter()
            .any(|d| d.code == "nested-picture")
    );
}

fn markers(model: &rtf_parser::DocumentModel) -> Vec<String> {
    model
        .blocks
        .iter()
        .filter_map(|block| match block {
            Block::Paragraph { list_marker, .. } => {
                list_marker.as_ref().map(|marker| marker.text.clone())
            }
            _ => None,
        })
        .collect()
}

/// One list, one level, with the level's number format and template supplied by the caller.
fn numbered(nfc: i32, template: &str, numbers: &str, items: usize) -> rtf_parser::DocumentModel {
    let body: String = (0..items).map(|_| "\\ls1\\ilvl0 x\\par ").collect();
    model(
        format!(
            "{{\\rtf1{{\\*\\listtable{{\\list{{\\listlevel\\levelnfc{nfc}\\levelstartat1{{\\leveltext {template};}}{{\\levelnumbers{numbers};}}}}\\listid1}}}}{{\\*\\listoverridetable{{\\listoverride\\listid1\\ls1}}}}{body}}}"
        )
        .as_bytes(),
    )
}

#[test]
fn list_number_formats_render_their_own_sequences() {
    // \'02 is the template length, \'00 the placeholder for level 0, then a literal full stop.
    assert_eq!(
        markers(&numbered(0, r"\'02\'00.", r"\'01", 3)),
        ["1.", "2.", "3."]
    );
    assert_eq!(
        markers(&numbered(1, r"\'02\'00.", r"\'01", 4)),
        ["I.", "II.", "III.", "IV."]
    );
    assert_eq!(
        markers(&numbered(2, r"\'02\'00.", r"\'01", 4)),
        ["i.", "ii.", "iii.", "iv."]
    );
    assert_eq!(
        markers(&numbered(3, r"\'02\'00.", r"\'01", 2)),
        ["A.", "B."]
    );
    assert_eq!(
        markers(&numbered(4, r"\'02\'00.", r"\'01", 2)),
        ["a.", "b."]
    );
    assert_eq!(
        markers(&numbered(22, r"\'02\'00.", r"\'01", 2)),
        ["01.", "02."]
    );
    // A bullet level has no placeholder, so its template is literal text.
    assert_eq!(
        markers(&numbered(23, r"\'01\u8226 ?", "", 2)),
        ["\u{2022}", "\u{2022}"]
    );
}

#[test]
fn unsupported_number_formats_fall_back_to_arabic_with_a_diagnostic() {
    let document = numbered(45, r"\'02\'00.", r"\'01", 2);
    assert_eq!(markers(&document), ["1.", "2."]);
    assert!(
        document
            .diagnostics
            .iter()
            .any(|d| d.code == "unsupported-list-number-format")
    );
}

#[test]
fn nested_levels_restart_when_a_shallower_level_advances() {
    let document = model(
        br"{\rtf1{\*\listtable{\list
{\listlevel\levelnfc0\levelstartat1{\leveltext \'02\'00.;}{\levelnumbers\'01;}}
{\listlevel\levelnfc0\levelstartat1{\leveltext \'04\'00.\'01.;}{\levelnumbers\'01\'03;}}
\listid1}}{\*\listoverridetable{\listoverride\listid1\ls1}}
\ls1\ilvl0 a\par \ls1\ilvl1 b\par \ls1\ilvl1 c\par \ls1\ilvl0 d\par \ls1\ilvl1 e\par}",
    );
    // The second level's template names both counters, and it restarts under each parent.
    assert_eq!(markers(&document), ["1.", "1.1.", "1.2.", "2.", "2.1."]);
}

#[test]
fn an_override_start_value_replaces_the_level_start() {
    let document = model(
        br"{\rtf1{\*\listtable{\list{\listlevel\levelnfc0\levelstartat1
{\leveltext \'02\'00.;}{\levelnumbers\'01;}}\listid1}}
{\*\listoverridetable{\listoverride\listid1\ls1{\lfolevel\levelstartat7}}}
\ls1\ilvl0 a\par \ls1\ilvl0 b\par}",
    );
    assert_eq!(markers(&document), ["7.", "8."]);
}

#[test]
fn a_resolved_marker_replaces_the_cached_list_text() {
    let document = model(
        br"{\rtf1{\*\listtable{\list{\listlevel\levelnfc0\levelstartat1
{\leveltext \'02\'00.;}{\levelnumbers\'01;}}\listid1}}
{\*\listoverridetable{\listoverride\listid1\ls1}}
{\listtext 9.\tab}\ls1\ilvl0 item\par}",
    );
    assert_eq!(markers(&document), ["1."]);
    // The writer's cached " 9." is dropped so the marker is not drawn twice.
    assert_eq!(all_text(&document), "item");
}

#[test]
fn unresolvable_list_references_are_reported_and_keep_the_cached_text() {
    let document = model(br"{\rtf1{\listtext 5.\tab}\ls9\ilvl0 item\par}");
    assert!(markers(&document).is_empty());
    assert_eq!(all_text(&document), "5.\titem");
    assert!(
        document
            .diagnostics
            .iter()
            .any(|d| d.code == "unresolved-list-reference")
    );
}

#[test]
fn a_level_beyond_the_definition_uses_the_last_declared_level() {
    let document = model(
        br"{\rtf1{\*\listtable{\list{\listlevel\levelnfc0\levelstartat1
{\leveltext \'02\'00.;}{\levelnumbers\'01;}}\listid1}}
{\*\listoverridetable{\listoverride\listid1\ls1}}\ls1\ilvl4 item\par}",
    );
    assert_eq!(markers(&document), ["1."]);
    assert!(
        document
            .diagnostics
            .iter()
            .any(|d| d.code == "unsupported-list-level")
    );
}

#[test]
fn list_compatibility_text_is_kept_and_definition_text_is_hidden() {
    let document = model(
        br"{\rtf1{\*\listtable{\list hidden}}{\listtext\pard\plain\bullet\tab}\ls1 item\par}",
    );
    // The definition text stays out of the body and the cached marker is kept, because this
    // document declares no level for the paragraph's \\ls to resolve against.
    assert_eq!(all_text(&document), "•\titem");
    assert!(
        document
            .diagnostics
            .iter()
            .any(|d| d.code == "unresolved-list-reference")
    );
}

fn rows(model: &rtf_parser::DocumentModel) -> Vec<&[rtf_parser::TableCell]> {
    model
        .blocks
        .iter()
        .filter_map(|block| match block {
            Block::Row { cells, .. } => Some(cells.as_slice()),
            _ => None,
        })
        .collect()
}

fn cell_text(cell: &rtf_parser::TableCell) -> String {
    cell.blocks
        .iter()
        .filter_map(|block| match block {
            Block::Paragraph { runs, .. } => Some(paragraph_text(runs)),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn table_rows_resolve_cell_boundaries_and_content() {
    let document = model(br"{\rtf1\trowd\cellx1440\cellx2880\intbl a\cell b\cell\row after\par}");
    let rows = rows(&document);
    assert_eq!(rows.len(), 1);
    let cells = rows[0];
    assert_eq!(cells.len(), 2);
    assert_eq!(
        cells.iter().map(|c| c.right).collect::<Vec<_>>(),
        [72.0, 144.0]
    );
    assert_eq!(cell_text(&cells[0]), "a");
    assert_eq!(cell_text(&cells[1]), "b");
    // Content after \row leaves the table and returns to the body.
    assert_eq!(all_text(&document), "after");
    let Block::Row {
        left,
        height,
        align,
        ..
    } = &document.blocks[0]
    else {
        panic!("first block should be a row");
    };
    assert_eq!(*left, 0.0);
    assert_eq!(*height, rtf_parser::RowHeight::Auto);
    assert_eq!(*align, rtf_parser::RowAlign::Left);
}

#[test]
fn table_rows_keep_multiple_paragraphs_per_cell() {
    let document = model(br"{\rtf1\trowd\cellx1440\intbl one\par two\cell\row}");
    let rows = rows(&document);
    assert_eq!(cell_text(&rows[0][0]), "one\ntwo");
    assert_eq!(rows[0][0].blocks.len(), 2);
}

#[test]
fn row_geometry_uses_left_offset_gap_height_and_alignment() {
    let document =
        model(br"{\rtf1\trowd\trqc\trleft720\trgaph120\trrh-400\cellx2160\intbl x\cell\row}");
    let Block::Row {
        cells,
        left,
        height,
        align,
    } = &document.blocks[0]
    else {
        panic!("expected a row");
    };
    assert_eq!(*left, 36.0);
    assert_eq!(*height, rtf_parser::RowHeight::Exact(20.0));
    assert_eq!(*align, rtf_parser::RowAlign::Center);
    // \trgaph is the default horizontal padding when no explicit padding is declared.
    assert_eq!(cells[0].padding.left, 6.0);
    assert_eq!(cells[0].padding.right, 6.0);
    assert_eq!(cells[0].padding.top, 0.0);

    let at_least = model(br"{\rtf1\trowd\trrh400\cellx2160\intbl x\cell\row}");
    let Block::Row { height, .. } = &at_least.blocks[0] else {
        panic!("expected a row");
    };
    assert_eq!(*height, rtf_parser::RowHeight::AtLeast(20.0));
}

#[test]
fn cell_padding_prefers_cell_then_row_then_gap() {
    let document = model(
        br"{\rtf1\trowd\trgaph100\trpaddfl3\trpaddl200\trpaddft3\trpaddt80
\clpadfl3\clpadl60\cellx1440\cellx2880\intbl a\cell b\cell\row}",
    );
    let Block::Row { cells, .. } = &document.blocks[0] else {
        panic!("expected a row");
    };
    assert_eq!(cells[0].padding.left, 3.0); // \clpadl60 wins over the row value
    assert_eq!(cells[1].padding.left, 10.0); // \trpaddl200 wins over \trgaph
    assert_eq!(cells[0].padding.top, 4.0);
    assert_eq!(cells[0].padding.right, 5.0); // no cell or row value, so \trgaph100
}

#[test]
fn cell_padding_in_a_non_twip_unit_is_rejected_with_a_diagnostic() {
    let document = model(br"{\rtf1\trowd\clpadfl0\clpadl600\trgaph100\cellx1440\intbl a\cell\row}");
    let Block::Row { cells, .. } = &document.blocks[0] else {
        panic!("expected a row");
    };
    assert_eq!(cells[0].padding.left, 5.0);
    assert!(
        document
            .diagnostics
            .iter()
            .any(|d| d.code == "unsupported-table-padding-unit")
    );
}

#[test]
fn cell_borders_resolve_style_width_colour_and_row_fallbacks() {
    use rtf_parser::BorderStyle;
    let document = model(
        br"{\rtf1{\colortbl;\red255\green0\blue0;}\trowd
\trbrdrt\brdrs\brdrw20\trbrdrl\brdrs\brdrw20\trbrdrb\brdrs\brdrw20\trbrdrr\brdrs\brdrw20
\trbrdrv\brdrdot\brdrw10
\clbrdrt\brdrdb\brdrw40\brdrcf1\clbrdrl\brdrnone\cellx1440\cellx2880\intbl a\cell b\cell\row}",
    );
    let Block::Row { cells, .. } = &document.blocks[0] else {
        panic!("expected a row");
    };
    let top = cells[0].borders.top.expect("explicit cell top border");
    assert_eq!(top.width, 2.0);
    assert_eq!(top.style, BorderStyle::Double);
    assert_eq!(top.color, Some(1));
    // \brdrnone suppresses the row-level fallback for that side.
    assert!(cells[0].borders.left.is_none());
    // The outer right edge falls back to the row border, the inner one to \trbrdrv.
    assert_eq!(cells[1].borders.right.expect("row right border").width, 1.0);
    let inner = cells[0].borders.right.expect("inner vertical border");
    assert_eq!(inner.style, BorderStyle::Dotted);
    assert_eq!(inner.width, 0.5);
    // Row bottom applies to every cell in the row.
    assert_eq!(cells[1].borders.bottom.expect("row bottom").width, 1.0);
}

#[test]
fn border_widths_are_clamped_to_a_drawable_range() {
    let document = model(
        br"{\rtf1\trowd\clbrdrt\brdrs\brdrw1\clbrdrb\brdrs\brdrw100000\cellx1440\intbl a\cell\row}",
    );
    let Block::Row { cells, .. } = &document.blocks[0] else {
        panic!("expected a row");
    };
    assert_eq!(cells[0].borders.top.expect("top").width, 0.25);
    assert_eq!(cells[0].borders.bottom.expect("bottom").width, 12.0);
}

#[test]
fn malformed_table_rows_preserve_content_without_geometry() {
    // No \cellx at all: the cells become ordinary paragraphs.
    let missing = model(br"{\rtf1\trowd\intbl a\cell b\cell\row after\par}");
    assert!(rows(&missing).is_empty());
    assert_eq!(all_text(&missing), "a\nb\nafter");
    assert!(
        missing
            .diagnostics
            .iter()
            .any(|d| d.code == "invalid-table-definition")
    );

    // A boundary that does not advance merges its content into the previous cell.
    let shrinking =
        model(br"{\rtf1\trowd\cellx1440\cellx1440\cellx2880\intbl a\cell b\cell c\cell\row}");
    let merged = rows(&shrinking);
    assert_eq!(merged[0].len(), 2);
    assert_eq!(cell_text(&merged[0][0]), "a\nb");
    assert_eq!(cell_text(&merged[0][1]), "c");
    assert!(
        shrinking
            .diagnostics
            .iter()
            .any(|d| d.code == "invalid-table-definition")
    );

    // A row that never closes still yields its content in reading order.
    let unterminated = model(br"{\rtf1\trowd\cellx1440\intbl a\cell b\cell}");
    assert!(rows(&unterminated).is_empty());
    assert_eq!(all_text(&unterminated), "a\nb");
    assert!(
        unterminated
            .diagnostics
            .iter()
            .any(|d| d.code == "incomplete-table-row")
    );
}

#[test]
fn more_cells_than_boundaries_merge_into_the_last_cell() {
    let document = model(br"{\rtf1\trowd\cellx1440\intbl a\cell b\cell c\cell\row}");
    let rows = rows(&document);
    assert_eq!(rows[0].len(), 1);
    assert_eq!(cell_text(&rows[0][0]), "a\nb\nc");
}

#[test]
fn fewer_cells_than_boundaries_keep_the_declared_empty_cells() {
    let document = model(br"{\rtf1\trowd\cellx1440\cellx2880\intbl a\cell\row}");
    let rows = rows(&document);
    assert_eq!(rows[0].len(), 2);
    assert_eq!(cell_text(&rows[0][1]), "");
    assert!(rows[0][1].blocks.is_empty());
}

#[test]
fn unsupported_table_features_are_diagnosed_without_silent_downgrade() {
    let document = model(
        br"{\rtf1\trowd\trhdr\trkeep\clbghoriz\clvmgf\cellx1440\intbl\itap2 a\cell\row
{\rtf1}\nestcell\nestrow}",
    );
    let codes: Vec<&str> = document
        .diagnostics
        .iter()
        .map(|d| d.code.as_str())
        .collect();
    for expected in [
        "unsupported-table-header-row",
        "unsupported-table-keep",
        "approximated-table-cell-pattern",
        "unsupported-vertical-cell-merge",
        "unsupported-nested-table",
    ] {
        assert!(codes.contains(&expected), "missing {expected} in {codes:?}");
    }
}

#[test]
fn cells_resolve_vertical_alignment_and_shading() {
    use rtf_parser::{CellShading, VerticalAlign};
    let document = model(
        br"{\rtf1{\colortbl;\red255\green0\blue0;\red0\green0\blue255;}\trowd
\trcbpat2\clvertalc\clcbpat1\clcfpat2\clshdng2500\cellx1440
\clvertalb\cellx2880
\cellx4320
\intbl a\cell b\cell c\cell\row}",
    );
    let Block::Row { cells, .. } = &document.blocks[0] else {
        panic!("expected a row");
    };
    assert_eq!(cells[0].vertical_align, Some(VerticalAlign::Center));
    assert_eq!(
        cells[0].shading,
        Some(CellShading {
            background: Some(1),
            foreground: Some(2),
            intensity: Some(2500),
        })
    );
    // A cell that declares nothing inherits the row's shading.
    assert_eq!(cells[1].vertical_align, Some(VerticalAlign::Bottom));
    assert_eq!(
        cells[1].shading,
        Some(CellShading {
            background: Some(2),
            foreground: None,
            intensity: None,
        })
    );
    // Alignment is not inherited from the previous cell; absent means the default, top.
    assert_eq!(cells[2].vertical_align, None);
}

#[test]
fn shading_intensity_is_clamped_and_unshaded_cells_stay_empty() {
    let document = model(
        br"{\rtf1\trowd\clshdng99999\cellx1440\clshdng-5\cellx2880\cellx4320
\intbl a\cell b\cell c\cell\row}",
    );
    let Block::Row { cells, .. } = &document.blocks[0] else {
        panic!("expected a row");
    };
    assert_eq!(cells[0].shading.expect("first").intensity, Some(10_000));
    assert_eq!(cells[1].shading.expect("second").intensity, Some(0));
    assert_eq!(cells[2].shading, None);
}

#[test]
fn horizontally_merged_cells_become_one_wider_cell() {
    let document = model(
        br"{\rtf1\trowd\clmgf\clbrdrr\brdrs\brdrw20\clpadfl3\clpadl120\clvertalb\cellx1440
\clmrg\clbrdrr\brdrs\brdrw40\cellx2880\clmrg\clbrdrr\brdrs\brdrw60\cellx4320\cellx5760
\intbl head\cell more\cell tail\cell last\cell\row}",
    );
    let Block::Row { cells, .. } = &document.blocks[0] else {
        panic!("expected a row");
    };
    assert_eq!(cells.len(), 2);
    // Three definitions collapse into one cell that reaches the last boundary.
    assert_eq!(cells[0].right, 216.0);
    assert_eq!(cells[1].right, 288.0);
    // Content of every merged-away cell is kept, in reading order.
    assert_eq!(cell_text(&cells[0]), "head\nmore\ntail");
    assert_eq!(cell_text(&cells[1]), "last");
    // Properties come from the first cell of the range.
    assert_eq!(cells[0].padding.left, 6.0);
    assert_eq!(
        cells[0].vertical_align,
        Some(rtf_parser::VerticalAlign::Bottom)
    );
    // The right border comes from the definition that owns the final boundary, not from an
    // intermediate one.
    assert_eq!(cells[0].borders.right.expect("right border").width, 3.0);
    assert!(
        !document
            .diagnostics
            .iter()
            .any(|d| d.code == "invalid-table-merge")
    );
}

#[test]
fn a_leading_merge_continuation_is_reported_and_kept() {
    let document = model(br"{\rtf1\trowd\clmrg\cellx1440\cellx2880\intbl a\cell b\cell\row}");
    let Block::Row { cells, .. } = &document.blocks[0] else {
        panic!("expected a row");
    };
    assert_eq!(cells.len(), 2);
    assert_eq!(cell_text(&cells[0]), "a");
    assert!(
        document
            .diagnostics
            .iter()
            .any(|d| d.code == "invalid-table-merge")
    );
}

#[test]
fn vertical_merges_keep_their_own_diagnostic() {
    let document = model(br"{\rtf1\trowd\clvmgf\cellx1440\cellx2880\intbl a\cell b\cell\row}");
    let Block::Row { cells, .. } = &document.blocks[0] else {
        panic!("expected a row");
    };
    assert_eq!(cells.len(), 2);
    let codes: Vec<&str> = document
        .diagnostics
        .iter()
        .map(|d| d.code.as_str())
        .collect();
    assert!(
        codes.contains(&"unsupported-vertical-cell-merge"),
        "{codes:?}"
    );
}

#[test]
fn table_definitions_written_after_the_cells_still_apply() {
    // Some writers emit the row definition between the last \cell and \row.
    let document = model(br"{\rtf1\intbl a\cell b\cell\trowd\cellx1440\cellx2880\row}");
    let rows = rows(&document);
    assert_eq!(rows[0].len(), 2);
    assert_eq!(cell_text(&rows[0][0]), "a");
    assert_eq!(cell_text(&rows[0][1]), "b");
}

#[test]
fn malformed_binary_and_groups_fail_predictably() {
    assert!(matches!(
        parse(br"{\rtf1{\pict\bin9 abc}}"),
        Err(rtf_parser::ParseError::TruncatedBinary { .. })
    ));
    assert_eq!(
        parse(br"{\rtf1").unwrap_err(),
        rtf_parser::ParseError::UnterminatedGroup
    );
    assert!(matches!(
        parse(br"{\rtf1}}"),
        Err(rtf_parser::ParseError::UnexpectedGroupEnd(_))
    ));
}

/// Build an EMF holding one EMR_STRETCHDIBITS record around the supplied DIB.
fn emf_with_dib(info: &[u8], bits: &[u8]) -> Vec<u8> {
    let header_size = 88u32;
    let record_header = 80u32;
    let record_size = record_header + info.len() as u32 + bits.len() as u32;
    let mut emf = Vec::new();
    // EMR_HEADER: type, size, then padding up to the declared header size.
    emf.extend_from_slice(&1u32.to_le_bytes());
    emf.extend_from_slice(&header_size.to_le_bytes());
    emf.resize(header_size as usize, 0);
    emf.extend_from_slice(&81u32.to_le_bytes());
    emf.extend_from_slice(&record_size.to_le_bytes());
    // offBmiSrc, cbBmiSrc, offBitsSrc and cbBitsSrc sit at offset 48 in EMR_STRETCHDIBITS.
    emf.resize(header_size as usize + 48, 0);
    emf.extend_from_slice(&record_header.to_le_bytes());
    emf.extend_from_slice(&(info.len() as u32).to_le_bytes());
    emf.extend_from_slice(&(record_header + info.len() as u32).to_le_bytes());
    emf.extend_from_slice(&(bits.len() as u32).to_le_bytes());
    // The bitmap buffer starts at the end of the record's fixed fields.
    emf.resize(header_size as usize + record_header as usize, 0);
    emf.extend_from_slice(info);
    emf.extend_from_slice(bits);
    emf
}

fn bitmap_info(width: i32, height: i32, bits_per_pixel: u16, compression: u32) -> Vec<u8> {
    let mut info = Vec::new();
    info.extend_from_slice(&40u32.to_le_bytes());
    info.extend_from_slice(&width.to_le_bytes());
    info.extend_from_slice(&height.to_le_bytes());
    info.extend_from_slice(&1u16.to_le_bytes());
    info.extend_from_slice(&bits_per_pixel.to_le_bytes());
    info.extend_from_slice(&compression.to_le_bytes());
    info.resize(40, 0);
    info
}

fn document_with_metafile(metafile: &[u8]) -> rtf_parser::DocumentModel {
    let hex: String = metafile.iter().map(|byte| format!("{byte:02x}")).collect();
    model(
        format!("{{\\rtf1{{\\pict\\emfblip\\picw10\\pich10\\picwgoal720\\pichgoal720 {hex}}}}}")
            .as_bytes(),
    )
}

fn raster_of(document: &rtf_parser::DocumentModel) -> Option<&rtf_parser::RasterBitmap> {
    document.images.first()?.raster.as_ref()
}

#[test]
fn a_metafile_blit_is_decoded_into_a_drawable_bitmap() {
    // Two by two, 24 bit, bottom-up, with each row padded to a four-byte boundary.
    let info = bitmap_info(2, 2, 24, 0);
    let bits = vec![
        0x00, 0x00, 0xff, 0x00, 0xff, 0x00, 0x00, 0x00, // bottom row: red, green
        0xff, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, // top row: blue, white
    ];
    let document = document_with_metafile(&emf_with_dib(&info, &bits));
    let raster = raster_of(&document).expect("the blit should decode");
    assert_eq!((raster.width, raster.height), (2, 2));
    // Rows come back top first, and each pixel is RGBA with blue-first source order undone.
    assert_eq!(
        raster.data,
        vec![
            0, 0, 255, 255, 255, 255, 255, 255, // top row
            255, 0, 0, 255, 0, 255, 0, 255, // bottom row
        ]
    );
    assert!(
        document
            .diagnostics
            .iter()
            .any(|d| d.code == "approximated-metafile-bitmap")
    );
}

#[test]
fn a_top_down_and_palette_blit_decode_the_same_way() {
    // Negative height means the rows are already stored top first.
    let info = bitmap_info(2, -1, 24, 0);
    let bits = vec![0x00, 0x00, 0xff, 0x00, 0xff, 0x00, 0x00, 0x00];
    let document = document_with_metafile(&emf_with_dib(&info, &bits));
    let raster = raster_of(&document).expect("the blit should decode");
    assert_eq!(raster.data, vec![255, 0, 0, 255, 0, 255, 0, 255]);

    // Eight bit indices resolve through the palette, which is stored blue first.
    let mut palette_info = bitmap_info(2, -1, 8, 0);
    palette_info.extend_from_slice(&[0x10, 0x20, 0x30, 0x00, 0x40, 0x50, 0x60, 0x00]);
    for _ in 2..256 {
        palette_info.extend_from_slice(&[0, 0, 0, 0]);
    }
    let document = document_with_metafile(&emf_with_dib(&palette_info, &[1, 0, 0, 0]));
    let raster = raster_of(&document).expect("the palette blit should decode");
    assert_eq!(
        raster.data,
        vec![0x60, 0x50, 0x40, 255, 0x30, 0x20, 0x10, 255]
    );
}

#[test]
fn undecodable_metafiles_keep_the_placeholder_and_say_why() {
    // A compressed DIB is rejected rather than guessed at.
    let compressed = document_with_metafile(&emf_with_dib(&bitmap_info(2, 2, 8, 1), &[0; 64]));
    assert!(raster_of(&compressed).is_none());
    assert!(
        compressed
            .diagnostics
            .iter()
            .any(|d| d.code == "unsupported-vector-image")
    );

    // A metafile with no blit at all keeps its bytes and its placeholder.
    let mut empty = Vec::new();
    empty.extend_from_slice(&1u32.to_le_bytes());
    empty.extend_from_slice(&88u32.to_le_bytes());
    empty.resize(88, 0);
    let bare = document_with_metafile(&empty);
    assert!(raster_of(&bare).is_none());
    assert_eq!(bare.images[0].format, ImageFormat::Emf);
    assert!(!bare.images[0].data.is_empty());
}

#[test]
fn an_oversized_metafile_bitmap_is_refused_rather_than_allocated() {
    // The header claims far more pixels than the record could possibly carry.
    let document =
        document_with_metafile(&emf_with_dib(&bitmap_info(30_000, 30_000, 24, 0), &[0; 16]));
    assert!(raster_of(&document).is_none());
    assert!(
        document
            .diagnostics
            .iter()
            .any(|d| d.code == "unsupported-vector-image")
    );
}

#[test]
fn a_blit_whose_offsets_do_not_fit_is_refused_rather_than_overflowing() {
    // offBitsSrc and cbBitsSrc that sum past u32 must fail the lookup, not the addition.
    let mut emf = Vec::new();
    emf.extend_from_slice(&1u32.to_le_bytes());
    emf.extend_from_slice(&88u32.to_le_bytes());
    emf.resize(88, 0);
    emf.extend_from_slice(&81u32.to_le_bytes());
    emf.extend_from_slice(&120u32.to_le_bytes());
    emf.resize(88 + 48, 0);
    for value in [u32::MAX, 64u32, u32::MAX - 8, 64u32] {
        emf.extend_from_slice(&value.to_le_bytes());
    }
    emf.resize(88 + 120, 0);
    let document = document_with_metafile(&emf);
    assert!(raster_of(&document).is_none());
    assert!(
        document
            .diagnostics
            .iter()
            .any(|d| d.code == "unsupported-vector-image")
    );
}

#[test]
fn arbitrary_bounded_byte_streams_never_panic() {
    let mut seed = 0x9e37_79b9_u32;
    for _ in 0..256 {
        let mut input = br"{\rtf1 ".to_vec();
        for _ in 0..512 {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            input.push(seed as u8);
        }
        input.push(b'}');
        let result = std::panic::catch_unwind(|| parse(&input));
        assert!(result.is_ok(), "parser panicked for seed state {seed:#x}");
    }
}

#[test]
fn json_contract_uses_camel_case_variant_fields() {
    let document = model(br"{\rtf1 text\par}");
    let json = serde_json::to_value(document).unwrap();
    let paragraph = &json["blocks"][0];
    assert!(paragraph.get("markStyle").is_some());
    assert!(paragraph.get("mark_style").is_none());
}

#[test]
fn pathological_character_values_are_bounded_and_diagnosed() {
    let document = model(br"{\rtf1\fs2147483647 huge\up-2147483648 shifted\par}");
    let (runs, _) = paragraphs(&document).next().unwrap();
    let styles: Vec<_> = runs
        .iter()
        .filter_map(|run| match run {
            Run::Text { style, .. } => Some((style.font_size, style.baseline)),
            _ => None,
        })
        .collect();
    assert_eq!(styles[0].0, 2048.0);
    assert_eq!(styles[1].1, -2048.0);
    assert!(
        document
            .diagnostics
            .iter()
            .any(|d| d.code == "character-value-out-of-range")
    );
}

#[test]
fn unsupported_text_directions_are_diagnosed() {
    let document = model(br"{\rtf1\rtlpar\rtlch text\par}");
    assert_eq!(all_text(&document), "text");
    assert!(
        document
            .diagnostics
            .iter()
            .any(|d| d.code == "unsupported-bidirectional-text")
    );
}

#[test]
fn overlong_control_name_is_bounded_and_can_lock_a_starred_destination() {
    let long_name = "a".repeat(4096);
    let input = format!("{{\\rtf1 before{{\\*\\{long_name} SECRET{{\\fldrslt leak}}}}after\\par}}");
    let document = model(input.as_bytes());
    assert_eq!(all_text(&document), "beforeafter");
    assert!(
        document
            .diagnostics
            .iter()
            .any(|d| d.code == "control-name-too-long")
    );
    assert!(document.diagnostics.iter().all(|d| d.message.len() < 256));
}

#[test]
fn enforces_one_root_header_and_rejects_trailing_documents() {
    for input in [
        br"\rtf1 text".as_slice(),
        br"{text\rtf1}",
        br"{\rtf2\rtf1}",
        br"{\rtf1}garbage",
        br"{\rtf1}{\rtf1}",
    ] {
        assert_eq!(
            parse(input).unwrap_err(),
            rtf_parser::ParseError::InvalidHeader
        );
    }
    assert!(parse(b"{\\rtf1 text}\r\n ").is_ok());
}

#[test]
fn enforces_input_nesting_token_and_block_budgets() {
    use rtf_parser::ParseError;
    assert_eq!(
        parse(&vec![b' '; 16 * 1024 * 1024 + 1]).unwrap_err(),
        ParseError::InputTooLarge
    );
    let nested = format!("{{\\rtf1 {}text{}}}", "{".repeat(256), "}".repeat(256));
    assert!(matches!(
        parse(nested.as_bytes()),
        Err(ParseError::NestingLimit(_))
    ));
    let tokens = format!("{{\\rtf1 {}}}", "a".repeat(2_000_000));
    assert_eq!(
        parse(tokens.as_bytes()).unwrap_err(),
        ParseError::TokenLimit
    );
    let paragraphs = format!("{{\\rtf1 {}}}", r"\par ".repeat(100_001));
    assert_eq!(
        parse(paragraphs.as_bytes()).unwrap_err(),
        ParseError::ParagraphLimit
    );
    let pages = format!("{{\\rtf1 {}}}", r"\page ".repeat(100_001));
    assert_eq!(
        parse(pages.as_bytes()).unwrap_err(),
        ParseError::ParagraphLimit
    );
}

#[test]
fn enforces_image_byte_and_count_budgets() {
    use rtf_parser::ParseError;
    let count = format!("{{\\rtf1 {}}}", r"{\pict\pngblip 00}".repeat(257));
    assert_eq!(parse(count.as_bytes()).unwrap_err(), ParseError::ImageLimit);
    let mut bytes = format!("{{\\rtf1{{\\pict\\pngblip\\bin{} ", 8 * 1024 * 1024 + 1).into_bytes();
    bytes.resize(bytes.len() + 8 * 1024 * 1024 + 1, b'x');
    bytes.extend_from_slice(b"}}");
    assert!(matches!(parse(&bytes), Err(ParseError::ImageByteLimit(_))));
    assert!(matches!(
        parse(br"{\rtf1\bin-1 x}"),
        Err(ParseError::NegativeBinaryLength(_))
    ));
}
