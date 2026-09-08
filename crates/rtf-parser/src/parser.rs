use crate::model::{
    Block, Border, BorderStyle, CellBorders, CellShading, Diagnostic, DocumentModel, FontDef,
    ImageFormat, ImageResource, LineSpacing, Padding, PageGeometry, ParagraphAlign, ParagraphStyle,
    RowAlign, RowHeight, Run, TableCell, TextStyle, VerticalAlign,
};
use encoding_rs::Encoding;
use std::collections::HashSet;
use thiserror::Error;

const MAX_INPUT_BYTES: usize = 16 * 1024 * 1024;
const MAX_NESTING: usize = 256;
const MAX_TOKENS: usize = 2_000_000;
const MAX_TEXT_UNITS: usize = 2_000_000;
const MAX_PARAGRAPHS: usize = 100_000;
const MAX_IMAGES: usize = 256;
const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_DIAGNOSTICS: usize = 512;
const MAX_CELLS_PER_ROW: usize = 256;
const MAX_BORDER_WIDTH: f64 = 12.0;
const MIN_BORDER_WIDTH: f64 = 0.25;
const DEFAULT_BORDER_WIDTH: f64 = 0.5;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ParseError {
    #[error("RTF input exceeds 16 MiB")]
    InputTooLarge,
    #[error("RTF nesting exceeds 256 groups at byte {0}")]
    NestingLimit(usize),
    #[error("RTF token count exceeds 2,000,000")]
    TokenLimit,
    #[error("decoded text exceeds 2,000,000 UTF-16 units")]
    TextLimit,
    #[error("document exceeds 100,000 paragraphs")]
    ParagraphLimit,
    #[error("document exceeds 256 embedded images")]
    ImageLimit,
    #[error("embedded image exceeds 8 MiB at byte {0}")]
    ImageByteLimit(usize),
    #[error(
        "truncated binary payload at byte {offset}: expected {expected} bytes, found {remaining}"
    )]
    TruncatedBinary {
        offset: usize,
        expected: usize,
        remaining: usize,
    },
    #[error("negative binary length at byte {0}")]
    NegativeBinaryLength(usize),
    #[error("unexpected closing brace at byte {0}")]
    UnexpectedGroupEnd(usize),
    #[error("unterminated RTF group")]
    UnterminatedGroup,
    #[error("input is not an RTF 1 document")]
    InvalidHeader,
    #[error("serialization failed: {0}")]
    Serialization(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Destination {
    Body,
    FontTable,
    ColorTable,
    DefaultCharacter,
    DefaultParagraph,
    Picture,
    PictureContainer,
    ListText,
    PnText,
    Suppress,
}

impl Destination {
    fn is_visible(self) -> bool {
        matches!(self, Self::Body | Self::ListText | Self::PnText)
    }
}

#[derive(Debug, Clone, PartialEq)]
struct ParagraphState {
    align: ParagraphAlign,
    left_indent: f64,
    right_indent: f64,
    first_line_indent: f64,
    space_before: f64,
    space_after: f64,
    line_spacing_twips: i32,
    line_spacing_multiple: bool,
    page_break_before: bool,
    in_table: bool,
}

impl Default for ParagraphState {
    fn default() -> Self {
        Self {
            align: ParagraphAlign::Left,
            left_indent: 0.0,
            right_indent: 0.0,
            first_line_indent: 0.0,
            space_before: 0.0,
            space_after: 0.0,
            line_spacing_twips: 0,
            line_spacing_multiple: false,
            page_break_before: false,
            in_table: false,
        }
    }
}

impl ParagraphState {
    fn to_model(&self) -> ParagraphStyle {
        let line_spacing = if self.line_spacing_twips == 0 {
            LineSpacing::Auto
        } else if self.line_spacing_multiple {
            LineSpacing::Multiple(self.line_spacing_twips as f64 / 240.0)
        } else if self.line_spacing_twips < 0 {
            LineSpacing::Exact(self.line_spacing_twips.unsigned_abs() as f64 / 20.0)
        } else {
            LineSpacing::AtLeast(self.line_spacing_twips as f64 / 20.0)
        };
        ParagraphStyle {
            align: self.align,
            left_indent: self.left_indent,
            right_indent: self.right_indent,
            first_line_indent: self.first_line_indent,
            space_before: self.space_before,
            space_after: self.space_after,
            line_spacing,
            page_break_before: self.page_break_before,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
struct State {
    destination: Destination,
    skip_locked: bool,
    character: TextStyle,
    paragraph: ParagraphState,
    uc: usize,
    allow_pictures: bool,
    in_upr: bool,
    section_page_break: bool,
}

impl Default for State {
    fn default() -> Self {
        Self {
            destination: Destination::Body,
            skip_locked: false,
            character: TextStyle::default(),
            paragraph: ParagraphState::default(),
            uc: 1,
            allow_pictures: true,
            in_upr: false,
            section_page_break: true,
        }
    }
}

#[derive(Debug, Clone)]
struct GroupFlags {
    fresh: bool,
    pending_star: bool,
}

#[derive(Debug, Clone)]
struct ParagraphBuilder {
    runs: Vec<Run>,
    style: ParagraphState,
}

impl ParagraphBuilder {
    fn new(style: ParagraphState) -> Self {
        Self {
            runs: Vec::new(),
            style,
        }
    }
}

#[derive(Debug, Default)]
struct FontBuilder {
    id: Option<i32>,
    charset: Option<i32>,
    codepage: Option<i32>,
    name: Vec<u8>,
    name_units: Vec<u16>,
}

#[derive(Debug, Default)]
struct ColorBuilder {
    red: Option<u8>,
    green: Option<u8>,
    blue: Option<u8>,
}

#[derive(Debug)]
struct PictureBuilder {
    depth: usize,
    start_offset: usize,
    format: ImageFormat,
    data: Vec<u8>,
    pending_nibble: Option<u8>,
    pic_width: Option<i32>,
    pic_height: Option<i32>,
    goal_width: Option<i32>,
    goal_height: Option<i32>,
    scale_x: i32,
    scale_y: i32,
}

impl PictureBuilder {
    fn new(depth: usize, start_offset: usize) -> Self {
        Self {
            depth,
            start_offset,
            format: ImageFormat::Unknown,
            data: Vec::new(),
            pending_nibble: None,
            pic_width: None,
            pic_height: None,
            goal_width: None,
            goal_height: None,
            scale_x: 100,
            scale_y: 100,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Side {
    Top = 0,
    Left = 1,
    Bottom = 2,
    Right = 3,
}

impl Side {
    fn index(self) -> usize {
        self as usize
    }
}

/// `\clpad*` and `\trpadd*` values with their unit selectors, resolved when the row closes.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct PaddingBuilder {
    value: [Option<i32>; 4],
    unit: [Option<i32>; 4],
}

impl PaddingBuilder {
    fn resolve(&self, side: Side) -> Option<f64> {
        let value = self.value[side.index()]?;
        // RTF 1.9.1 defines selector 3 as twips and 0 as "ignore the value". Writers that omit
        // the selector still mean twips, so only an explicit non-twip selector rejects a value.
        match self.unit[side.index()] {
            None | Some(3) => Some(twips(value.max(0))),
            _ => None,
        }
    }

    fn has_rejected_unit(&self) -> bool {
        (0..4).any(|index| {
            self.value[index].is_some() && matches!(self.unit[index], Some(unit) if unit != 3)
        })
    }
}

/// `\clcbpat`, `\clcfpat` and `\clshdng`, kept separate until the row closes so that a cell
/// can fall back to the row's declaration.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct ShadingBuilder {
    background: Option<u32>,
    foreground: Option<u32>,
    intensity: Option<u32>,
}

impl ShadingBuilder {
    fn is_empty(self) -> bool {
        self.background.is_none() && self.foreground.is_none() && self.intensity.is_none()
    }

    fn or(self, fallback: Self) -> Self {
        if self.is_empty() { fallback } else { self }
    }

    fn resolve(self) -> Option<CellShading> {
        (!self.is_empty()).then_some(CellShading {
            background: self.background,
            foreground: self.foreground,
            intensity: self.intensity,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct BorderBuilder {
    present: bool,
    width: Option<i32>,
    color: Option<u32>,
    style: BorderStyle,
    hairline: bool,
}

impl Default for BorderBuilder {
    fn default() -> Self {
        Self {
            present: true,
            width: None,
            color: None,
            style: BorderStyle::Single,
            hairline: false,
        }
    }
}

impl BorderBuilder {
    fn resolve(self) -> Option<Border> {
        if !self.present {
            return None;
        }
        let width = if self.hairline {
            MIN_BORDER_WIDTH
        } else {
            self.width.map_or(DEFAULT_BORDER_WIDTH, twips)
        };
        Some(Border {
            width: width.clamp(MIN_BORDER_WIDTH, MAX_BORDER_WIDTH),
            color: self.color,
            style: self.style,
        })
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct BorderSet([Option<BorderBuilder>; 4]);

impl BorderSet {
    fn entry(&mut self, side: Side) -> &mut Option<BorderBuilder> {
        &mut self.0[side.index()]
    }

    fn get(&self, side: Side) -> Option<BorderBuilder> {
        self.0[side.index()]
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
struct CellDef {
    right_twips: i32,
    padding: PaddingBuilder,
    borders: BorderSet,
    vertical_align: Option<VerticalAlign>,
    shading: ShadingBuilder,
}

/// Where the `\brdr*` properties that follow a border selector are stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BorderTarget {
    Cell(Side),
    RowOuter(Side),
    RowInnerHorizontal,
    RowInnerVertical,
    Ignored,
}

#[derive(Debug, Default)]
struct RowBuilder {
    left_twips: i32,
    gap_twips: i32,
    height_twips: i32,
    align: Option<RowAlign>,
    padding: PaddingBuilder,
    borders: BorderSet,
    shading: ShadingBuilder,
    inner_horizontal: Option<BorderBuilder>,
    inner_vertical: Option<BorderBuilder>,
    target: Option<BorderTarget>,
    defs: Vec<CellDef>,
    pending: CellDef,
    contents: Vec<Vec<Block>>,
    overflowed: bool,
}

pub fn parse(bytes: &[u8]) -> Result<DocumentModel, ParseError> {
    if bytes.len() > MAX_INPUT_BYTES {
        return Err(ParseError::InputTooLarge);
    }
    if !bytes.starts_with(br"{\rtf") {
        return Err(ParseError::InvalidHeader);
    }
    Parser::new(bytes).parse()
}

struct Parser<'a> {
    bytes: &'a [u8],
    position: usize,
    token_count: usize,
    saw_rtf1: bool,
    stack: Vec<(State, GroupFlags)>,
    state: State,
    group: GroupFlags,
    document_codepage: i32,
    default_font: i32,
    default_character: TextStyle,
    default_paragraph: ParagraphState,
    page: PageGeometry,
    explicit_page_width: bool,
    explicit_page_height: bool,
    landscape: bool,
    default_tab: f64,
    fonts: Vec<FontDef>,
    font_builder: Option<FontBuilder>,
    colors: Vec<Option<String>>,
    color_builder: ColorBuilder,
    blocks: Vec<Block>,
    paragraph: ParagraphBuilder,
    images: Vec<ImageResource>,
    picture: Option<PictureBuilder>,
    byte_buffer: Vec<u8>,
    byte_buffer_codepage: Option<i32>,
    unit_buffer: Vec<u16>,
    unit_style: Option<TextStyle>,
    text_units: usize,
    fallback_remaining: usize,
    diagnostics: Vec<Diagnostic>,
    diagnostic_keys: HashSet<(String, String)>,
    row: Option<RowBuilder>,
    cell_blocks: Vec<Block>,
    paragraph_count: usize,
}

impl<'a> Parser<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        let state = State::default();
        Self {
            bytes,
            position: 0,
            token_count: 0,
            saw_rtf1: false,
            stack: Vec::new(),
            state: state.clone(),
            group: GroupFlags {
                fresh: true,
                pending_star: false,
            },
            document_codepage: 1252,
            default_font: 0,
            default_character: TextStyle::default(),
            default_paragraph: ParagraphState::default(),
            page: PageGeometry::default(),
            explicit_page_width: false,
            explicit_page_height: false,
            landscape: false,
            default_tab: 36.0,
            fonts: Vec::new(),
            font_builder: None,
            colors: Vec::new(),
            color_builder: ColorBuilder::default(),
            blocks: Vec::new(),
            paragraph: ParagraphBuilder::new(state.paragraph),
            images: Vec::new(),
            picture: None,
            byte_buffer: Vec::new(),
            byte_buffer_codepage: None,
            unit_buffer: Vec::new(),
            unit_style: None,
            text_units: 0,
            fallback_remaining: 0,
            diagnostics: Vec::new(),
            diagnostic_keys: HashSet::new(),
            row: None,
            cell_blocks: Vec::new(),
            paragraph_count: 0,
        }
    }

    fn parse(mut self) -> Result<DocumentModel, ParseError> {
        while self.position < self.bytes.len() {
            if self.position > 0 && self.stack.is_empty() {
                if self.bytes[self.position].is_ascii_whitespace() {
                    self.position += 1;
                    continue;
                }
                if self.bytes[self.position] == b'}' {
                    return Err(ParseError::UnexpectedGroupEnd(self.position));
                }
                return Err(ParseError::InvalidHeader);
            }
            let offset = self.position;
            match self.bytes[self.position] {
                b'{' => self.open_group(offset)?,
                b'}' => self.close_group(offset)?,
                b'\\' => self.control(offset)?,
                b'\r' | b'\n' => self.position += 1,
                b'\t' => {
                    self.position += 1;
                    self.bump_token()?;
                    if !self.consume_fallback_unit() {
                        self.append_unicode_str("\t")?;
                    }
                    self.group.fresh = false;
                }
                byte => {
                    self.position += 1;
                    self.bump_token()?;
                    if !self.consume_fallback_unit() {
                        self.handle_plain_byte(byte, offset)?;
                    }
                    self.group.fresh = false;
                }
            }
        }
        if !self.stack.is_empty() {
            return Err(ParseError::UnterminatedGroup);
        }
        if !self.saw_rtf1 {
            return Err(ParseError::InvalidHeader);
        }
        self.flush_all_text()?;
        if !self.paragraph.runs.is_empty() {
            self.finish_paragraph(false)?;
        }
        let end = self.bytes.len();
        self.flush_incomplete_row(end)?;
        if self.landscape && !self.explicit_page_width && !self.explicit_page_height {
            std::mem::swap(&mut self.page.width, &mut self.page.height);
        }
        Ok(DocumentModel {
            schema_version: 2,
            page: self.page,
            default_tab: self.default_tab,
            fonts: self.fonts,
            colors: self.colors,
            blocks: self.blocks,
            images: self.images,
            diagnostics: self.diagnostics,
        })
    }

    fn bump_token(&mut self) -> Result<(), ParseError> {
        self.token_count += 1;
        if self.token_count > MAX_TOKENS {
            Err(ParseError::TokenLimit)
        } else {
            Ok(())
        }
    }

    fn open_group(&mut self, offset: usize) -> Result<(), ParseError> {
        self.bump_token()?;
        self.fallback_remaining = 0;
        self.position += 1;
        if self.stack.len() >= MAX_NESTING {
            return Err(ParseError::NestingLimit(offset));
        }
        self.group.fresh = false;
        self.stack.push((self.state.clone(), self.group.clone()));
        self.group = GroupFlags {
            fresh: true,
            pending_star: false,
        };
        Ok(())
    }

    fn close_group(&mut self, offset: usize) -> Result<(), ParseError> {
        self.bump_token()?;
        self.fallback_remaining = 0;
        self.position += 1;
        let Some((parent_state, parent_group)) = self.stack.pop() else {
            return Err(ParseError::UnexpectedGroupEnd(offset));
        };

        if self
            .picture
            .as_ref()
            .is_some_and(|picture| picture.depth == self.stack.len() + 1)
        {
            self.finish_picture()?;
        }

        let output_context_changes = self.state.destination != parent_state.destination
            || self.state.character != parent_state.character
            || self.active_codepage() != self.active_codepage_for(&parent_state);
        if output_context_changes {
            self.flush_all_text()?;
        }
        self.state = parent_state;
        self.group = parent_group;
        Ok(())
    }

    fn control(&mut self, offset: usize) -> Result<(), ParseError> {
        self.bump_token()?;
        self.position += 1;
        if self.position >= self.bytes.len() {
            self.diagnostic(
                "truncated-control",
                "Trailing backslash has no control",
                offset,
            );
            return Ok(());
        }
        let next = self.bytes[self.position];
        if next.is_ascii_alphabetic() {
            let name_start = self.position;
            while self.position < self.bytes.len()
                && self.bytes[self.position].is_ascii_alphabetic()
            {
                self.position += 1;
            }
            let name_end = self.position;
            let name_too_long = name_end - name_start > 32;
            if name_too_long {
                self.diagnostic(
                    "control-name-too-long",
                    "Control word name exceeds the 32-letter RTF limit",
                    offset,
                );
            }
            let mut negative = false;
            if self.position < self.bytes.len() && self.bytes[self.position] == b'-' {
                negative = true;
                self.position += 1;
            }
            let digits_start = self.position;
            while self.position < self.bytes.len() && self.bytes[self.position].is_ascii_digit() {
                self.position += 1;
            }
            let parameter = if self.position > digits_start {
                let digits = &self.bytes[digits_start..self.position];
                let mut value: i64 = 0;
                for digit in digits.iter().take(10) {
                    value = value.saturating_mul(10) + i64::from(digit - b'0');
                }
                if digits.len() > 10 {
                    self.diagnostic(
                        "control-parameter-overflow",
                        "Control parameter has more than ten digits",
                        offset,
                    );
                }
                if negative {
                    value = -value;
                }
                if !(i32::MIN as i64..=i32::MAX as i64).contains(&value) {
                    self.diagnostic(
                        "control-parameter-overflow",
                        "Control parameter exceeds the signed 32-bit range",
                        offset,
                    );
                }
                Some(value.clamp(i32::MIN as i64, i32::MAX as i64) as i32)
            } else {
                if negative {
                    self.position = digits_start - 1;
                }
                None
            };
            if self.position < self.bytes.len() && self.bytes[self.position] == b' ' {
                self.position += 1;
            }
            if name_too_long {
                if !self.consume_fallback_unit() {
                    if self.group.pending_star {
                        self.flush_all_text()?;
                        self.state.destination = Destination::Suppress;
                        self.state.skip_locked = true;
                        self.group.pending_star = false;
                    }
                    self.group.fresh = false;
                }
                return Ok(());
            }
            let name = std::str::from_utf8(&self.bytes[name_start..name_end]).unwrap_or_default();

            if name == "bin" {
                let count = parameter.unwrap_or(0);
                if count < 0 {
                    return Err(ParseError::NegativeBinaryLength(offset));
                }
                let count = count as usize;
                let remaining = self.bytes.len() - self.position;
                if count > remaining {
                    return Err(ParseError::TruncatedBinary {
                        offset,
                        expected: count,
                        remaining,
                    });
                }
                let end = self.position + count;
                let payload = &self.bytes[self.position..end];
                self.position = end;
                if self.consume_fallback_unit() {
                    return Ok(());
                }
                if self.state.destination == Destination::Picture {
                    self.append_picture_binary(payload, offset)?;
                } else if self.state.destination != Destination::Suppress {
                    self.diagnostic(
                        "unexpected-binary",
                        "Binary data outside a supported picture was ignored",
                        offset,
                    );
                }
                self.group.fresh = false;
                return Ok(());
            }

            if self.consume_fallback_unit() {
                return Ok(());
            }
            self.handle_word(name, parameter, offset)?;
        } else {
            self.position += 1;
            if next == b'\'' {
                let value = if self.position + 2 <= self.bytes.len() {
                    let hi = hex(self.bytes[self.position]);
                    let lo = hex(self.bytes[self.position + 1]);
                    if let (Some(hi), Some(lo)) = (hi, lo) {
                        self.position += 2;
                        Some((hi << 4) | lo)
                    } else {
                        None
                    }
                } else {
                    None
                };
                if self.consume_fallback_unit() {
                    return Ok(());
                }
                if let Some(value) = value {
                    if self.state.destination == Destination::Picture {
                        self.append_picture_byte(value, offset)?;
                    } else if self.state.destination == Destination::FontTable {
                        self.ensure_font_builder().name.push(value);
                    } else {
                        self.append_encoded_byte(value)?;
                    }
                } else {
                    self.diagnostic(
                        "invalid-hex-escape",
                        "Invalid hexadecimal byte escape",
                        offset,
                    );
                }
                self.group.fresh = false;
                return Ok(());
            }
            if self.consume_fallback_unit() {
                return Ok(());
            }
            self.handle_symbol(next, offset)?;
        }
        Ok(())
    }

    fn consume_fallback_unit(&mut self) -> bool {
        if self.fallback_remaining == 0 {
            false
        } else {
            self.fallback_remaining -= 1;
            true
        }
    }

    fn handle_symbol(&mut self, symbol: u8, offset: usize) -> Result<(), ParseError> {
        if symbol == b'*' && self.group.fresh {
            self.group.pending_star = true;
            return Ok(());
        }
        self.group.fresh = false;
        if self.state.destination == Destination::FontTable {
            let value = match symbol {
                b'\\' | b'{' | b'}' => Some(symbol),
                b'~' => Some(b' '),
                _ => None,
            };
            if let Some(value) = value {
                self.ensure_font_builder().name.push(value);
            }
            return Ok(());
        }
        if !self.state.destination.is_visible() {
            return Ok(());
        }
        match symbol {
            b'\\' => self.append_unicode_str("\\")?,
            b'{' => self.append_unicode_str("{")?,
            b'}' => self.append_unicode_str("}")?,
            b'~' => self.append_unicode_str("\u{00a0}")?,
            b'-' => self.append_unicode_str("\u{00ad}")?,
            b'_' => self.append_unicode_str("\u{2011}")?,
            b'\r' => {
                if self.position < self.bytes.len() && self.bytes[self.position] == b'\n' {
                    self.position += 1;
                }
                self.finish_paragraph(true)?;
            }
            b'\n' => self.finish_paragraph(true)?,
            _ => self.diagnostic(
                "unsupported-control-symbol",
                &format!("Unsupported control symbol \\{}", symbol as char),
                offset,
            ),
        }
        Ok(())
    }

    fn handle_word(
        &mut self,
        name: &str,
        parameter: Option<i32>,
        offset: usize,
    ) -> Result<(), ParseError> {
        if self.state.skip_locked {
            self.group.pending_star = false;
            self.group.fresh = false;
            return Ok(());
        }
        if self.group.pending_star {
            self.group.pending_star = false;
            if !is_destination(name) {
                self.flush_all_text()?;
                self.state.destination = Destination::Suppress;
                self.state.skip_locked = true;
                self.group.fresh = false;
                self.diagnostic(
                    "unknown-destination",
                    &format!("Unknown ignorable destination \\{name} was skipped"),
                    offset,
                );
                return Ok(());
            }
        }

        if self.group.fresh && self.set_destination(name, offset)? {
            self.group.fresh = false;
            return Ok(());
        }
        self.group.fresh = false;

        if self.state.destination == Destination::Suppress {
            return Ok(());
        }

        if self.state.destination == Destination::FontTable {
            match name {
                "f" => {
                    self.finish_font();
                    self.font_builder = Some(FontBuilder {
                        id: parameter,
                        ..FontBuilder::default()
                    });
                }
                "fcharset" => {
                    self.flush_font_name_bytes();
                    self.ensure_font_builder().charset = parameter;
                }
                "cpg" => {
                    self.flush_font_name_bytes();
                    self.ensure_font_builder().codepage = parameter;
                }
                "uc" => self.state.uc = parameter.unwrap_or(1).max(0) as usize,
                "u" => {
                    self.flush_font_name_bytes();
                    self.ensure_font_builder()
                        .name_units
                        .push(parameter.unwrap_or(0) as u16);
                    self.fallback_remaining = self.state.uc;
                }
                _ => {}
            }
            return Ok(());
        }

        if self.state.destination == Destination::ColorTable {
            match name {
                "red" => self.color_builder.red = byte_parameter(parameter),
                "green" => self.color_builder.green = byte_parameter(parameter),
                "blue" => self.color_builder.blue = byte_parameter(parameter),
                _ => {}
            }
            return Ok(());
        }

        if self.state.destination == Destination::Picture {
            self.picture_control(name, parameter, offset);
            return Ok(());
        }

        let target_default_char = self.state.destination == Destination::DefaultCharacter;
        let target_default_para = self.state.destination == Destination::DefaultParagraph;
        if target_default_char || target_default_para {
            if target_default_char {
                let parameter = self.bounded_character_parameter(name, parameter, offset);
                apply_character_control(
                    &mut self.default_character,
                    name,
                    parameter,
                    self.default_font,
                );
            }
            if target_default_para {
                apply_paragraph_control(&mut self.default_paragraph, name, parameter);
            }
            return Ok(());
        }

        match name {
            "rtf" => {
                if offset == 1 && self.stack.len() == 1 && parameter == Some(1) {
                    self.saw_rtf1 = true;
                }
            }
            "ansi" => self.set_document_codepage(1252)?,
            "mac" => self.set_document_codepage(10000)?,
            "pc" => self.set_document_codepage(437)?,
            "pca" => self.set_document_codepage(850)?,
            "ansicpg" => {
                if let Some(value) = parameter {
                    self.set_document_codepage(value)?;
                }
            }
            "deff" => {
                if let Some(value) = parameter {
                    self.default_font = value;
                    self.default_character.font_id = value;
                    if self.state.character == TextStyle::default() {
                        self.state.character.font_id = value;
                    }
                }
            }
            "uc" => self.state.uc = parameter.unwrap_or(1).max(0) as usize,
            "u" => {
                self.flush_encoded_bytes()?;
                let value = parameter.unwrap_or(0) as u16;
                self.append_utf16_unit(value)?;
                self.fallback_remaining = self.state.uc;
            }
            "plain" => self.change_character(self.default_character.clone())?,
            "pard" => {
                if matches!(
                    self.state.destination,
                    Destination::ListText | Destination::PnText
                ) {
                    self.state.paragraph = self.default_paragraph.clone();
                } else {
                    self.change_paragraph(self.default_paragraph.clone());
                }
            }
            "par" => self.finish_paragraph(true)?,
            "line" | "softline" => self.append_unicode_str("\n")?,
            "tab" => self.append_unicode_str("\t")?,
            "page" => self.page_break()?,
            "sect" => {
                self.finish_paragraph(true)?;
                self.flush_incomplete_row(offset)?;
                if self.state.section_page_break {
                    self.push_page_break()?;
                }
            }
            "sectd" => self.state.section_page_break = true,
            "sbknone" | "sbkcol" => self.state.section_page_break = false,
            "sbkpage" | "sbkeven" | "sbkodd" => self.state.section_page_break = true,
            "emdash" => self.append_unicode_str("\u{2014}")?,
            "endash" => self.append_unicode_str("\u{2013}")?,
            "bullet" => self.append_unicode_str("\u{2022}")?,
            "lquote" => self.append_unicode_str("\u{2018}")?,
            "rquote" => self.append_unicode_str("\u{2019}")?,
            "ldblquote" => self.append_unicode_str("\u{201c}")?,
            "rdblquote" => self.append_unicode_str("\u{201d}")?,
            "emspace" => self.append_unicode_str("\u{2003}")?,
            "enspace" => self.append_unicode_str("\u{2002}")?,
            "qmspace" => self.append_unicode_str("\u{2005}")?,
            "zwj" => self.append_unicode_str("\u{200d}")?,
            "zwnj" => self.append_unicode_str("\u{200c}")?,
            "zwbo" => self.append_unicode_str("\u{200b}")?,
            "zwnbo" => self.append_unicode_str("\u{feff}")?,
            "paperw" => self.set_page_value(name, parameter, offset),
            "paperh" => self.set_page_value(name, parameter, offset),
            "margl" | "margr" | "margt" | "margb" => self.set_page_value(name, parameter, offset),
            "landscape" => self.landscape = toggle(parameter),
            "deftab" => {
                if let Some(value) = parameter {
                    self.default_tab = twips(value);
                }
            }
            "pgwsxn" | "pghsxn" | "marglsxn" | "margrsxn" | "margtsxn" | "margbsxn"
            | "guttersxn" | "lndscpsxn" => self.diagnostic(
                "unsupported-section-geometry",
                "Section-specific page geometry is not represented by the document model",
                offset,
            ),
            "trowd" => self.begin_row(),
            "intbl" => {
                self.state.paragraph.in_table = toggle(parameter);
                if self.state.paragraph.in_table {
                    self.row.get_or_insert_with(RowBuilder::default);
                }
            }
            "cellx" => self.push_cell_boundary(parameter.unwrap_or(0)),
            "trleft" => self.row_mut().left_twips = parameter.unwrap_or(0),
            "trgaph" => self.row_mut().gap_twips = parameter.unwrap_or(0).max(0),
            "trrh" => self.row_mut().height_twips = parameter.unwrap_or(0),
            "trql" => self.row_mut().align = Some(RowAlign::Left),
            "trqc" => self.row_mut().align = Some(RowAlign::Center),
            "trqr" => self.row_mut().align = Some(RowAlign::Right),
            "cell" => {
                self.row.get_or_insert_with(RowBuilder::default);
                self.finish_paragraph(true)?;
                self.close_cell();
            }
            "row" => self.finish_row(offset)?,
            "nestcell" => {
                self.diagnostic(
                    "unsupported-nested-table",
                    "Nested table content was flattened to reading-order text",
                    offset,
                );
                self.append_unicode_str("\t")?;
            }
            "nestrow" => {
                self.diagnostic(
                    "unsupported-nested-table",
                    "Nested table content was flattened to reading-order text",
                    offset,
                );
                self.remove_trailing_tab()?;
                self.finish_paragraph(true)?;
            }
            "itap" => {
                if parameter.is_some_and(|level| level > 1) {
                    self.diagnostic(
                        "unsupported-nested-table",
                        "Nested table content was flattened to reading-order text",
                        offset,
                    );
                }
            }
            "clbrdrt" | "clbrdrl" | "clbrdrb" | "clbrdrr" | "trbrdrt" | "trbrdrl" | "trbrdrb"
            | "trbrdrr" | "trbrdrh" | "trbrdrv" => self.select_border(name),
            "brdrnone" | "brdrnil" => self.update_border(|border| border.present = false),
            "brdrw" => {
                let width = parameter.unwrap_or(0).max(0);
                self.update_border(|border| border.width = Some(width));
            }
            "brdrcf" => {
                let color = positive_index(parameter);
                self.update_border(|border| border.color = color);
            }
            "brdrhair" => self.update_border(|border| {
                border.hairline = true;
                border.style = BorderStyle::Single;
            }),
            "brdrs" | "brdrth" | "brdrtnthsg" | "brdrengrave" | "brdremboss" => {
                self.update_border(|border| border.style = BorderStyle::Single);
            }
            "brdrdb" | "brdrtriple" | "brdrtnthtnthlg" => {
                self.update_border(|border| border.style = BorderStyle::Double);
            }
            "brdrdot" => self.update_border(|border| border.style = BorderStyle::Dotted),
            "brdrdash" | "brdrdashsm" | "brdrdashd" | "brdrdashdd" | "brdrdashdotstr" => {
                self.update_border(|border| border.style = BorderStyle::Dashed);
            }
            "brdrwavy" | "brdrwavydb" | "brdrinset" | "brdroutset" | "brdrframe" => {
                self.update_border(|border| border.style = BorderStyle::Other);
            }
            "clpadl" => self.set_padding_value(true, Side::Left, parameter),
            "clpadt" => self.set_padding_value(true, Side::Top, parameter),
            "clpadb" => self.set_padding_value(true, Side::Bottom, parameter),
            "clpadr" => self.set_padding_value(true, Side::Right, parameter),
            "clpadfl" => self.set_padding_unit(true, Side::Left, parameter),
            "clpadft" => self.set_padding_unit(true, Side::Top, parameter),
            "clpadfb" => self.set_padding_unit(true, Side::Bottom, parameter),
            "clpadfr" => self.set_padding_unit(true, Side::Right, parameter),
            "trpaddl" => self.set_padding_value(false, Side::Left, parameter),
            "trpaddt" => self.set_padding_value(false, Side::Top, parameter),
            "trpaddb" => self.set_padding_value(false, Side::Bottom, parameter),
            "trpaddr" => self.set_padding_value(false, Side::Right, parameter),
            "trpaddfl" => self.set_padding_unit(false, Side::Left, parameter),
            "trpaddft" => self.set_padding_unit(false, Side::Top, parameter),
            "trpaddfb" => self.set_padding_unit(false, Side::Bottom, parameter),
            "trpaddfr" => self.set_padding_unit(false, Side::Right, parameter),
            "clmgf" | "clmrg" | "clvmgf" | "clvmrg" => self.diagnostic(
                "unsupported-table-merge",
                "Merged table cells were laid out as ordinary cells",
                offset,
            ),
            "clvertalt" => self.row_mut().pending.vertical_align = Some(VerticalAlign::Top),
            "clvertalc" => self.row_mut().pending.vertical_align = Some(VerticalAlign::Center),
            "clvertalb" => self.row_mut().pending.vertical_align = Some(VerticalAlign::Bottom),
            "clcbpat" => self.row_mut().pending.shading.background = positive_index(parameter),
            "clcfpat" => self.row_mut().pending.shading.foreground = positive_index(parameter),
            "clshdng" => {
                let intensity = shading_intensity(parameter);
                self.row_mut().pending.shading.intensity = intensity;
            }
            "trcbpat" => self.row_mut().shading.background = positive_index(parameter),
            "trcfpat" => self.row_mut().shading.foreground = positive_index(parameter),
            "trshdng" => {
                let intensity = shading_intensity(parameter);
                self.row_mut().shading.intensity = intensity;
            }
            "clbgbdiag" | "clbgfdiag" | "clbghoriz" | "clbgvert" | "clbgcross" | "clbgdcross"
            | "clbgdkbdiag" | "clbgdkfdiag" | "clbgdkhor" | "clbgdkvert" | "clbgdkcross"
            | "clbgdkdcross" => self.diagnostic(
                "approximated-table-cell-pattern",
                "Table cell background pattern was drawn as its flat shading blend",
                offset,
            ),
            "trhdr" => self.diagnostic(
                "unsupported-table-header-row",
                "Header rows are not repeated on continuation pages",
                offset,
            ),
            "trkeep" | "trkeepfollow" => self.diagnostic(
                "unsupported-table-keep",
                "Row keep-together was ignored; rows may split across pages",
                offset,
            ),
            "ls" | "ilvl" => self.diagnostic(
                "unsupported-list-semantics",
                "List numbering used its compatibility text representation",
                offset,
            ),
            "rtlch" | "rtlpar" | "rtlrow" | "fbidi" => self.diagnostic(
                "unsupported-bidirectional-text",
                "Bidirectional text layout is not supported",
                offset,
            ),
            "loch" | "hich" | "dbch" => self.diagnostic(
                "unsupported-associated-font-run",
                "Associated-font run selection was ignored",
                offset,
            ),
            "widowctrl" | "widctlpar" | "nowidctlpar" => self.diagnostic(
                "unsupported-widow-control",
                "Widow/orphan pagination control was ignored",
                offset,
            ),
            _ if is_character_control(name) => {
                let mut next = self.state.character.clone();
                let parameter = self.bounded_character_parameter(name, parameter, offset);
                apply_character_control(&mut next, name, parameter, self.default_font);
                self.change_character(next)?;
            }
            _ if is_paragraph_control(name) => {
                let mut next = self.state.paragraph.clone();
                apply_paragraph_control(&mut next, name, parameter);
                if matches!(
                    self.state.destination,
                    Destination::ListText | Destination::PnText
                ) {
                    self.state.paragraph = next;
                } else {
                    self.change_paragraph(next);
                }
            }
            _ if is_known_ignored_control(name) => {}
            _ => self.diagnostic(
                "unsupported-control",
                &format!("Unsupported control word \\{name} was ignored"),
                offset,
            ),
        }
        Ok(())
    }

    fn set_destination(&mut self, name: &str, offset: usize) -> Result<bool, ParseError> {
        let (destination, skip_locked) = match name {
            "fonttbl" => (Destination::FontTable, false),
            "colortbl" => (Destination::ColorTable, false),
            "defchp" => (Destination::DefaultCharacter, false),
            "defpap" => (Destination::DefaultParagraph, false),
            "pict" if self.picture.is_some() => {
                self.diagnostic(
                    "nested-picture",
                    "Nested picture destination was skipped",
                    offset,
                );
                (Destination::Suppress, true)
            }
            "pict" if self.state.allow_pictures => {
                self.flush_all_text()?;
                self.picture = Some(PictureBuilder::new(self.stack.len(), offset));
                (Destination::Picture, false)
            }
            "pict" => (Destination::Suppress, true),
            "shppict" => {
                self.state.allow_pictures = true;
                (Destination::PictureContainer, false)
            }
            "nonshppict" => {
                self.state.allow_pictures = false;
                (Destination::Suppress, true)
            }
            "listtext" => (Destination::ListText, false),
            "pntext" => (Destination::PnText, false),
            "fldrslt" => (Destination::Body, false),
            "listtable" | "listoverridetable" | "pn" => {
                self.diagnostic(
                    "unsupported-list-semantics",
                    "List numbering used its compatibility text representation",
                    offset,
                );
                (Destination::Suppress, true)
            }
            "stylesheet" => {
                self.diagnostic(
                    "unsupported-stylesheet",
                    "Named stylesheet definitions were ignored",
                    offset,
                );
                (Destination::Suppress, true)
            }
            "nesttableprops" => (Destination::Suppress, true),
            "nonesttables" => (Destination::Body, false),
            "fldinst" | "info" | "generator" | "header" | "footer" | "headerl" | "headerr"
            | "headerf" | "footerl" | "footerr" | "footerf" | "footnote" | "annotation"
            | "blipuid" | "themedata" | "colorschememapping" | "filetbl" | "revtbl" | "rsidtbl"
            | "xmlnstbl" | "bookmark" | "bkmkstart" | "bkmkend" | "object" | "objdata"
            | "datastore" => {
                self.diagnostic(
                    "unsupported-destination",
                    &format!("Destination \\{name} was skipped"),
                    offset,
                );
                (Destination::Suppress, true)
            }
            "upr" => {
                self.state.in_upr = true;
                (Destination::Suppress, false)
            }
            "ud" if self.state.in_upr => (Destination::Body, false),
            "ud" | "field" => (Destination::Suppress, false),
            _ => return Ok(false),
        };
        self.flush_all_text()?;
        self.state.destination = destination;
        self.state.skip_locked = skip_locked;
        Ok(true)
    }

    fn bounded_character_parameter(
        &mut self,
        name: &str,
        parameter: Option<i32>,
        offset: usize,
    ) -> Option<i32> {
        let value = parameter?;
        let bounded = match name {
            "fs" => value.clamp(1, 4096),
            "up" | "dn" => value.clamp(-4096, 4096),
            _ => value,
        };
        if bounded != value {
            self.diagnostic(
                "character-value-out-of-range",
                &format!("Character control \\{name} was clamped to a safe range"),
                offset,
            );
        }
        Some(bounded)
    }

    fn handle_plain_byte(&mut self, byte: u8, offset: usize) -> Result<(), ParseError> {
        match self.state.destination {
            Destination::Picture => {
                if byte.is_ascii_whitespace() {
                    return Ok(());
                }
                let Some(nibble) = hex(byte) else {
                    self.diagnostic(
                        "invalid-picture-hex",
                        "Non-hexadecimal byte in picture payload",
                        offset,
                    );
                    return Ok(());
                };
                let Some(picture) = self.picture.as_mut() else {
                    self.diagnostic(
                        "invalid-picture-state",
                        "Picture payload had no active picture destination",
                        offset,
                    );
                    return Ok(());
                };
                if let Some(high) = picture.pending_nibble.take() {
                    self.append_picture_byte((high << 4) | nibble, offset)?;
                } else {
                    picture.pending_nibble = Some(nibble);
                }
            }
            Destination::FontTable => {
                if byte == b';' {
                    self.finish_font();
                } else {
                    self.ensure_font_builder().name.push(byte);
                }
            }
            Destination::ColorTable => {
                if byte == b';' {
                    let color = match (
                        self.color_builder.red,
                        self.color_builder.green,
                        self.color_builder.blue,
                    ) {
                        (Some(red), Some(green), Some(blue)) => {
                            Some(format!("#{red:02x}{green:02x}{blue:02x}"))
                        }
                        _ => None,
                    };
                    self.colors.push(color);
                    self.color_builder = ColorBuilder::default();
                }
            }
            destination if destination.is_visible() => self.append_encoded_byte(byte)?,
            _ => {}
        }
        Ok(())
    }

    fn ensure_font_builder(&mut self) -> &mut FontBuilder {
        self.font_builder.get_or_insert_with(FontBuilder::default)
    }

    fn finish_font(&mut self) {
        self.flush_font_name_bytes();
        let Some(builder) = self.font_builder.take() else {
            return;
        };
        let Some(id) = builder.id else { return };
        let name = String::from_utf16_lossy(&builder.name_units)
            .trim()
            .to_string();
        if name.is_empty() {
            return;
        }
        let font = FontDef {
            id,
            name,
            charset: builder.charset,
            codepage: builder
                .codepage
                .or_else(|| builder.charset.and_then(charset_codepage)),
        };
        if let Some(existing) = self.fonts.iter_mut().find(|entry| entry.id == id) {
            *existing = font;
        } else {
            self.fonts.push(font);
        }
    }

    fn flush_font_name_bytes(&mut self) {
        let Some(builder) = self.font_builder.as_mut() else {
            return;
        };
        if builder.name.is_empty() {
            return;
        }
        let codepage = builder
            .codepage
            .or_else(|| builder.charset.and_then(charset_codepage))
            .unwrap_or(self.document_codepage);
        let bytes = std::mem::take(&mut builder.name);
        let (text, _) = decode_bytes(&bytes, codepage);
        builder.name_units.extend(text.encode_utf16());
    }

    fn picture_control(&mut self, name: &str, parameter: Option<i32>, offset: usize) {
        let Some(picture) = self.picture.as_mut() else {
            return;
        };
        match name {
            "pngblip" => picture.format = ImageFormat::Png,
            "jpegblip" => picture.format = ImageFormat::Jpeg,
            "wmetafile" => picture.format = ImageFormat::Wmf,
            "emfblip" => picture.format = ImageFormat::Emf,
            "picw" => picture.pic_width = parameter,
            "pich" => picture.pic_height = parameter,
            "picwgoal" => picture.goal_width = parameter,
            "pichgoal" => picture.goal_height = parameter,
            "picscalex" => picture.scale_x = parameter.unwrap_or(100),
            "picscaley" => picture.scale_y = parameter.unwrap_or(100),
            "piccropt" | "piccropb" | "piccropl" | "piccropr" | "bliptag" | "picbmp" | "picbpp" => {
            }
            _ => self.diagnostic(
                "unsupported-picture-control",
                &format!("Unsupported picture control \\{name} was ignored"),
                offset,
            ),
        }
    }

    fn append_picture_binary(&mut self, payload: &[u8], offset: usize) -> Result<(), ParseError> {
        if payload.len() > MAX_IMAGE_BYTES {
            return Err(ParseError::ImageByteLimit(offset));
        }
        let Some(picture) = self.picture.as_mut() else {
            return Ok(());
        };
        if picture.data.len().saturating_add(payload.len()) > MAX_IMAGE_BYTES {
            return Err(ParseError::ImageByteLimit(offset));
        }
        picture.data.extend_from_slice(payload);
        Ok(())
    }

    fn append_picture_byte(&mut self, byte: u8, offset: usize) -> Result<(), ParseError> {
        let Some(picture) = self.picture.as_mut() else {
            return Ok(());
        };
        if picture.data.len() >= MAX_IMAGE_BYTES {
            return Err(ParseError::ImageByteLimit(offset));
        }
        picture.data.push(byte);
        Ok(())
    }

    fn finish_picture(&mut self) -> Result<(), ParseError> {
        let Some(picture) = self.picture.take() else {
            return Ok(());
        };
        if picture.pending_nibble.is_some() {
            self.diagnostic(
                "odd-picture-hex",
                "Picture payload ended with an unmatched hexadecimal nibble",
                picture.start_offset,
            );
        }
        if self.images.len() >= MAX_IMAGES {
            return Err(ParseError::ImageLimit);
        }
        if !signature_matches(picture.format, &picture.data) {
            self.diagnostic(
                "image-signature-mismatch",
                "Picture bytes do not match the declared image format",
                picture.start_offset,
            );
        }
        if matches!(picture.format, ImageFormat::Wmf | ImageFormat::Emf) {
            self.diagnostic(
                "unsupported-vector-image",
                "WMF/EMF data was preserved but cannot be rendered by the initial browser viewer",
                picture.start_offset,
            );
        }
        if picture.format == ImageFormat::Unknown {
            self.diagnostic(
                "unsupported-image-format",
                "Picture format is missing or unsupported",
                picture.start_offset,
            );
        }
        let width = image_dimension(
            picture.goal_width,
            picture.pic_width,
            picture.scale_x,
            picture.format,
        );
        let height = image_dimension(
            picture.goal_height,
            picture.pic_height,
            picture.scale_y,
            picture.format,
        );
        let id = format!("image-{}", self.images.len());
        self.images.push(ImageResource {
            id: id.clone(),
            format: picture.format,
            data: picture.data,
            width,
            height,
        });
        self.flush_all_text()?;
        self.paragraph.runs.push(Run::Image { image_id: id });
        Ok(())
    }

    fn set_document_codepage(&mut self, value: i32) -> Result<(), ParseError> {
        self.flush_encoded_bytes()?;
        self.document_codepage = value;
        Ok(())
    }

    fn active_codepage(&self) -> i32 {
        self.active_codepage_for(&self.state)
    }

    fn active_codepage_for(&self, state: &State) -> i32 {
        self.fonts
            .iter()
            .find(|font| font.id == state.character.font_id)
            .and_then(|font| font.codepage)
            .unwrap_or(self.document_codepage)
    }

    fn append_encoded_byte(&mut self, byte: u8) -> Result<(), ParseError> {
        if !self.state.destination.is_visible() {
            return Ok(());
        }
        let codepage = self.active_codepage();
        if self
            .byte_buffer_codepage
            .is_some_and(|active| active != codepage)
        {
            self.flush_encoded_bytes()?;
        }
        self.byte_buffer_codepage = Some(codepage);
        self.byte_buffer.push(byte);
        Ok(())
    }

    fn flush_encoded_bytes(&mut self) -> Result<(), ParseError> {
        if self.byte_buffer.is_empty() {
            self.byte_buffer_codepage = None;
            return Ok(());
        }
        let bytes = std::mem::take(&mut self.byte_buffer);
        let codepage = self.byte_buffer_codepage.take().unwrap_or(1252);
        let (text, had_errors) = decode_bytes(&bytes, codepage);
        if had_errors {
            self.diagnostic(
                "text-decoding-error",
                &format!("Invalid byte sequence for code page {codepage} was replaced"),
                self.position.saturating_sub(bytes.len()),
            );
        }
        if encoding_for_codepage(codepage).is_none() && bytes.iter().any(|byte| *byte >= 0x80) {
            self.diagnostic(
                "unsupported-codepage",
                &format!("Code page {codepage} is unavailable; Windows-1252 fallback was used"),
                self.position.saturating_sub(bytes.len()),
            );
        }
        self.append_unicode_str(&text)
    }

    fn append_unicode_str(&mut self, text: &str) -> Result<(), ParseError> {
        if !self.state.destination.is_visible() {
            return Ok(());
        }
        self.flush_encoded_bytes_if_needed()?;
        self.ensure_unit_style()?;
        self.add_text_units(text.encode_utf16())
    }

    fn append_utf16_unit(&mut self, unit: u16) -> Result<(), ParseError> {
        self.ensure_unit_style()?;
        self.add_text_units(std::iter::once(unit))
    }

    fn flush_encoded_bytes_if_needed(&mut self) -> Result<(), ParseError> {
        if self.byte_buffer.is_empty() {
            Ok(())
        } else {
            self.flush_encoded_bytes()
        }
    }

    fn ensure_unit_style(&mut self) -> Result<(), ParseError> {
        if self
            .unit_style
            .as_ref()
            .is_some_and(|style| style != &self.state.character)
        {
            self.flush_units()?;
        }
        if self.unit_style.is_none() {
            self.unit_style = Some(self.state.character.clone());
        }
        Ok(())
    }

    fn add_text_units(&mut self, units: impl IntoIterator<Item = u16>) -> Result<(), ParseError> {
        for unit in units {
            self.text_units += 1;
            if self.text_units > MAX_TEXT_UNITS {
                return Err(ParseError::TextLimit);
            }
            self.unit_buffer.push(unit);
        }
        Ok(())
    }

    fn flush_units(&mut self) -> Result<(), ParseError> {
        if self.unit_buffer.is_empty() {
            self.unit_style = None;
            return Ok(());
        }
        let text = String::from_utf16_lossy(&self.unit_buffer);
        self.unit_buffer.clear();
        let style = self.unit_style.take().unwrap_or_default();
        if let Some(Run::Text {
            text: previous,
            style: previous_style,
        }) = self.paragraph.runs.last_mut()
            && previous_style == &style
        {
            previous.push_str(&text);
        } else {
            self.paragraph.runs.push(Run::Text { text, style });
        }
        Ok(())
    }

    fn flush_all_text(&mut self) -> Result<(), ParseError> {
        self.flush_encoded_bytes()?;
        self.flush_units()
    }

    fn change_character(&mut self, character: TextStyle) -> Result<(), ParseError> {
        if character != self.state.character {
            self.flush_all_text()?;
            self.state.character = character;
        }
        Ok(())
    }

    fn change_paragraph(&mut self, paragraph: ParagraphState) {
        self.state.paragraph = paragraph.clone();
        self.paragraph.style = paragraph;
    }

    fn finish_paragraph(&mut self, force: bool) -> Result<(), ParseError> {
        self.flush_all_text()?;
        if !force && self.paragraph.runs.is_empty() {
            return Ok(());
        }
        self.paragraph_count += 1;
        if self.paragraph_count > MAX_PARAGRAPHS {
            return Err(ParseError::ParagraphLimit);
        }
        let builder = std::mem::replace(
            &mut self.paragraph,
            ParagraphBuilder::new(self.state.paragraph.clone()),
        );
        let block = Block::Paragraph {
            runs: builder.runs,
            style: builder.style.to_model(),
            mark_style: self.state.character.clone(),
        };
        // Between \trowd and \row every paragraph belongs to the cell being collected.
        if self.row.is_some() {
            self.cell_blocks.push(block);
        } else {
            self.push_body_block(block)?;
        }
        Ok(())
    }

    fn push_body_block(&mut self, block: Block) -> Result<(), ParseError> {
        if self.blocks.len() >= MAX_PARAGRAPHS {
            return Err(ParseError::ParagraphLimit);
        }
        self.blocks.push(block);
        Ok(())
    }

    fn row_mut(&mut self) -> &mut RowBuilder {
        self.row.get_or_insert_with(RowBuilder::default)
    }

    /// `\trowd` resets the row definition. Content already collected is kept, because some
    /// writers emit the definition after the cell text and before `\row`.
    fn begin_row(&mut self) {
        let contents = self.row.take().map(|row| row.contents).unwrap_or_default();
        self.row = Some(RowBuilder {
            contents,
            ..RowBuilder::default()
        });
    }

    fn push_cell_boundary(&mut self, right_twips: i32) {
        let row = self.row_mut();
        row.target = None;
        if row.defs.len() >= MAX_CELLS_PER_ROW {
            row.overflowed = true;
            row.pending = CellDef::default();
            return;
        }
        let mut def = std::mem::take(&mut row.pending);
        def.right_twips = right_twips;
        row.defs.push(def);
    }

    fn close_cell(&mut self) {
        let blocks = std::mem::take(&mut self.cell_blocks);
        let row = self.row_mut();
        if row.contents.len() >= MAX_CELLS_PER_ROW {
            row.overflowed = true;
            if let Some(last) = row.contents.last_mut() {
                last.extend(blocks);
            }
            return;
        }
        row.contents.push(blocks);
    }

    fn select_border(&mut self, name: &str) {
        let target = match name {
            "clbrdrt" => BorderTarget::Cell(Side::Top),
            "clbrdrl" => BorderTarget::Cell(Side::Left),
            "clbrdrb" => BorderTarget::Cell(Side::Bottom),
            "clbrdrr" => BorderTarget::Cell(Side::Right),
            "trbrdrt" => BorderTarget::RowOuter(Side::Top),
            "trbrdrl" => BorderTarget::RowOuter(Side::Left),
            "trbrdrb" => BorderTarget::RowOuter(Side::Bottom),
            "trbrdrr" => BorderTarget::RowOuter(Side::Right),
            "trbrdrh" => BorderTarget::RowInnerHorizontal,
            "trbrdrv" => BorderTarget::RowInnerVertical,
            _ => BorderTarget::Ignored,
        };
        let row = self.row_mut();
        row.target = Some(target);
        // Selecting a side declares the border; \brdrnone later clears it again.
        let slot = match target {
            BorderTarget::Cell(side) => row.pending.borders.entry(side),
            BorderTarget::RowOuter(side) => row.borders.entry(side),
            BorderTarget::RowInnerHorizontal => &mut row.inner_horizontal,
            BorderTarget::RowInnerVertical => &mut row.inner_vertical,
            BorderTarget::Ignored => return,
        };
        *slot = Some(BorderBuilder::default());
    }

    fn update_border(&mut self, apply: impl FnOnce(&mut BorderBuilder)) {
        let Some(row) = self.row.as_mut() else { return };
        let Some(target) = row.target else { return };
        let slot = match target {
            BorderTarget::Cell(side) => row.pending.borders.entry(side),
            BorderTarget::RowOuter(side) => row.borders.entry(side),
            BorderTarget::RowInnerHorizontal => &mut row.inner_horizontal,
            BorderTarget::RowInnerVertical => &mut row.inner_vertical,
            BorderTarget::Ignored => return,
        };
        if let Some(border) = slot.as_mut() {
            apply(border);
        }
    }

    fn set_padding_value(&mut self, cell: bool, side: Side, parameter: Option<i32>) {
        let row = self.row_mut();
        let padding = if cell {
            &mut row.pending.padding
        } else {
            &mut row.padding
        };
        padding.value[side.index()] = Some(parameter.unwrap_or(0));
    }

    fn set_padding_unit(&mut self, cell: bool, side: Side, parameter: Option<i32>) {
        let row = self.row_mut();
        let padding = if cell {
            &mut row.pending.padding
        } else {
            &mut row.padding
        };
        padding.unit[side.index()] = Some(parameter.unwrap_or(0));
    }

    /// A row that never reaches `\row` still owns real content. Emit it as body paragraphs
    /// rather than dropping it.
    fn flush_incomplete_row(&mut self, offset: usize) -> Result<(), ParseError> {
        if self.row.is_none() {
            return Ok(());
        }
        self.flush_all_text()?;
        if !self.paragraph.runs.is_empty() {
            self.finish_paragraph(true)?;
        }
        if !self.cell_blocks.is_empty() {
            self.close_cell();
        }
        let Some(row) = self.row.take() else {
            return Ok(());
        };
        let has_content = row.contents.iter().any(|blocks| !blocks.is_empty());
        if has_content {
            self.diagnostic(
                "incomplete-table-row",
                "Table row ended without \\row; its cells were emitted as paragraphs",
                offset,
            );
        }
        for blocks in row.contents {
            for block in blocks {
                self.push_body_block(block)?;
            }
        }
        Ok(())
    }

    fn finish_row(&mut self, offset: usize) -> Result<(), ParseError> {
        self.flush_all_text()?;
        if self.row.is_none() && self.paragraph.runs.is_empty() {
            return Ok(());
        }
        self.row.get_or_insert_with(RowBuilder::default);
        if !self.paragraph.runs.is_empty() || !self.cell_blocks.is_empty() {
            self.finish_paragraph(true)?;
            self.close_cell();
        }
        let Some(row) = self.row.take() else {
            return Ok(());
        };
        self.state.paragraph.in_table = false;
        if row.overflowed {
            self.diagnostic(
                "table-cell-limit",
                "Table row exceeds 256 cells; the remaining content was merged into the last cell",
                offset,
            );
        }
        if row.padding.has_rejected_unit()
            || row.defs.iter().any(|def| def.padding.has_rejected_unit())
        {
            self.diagnostic(
                "unsupported-table-padding-unit",
                "Cell padding declared in a unit other than twips was ignored",
                offset,
            );
        }

        let mut contents = row.contents;
        if row.defs.is_empty() {
            if contents.iter().any(|blocks| !blocks.is_empty()) {
                self.diagnostic(
                    "invalid-table-definition",
                    "Table row has no \\cellx boundary; its cells were emitted as paragraphs",
                    offset,
                );
            }
            for blocks in contents {
                for block in blocks {
                    self.push_body_block(block)?;
                }
            }
            return Ok(());
        }

        // Pair each boundary with its content, dropping boundaries that do not advance.
        let mut resolved: Vec<(&CellDef, Vec<Block>)> = Vec::new();
        let mut carried: Vec<Block> = Vec::new();
        let mut previous = row.left_twips;
        let mut dropped = false;
        for (index, def) in row.defs.iter().enumerate() {
            let mut blocks = contents
                .get_mut(index)
                .map(std::mem::take)
                .unwrap_or_default();
            if def.right_twips <= previous {
                dropped = true;
                match resolved.last_mut() {
                    Some((_, last)) => last.append(&mut blocks),
                    None => carried.append(&mut blocks),
                }
                continue;
            }
            previous = def.right_twips;
            let mut merged = std::mem::take(&mut carried);
            merged.append(&mut blocks);
            resolved.push((def, merged));
        }
        for extra in contents.into_iter().skip(row.defs.len()) {
            match resolved.last_mut() {
                Some((_, last)) => last.extend(extra),
                None => carried.extend(extra),
            }
        }
        if dropped {
            self.diagnostic(
                "invalid-table-definition",
                "Table cell boundaries are not strictly increasing; those cells were merged",
                offset,
            );
        }
        if resolved.is_empty() {
            for block in carried {
                self.push_body_block(block)?;
            }
            return Ok(());
        }

        let gap = twips(row.gap_twips);
        let last = resolved.len() - 1;
        let cells = resolved
            .into_iter()
            .enumerate()
            .map(|(index, (def, blocks))| {
                let border =
                    |side: Side, fallback: Option<BorderBuilder>| match def.borders.get(side) {
                        Some(declared) => declared.resolve(),
                        None => fallback.and_then(BorderBuilder::resolve),
                    };
                let horizontal =
                    |side: Side| border(side, row.borders.get(side).or(row.inner_horizontal));
                TableCell {
                    right: twips(def.right_twips),
                    blocks,
                    padding: Padding {
                        left: def
                            .padding
                            .resolve(Side::Left)
                            .or_else(|| row.padding.resolve(Side::Left))
                            .unwrap_or(gap),
                        right: def
                            .padding
                            .resolve(Side::Right)
                            .or_else(|| row.padding.resolve(Side::Right))
                            .unwrap_or(gap),
                        top: def
                            .padding
                            .resolve(Side::Top)
                            .or_else(|| row.padding.resolve(Side::Top))
                            .unwrap_or(0.0),
                        bottom: def
                            .padding
                            .resolve(Side::Bottom)
                            .or_else(|| row.padding.resolve(Side::Bottom))
                            .unwrap_or(0.0),
                    },
                    vertical_align: def.vertical_align,
                    shading: def.shading.or(row.shading).resolve(),
                    borders: CellBorders {
                        top: horizontal(Side::Top),
                        bottom: horizontal(Side::Bottom),
                        left: border(
                            Side::Left,
                            if index == 0 {
                                row.borders.get(Side::Left).or(row.inner_vertical)
                            } else {
                                row.inner_vertical
                            },
                        ),
                        right: border(
                            Side::Right,
                            if index == last {
                                row.borders.get(Side::Right).or(row.inner_vertical)
                            } else {
                                row.inner_vertical
                            },
                        ),
                    },
                }
            })
            .collect();

        let height = match row.height_twips {
            0 => RowHeight::Auto,
            value if value > 0 => RowHeight::AtLeast(twips(value)),
            value => RowHeight::Exact(twips(value.saturating_neg())),
        };
        self.push_body_block(Block::Row {
            cells,
            left: twips(row.left_twips),
            height,
            align: row.align.unwrap_or(RowAlign::Left),
        })
    }

    fn page_break(&mut self) -> Result<(), ParseError> {
        self.flush_all_text()?;
        if !self.paragraph.runs.is_empty() {
            self.finish_paragraph(false)?;
        }
        let offset = self.position;
        self.flush_incomplete_row(offset)?;
        self.push_page_break()?;
        Ok(())
    }

    fn push_page_break(&mut self) -> Result<(), ParseError> {
        if self.blocks.len() >= MAX_PARAGRAPHS {
            return Err(ParseError::ParagraphLimit);
        }
        self.blocks.push(Block::PageBreak);
        Ok(())
    }

    fn remove_trailing_tab(&mut self) -> Result<(), ParseError> {
        self.flush_all_text()?;
        if let Some(Run::Text { text, .. }) = self.paragraph.runs.last_mut()
            && text.ends_with('\t')
        {
            text.pop();
        }
        if matches!(self.paragraph.runs.last(), Some(Run::Text { text, .. }) if text.is_empty()) {
            self.paragraph.runs.pop();
        }
        Ok(())
    }

    fn set_page_value(&mut self, name: &str, parameter: Option<i32>, offset: usize) {
        let Some(value) = parameter else { return };
        if value <= 0 && matches!(name, "paperw" | "paperh") {
            self.diagnostic(
                "invalid-page-geometry",
                "Non-positive paper dimension was ignored",
                offset,
            );
            return;
        }
        let points = twips(value);
        match name {
            "paperw" => {
                self.page.width = points;
                self.explicit_page_width = true;
            }
            "paperh" => {
                self.page.height = points;
                self.explicit_page_height = true;
            }
            "margl" => self.page.margin_left = points,
            "margr" => self.page.margin_right = points,
            "margt" => self.page.margin_top = points,
            "margb" => self.page.margin_bottom = points,
            _ => {}
        }
    }

    fn diagnostic(&mut self, code: &str, message: &str, offset: usize) {
        if self.diagnostics.len() >= MAX_DIAGNOSTICS {
            return;
        }
        let key = (code.to_string(), message.to_string());
        if !self.diagnostic_keys.insert(key) {
            return;
        }
        self.diagnostics.push(Diagnostic {
            code: code.to_string(),
            message: message.to_string(),
            offset,
        });
    }
}

fn is_destination(name: &str) -> bool {
    matches!(
        name,
        "fonttbl"
            | "colortbl"
            | "defchp"
            | "defpap"
            | "pict"
            | "shppict"
            | "nonshppict"
            | "listtext"
            | "pntext"
            | "listtable"
            | "listoverridetable"
            | "pn"
            | "stylesheet"
            | "nesttableprops"
            | "nonesttables"
            | "fldinst"
            | "fldrslt"
            | "info"
            | "generator"
            | "header"
            | "footer"
            | "headerl"
            | "headerr"
            | "headerf"
            | "footerl"
            | "footerr"
            | "footerf"
            | "footnote"
            | "annotation"
            | "blipuid"
            | "themedata"
            | "colorschememapping"
            | "filetbl"
            | "revtbl"
            | "rsidtbl"
            | "xmlnstbl"
            | "bookmark"
            | "bkmkstart"
            | "bkmkend"
            | "object"
            | "objdata"
            | "datastore"
            | "upr"
            | "ud"
            | "field"
    )
}

fn is_character_control(name: &str) -> bool {
    matches!(
        name,
        "f" | "fs"
            | "b"
            | "i"
            | "ul"
            | "ulnone"
            | "strike"
            | "cf"
            | "highlight"
            | "v"
            | "up"
            | "dn"
            | "super"
            | "sub"
            | "nosupersub"
    )
}

fn apply_character_control(
    style: &mut TextStyle,
    name: &str,
    parameter: Option<i32>,
    default_font: i32,
) {
    match name {
        "f" => style.font_id = parameter.unwrap_or(default_font),
        "fs" => style.font_size = parameter.unwrap_or(24).max(1) as f64 / 2.0,
        "b" => style.bold = toggle(parameter),
        "i" => style.italic = toggle(parameter),
        "ul" => style.underline = toggle(parameter),
        "ulnone" => style.underline = false,
        "strike" => style.strike = toggle(parameter),
        "cf" => style.color = positive_index(parameter),
        "highlight" => style.highlight = positive_index(parameter),
        "v" => style.hidden = toggle(parameter),
        "up" => style.baseline = parameter.unwrap_or(6) as f64 / 2.0,
        "dn" => style.baseline = -(parameter.unwrap_or(6) as f64 / 2.0),
        "super" => style.baseline = style.font_size / 3.0,
        "sub" => style.baseline = -style.font_size / 6.0,
        "nosupersub" => style.baseline = 0.0,
        _ => {}
    }
}

fn is_paragraph_control(name: &str) -> bool {
    matches!(
        name,
        "ql" | "qc"
            | "qr"
            | "qj"
            | "li"
            | "ri"
            | "lin"
            | "rin"
            | "fi"
            | "sb"
            | "sa"
            | "sl"
            | "slmult"
            | "pagebb"
    )
}

fn apply_paragraph_control(state: &mut ParagraphState, name: &str, parameter: Option<i32>) {
    match name {
        "ql" => state.align = ParagraphAlign::Left,
        "qc" => state.align = ParagraphAlign::Center,
        "qr" => state.align = ParagraphAlign::Right,
        "qj" => state.align = ParagraphAlign::Justify,
        "li" => state.left_indent = twips(parameter.unwrap_or(0)),
        "ri" => state.right_indent = twips(parameter.unwrap_or(0)),
        "lin" => state.left_indent = twips(parameter.unwrap_or(0)),
        "rin" => state.right_indent = twips(parameter.unwrap_or(0)),
        "fi" => state.first_line_indent = twips(parameter.unwrap_or(0)),
        "sb" => state.space_before = twips(parameter.unwrap_or(0)),
        "sa" => state.space_after = twips(parameter.unwrap_or(0)),
        "sl" => state.line_spacing_twips = parameter.unwrap_or(0),
        "slmult" => state.line_spacing_multiple = parameter.unwrap_or(0) != 0,
        "pagebb" => state.page_break_before = toggle(parameter),
        _ => {}
    }
}

fn is_known_ignored_control(name: &str) -> bool {
    matches!(
        name,
        "froman"
            | "fswiss"
            | "fmodern"
            | "fscript"
            | "fdecor"
            | "ftech"
            | "fnil"
            | "fcharset"
            | "cpg"
            | "red"
            | "green"
            | "blue"
            | "viewkind"
            | "lang"
            | "langfe"
            | "langnp"
            | "langfenp"
            | "ltrch"
            | "ltrpar"
            | "adjustright"
            | "aspalpha"
            | "aspnum"
            | "faauto"
            | "itap"
            | "keep"
            | "keepn"
            | "tx"
            | "tqr"
            | "tqc"
            | "tqdec"
            | "ltrrow"
            | "lastrow"
            | "trautofit"
            | "tblind"
            | "tblindtype"
            | "trwWidth"
            | "trftsWidth"
            | "trwWidthA"
            | "trftsWidthA"
            | "trwWidthB"
            | "trftsWidthB"
            | "clwWidth"
            | "clftsWidth"
            | "brdrtbl"
    )
}

fn toggle(parameter: Option<i32>) -> bool {
    parameter.unwrap_or(1) != 0
}

/// `\clshdng` is hundredths of a percent; anything outside 0..=10000 is meaningless.
fn shading_intensity(parameter: Option<i32>) -> Option<u32> {
    parameter.map(|value| value.clamp(0, 10_000) as u32)
}

fn positive_index(parameter: Option<i32>) -> Option<u32> {
    parameter.and_then(|value| (value > 0).then_some(value as u32))
}

fn byte_parameter(parameter: Option<i32>) -> Option<u8> {
    parameter.and_then(|value| u8::try_from(value).ok())
}

fn twips(value: i32) -> f64 {
    value as f64 / 20.0
}

fn hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn charset_codepage(charset: i32) -> Option<i32> {
    match charset {
        0 => Some(1252),
        2 => Some(42),
        77 => Some(10000),
        78 => Some(10001),
        79 => Some(10003),
        80 => Some(10008),
        81 => Some(10002),
        83 => Some(10005),
        84 => Some(10004),
        85 => Some(10006),
        86 => Some(10081),
        87 => Some(10021),
        88 => Some(10029),
        89 => Some(10007),
        128 => Some(932),
        129 => Some(949),
        130 => Some(1361),
        134 => Some(936),
        136 => Some(950),
        161 => Some(1253),
        162 => Some(1254),
        163 => Some(1258),
        177 => Some(1255),
        178 => Some(1256),
        186 => Some(1257),
        204 => Some(1251),
        222 => Some(874),
        238 => Some(1250),
        254 => Some(437),
        255 => Some(850),
        _ => None,
    }
}

fn encoding_for_codepage(codepage: i32) -> Option<&'static Encoding> {
    let label: &[u8] = match codepage {
        866 => b"ibm866",
        874 => b"windows-874",
        932 => b"shift_jis",
        936 => b"gbk",
        949 => b"euc-kr",
        950 => b"big5",
        1200 => b"utf-16le",
        1201 => b"utf-16be",
        1250 => b"windows-1250",
        1251 => b"windows-1251",
        1252 | 819 => b"windows-1252",
        1253 => b"windows-1253",
        1254 => b"windows-1254",
        1255 => b"windows-1255",
        1256 => b"windows-1256",
        1257 => b"windows-1257",
        1258 => b"windows-1258",
        10000 => b"macintosh",
        10001 => b"x-mac-japanese",
        10007 => b"x-mac-cyrillic",
        20866 => b"koi8-r",
        21866 => b"koi8-u",
        28592 => b"iso-8859-2",
        28593 => b"iso-8859-3",
        28594 => b"iso-8859-4",
        28595 => b"iso-8859-5",
        28596 => b"iso-8859-6",
        28597 => b"iso-8859-7",
        28598 => b"iso-8859-8",
        28600 => b"iso-8859-10",
        28603 => b"iso-8859-13",
        28604 => b"iso-8859-14",
        28605 => b"iso-8859-15",
        28606 => b"iso-8859-16",
        38598 => b"iso-8859-8-i",
        51932 => b"euc-jp",
        51949 => b"euc-kr",
        54936 => b"gb18030",
        65001 => b"utf-8",
        _ => return None,
    };
    Encoding::for_label(label)
}

fn decode_bytes(bytes: &[u8], codepage: i32) -> (String, bool) {
    let encoding = encoding_for_codepage(codepage).unwrap_or(encoding_rs::WINDOWS_1252);
    if encoding.is_ascii_compatible() && bytes.iter().all(u8::is_ascii) {
        return (String::from_utf8_lossy(bytes).into_owned(), false);
    }
    let (text, had_errors) = encoding.decode_without_bom_handling(bytes);
    (text.into_owned(), had_errors)
}

fn image_dimension(
    goal_twips: Option<i32>,
    intrinsic: Option<i32>,
    scale: i32,
    format: ImageFormat,
) -> Option<f64> {
    let base = if let Some(goal) = goal_twips {
        (goal > 0).then_some(twips(goal))
    } else if matches!(format, ImageFormat::Png | ImageFormat::Jpeg) {
        intrinsic.and_then(|pixels| (pixels > 0).then_some(pixels as f64 * 72.0 / 96.0))
    } else {
        None
    }?;
    Some(base * scale.max(0) as f64 / 100.0)
}

fn signature_matches(format: ImageFormat, data: &[u8]) -> bool {
    match format {
        ImageFormat::Png => data.starts_with(b"\x89PNG\r\n\x1a\n"),
        ImageFormat::Jpeg => data.starts_with(&[0xff, 0xd8]) && data.ends_with(&[0xff, 0xd9]),
        ImageFormat::Wmf | ImageFormat::Emf | ImageFormat::Unknown => true,
    }
}
