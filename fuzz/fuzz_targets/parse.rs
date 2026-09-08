#![no_main]

use libfuzzer_sys::fuzz_target;

// The parser caps input size, nesting, tokens, text, paragraphs and images itself, so any
// panic, hang or non-finite geometry reaching this target is a defect rather than the fuzzer
// simply asking for too much. Seed the corpus from fixtures/synthetic and fixtures/real.
fuzz_target!(|data: &[u8]| {
    if let Ok(document) = rtf_parser::parse(data) {
        for value in [
            document.page.width,
            document.page.height,
            document.page.margin_left,
            document.page.margin_right,
            document.page.margin_top,
            document.page.margin_bottom,
            document.default_tab,
        ] {
            assert!(value.is_finite(), "page geometry must stay finite");
        }
        for block in &document.blocks {
            if let rtf_parser::Block::Row { cells, left, .. } = block {
                assert!(left.is_finite(), "row offset must stay finite");
                for cell in cells {
                    assert!(cell.right.is_finite(), "cell boundary must stay finite");
                }
            }
        }
    }
});
