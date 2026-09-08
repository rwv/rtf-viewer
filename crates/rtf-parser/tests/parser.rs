use pretty_assertions::assert_eq;
use rtf_parser::{Block, ImageFormat, LineSpacing, ParagraphAlign, Run, parse};

fn model(input: &[u8]) -> rtf_parser::DocumentModel {
    parse(input).expect("fixture should parse")
}

fn paragraphs(
    model: &rtf_parser::DocumentModel,
) -> impl Iterator<Item = (&[Run], &rtf_parser::ParagraphStyle)> {
    model.blocks.iter().filter_map(|block| match block {
        Block::Paragraph { runs, style, .. } => Some((runs.as_slice(), style)),
        Block::PageBreak => None,
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

#[test]
fn list_compatibility_text_is_kept_and_definition_text_is_hidden() {
    let document = model(
        br"{\rtf1{\*\listtable{\list hidden}}{\listtext\pard\plain\bullet\tab}\ls1 item\par}",
    );
    assert_eq!(all_text(&document), "•\titem");
    assert!(
        document
            .diagnostics
            .iter()
            .any(|d| d.code == "unsupported-list-semantics")
    );
}

#[test]
fn table_controls_flatten_to_stable_separators() {
    let document = model(br"{\rtf1\trowd\intbl a\cell b\cell\row after\par}");
    assert_eq!(all_text(&document), "a\tb\nafter");
    assert!(
        document
            .diagnostics
            .iter()
            .any(|d| d.code == "unsupported-table")
    );
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
