use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct DocumentModel {
    pub schema_version: u32,
    pub page: PageGeometry,
    pub default_tab: f64,
    pub fonts: Vec<FontDef>,
    pub colors: Vec<Option<String>>,
    pub blocks: Vec<Block>,
    pub images: Vec<ImageResource>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct PageGeometry {
    pub width: f64,
    pub height: f64,
    pub margin_left: f64,
    pub margin_right: f64,
    pub margin_top: f64,
    pub margin_bottom: f64,
}

impl Default for PageGeometry {
    fn default() -> Self {
        Self {
            width: 612.0,
            height: 792.0,
            margin_left: 90.0,
            margin_right: 90.0,
            margin_top: 72.0,
            margin_bottom: 72.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct FontDef {
    pub id: i32,
    pub name: String,
    pub charset: Option<i32>,
    pub codepage: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Block {
    Paragraph {
        runs: Vec<Run>,
        style: ParagraphStyle,
        mark_style: TextStyle,
    },
    PageBreak,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Run {
    Text { text: String, style: TextStyle },
    Image { image_id: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TextStyle {
    pub font_id: i32,
    pub font_size: f64,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
    pub color: Option<u32>,
    pub highlight: Option<u32>,
    pub hidden: bool,
    pub baseline: f64,
}

impl Default for TextStyle {
    fn default() -> Self {
        Self {
            font_id: 0,
            font_size: 12.0,
            bold: false,
            italic: false,
            underline: false,
            strike: false,
            color: None,
            highlight: None,
            hidden: false,
            baseline: 0.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum ParagraphAlign {
    Left,
    Center,
    Right,
    Justify,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
#[ts(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum LineSpacing {
    Auto,
    Exact(f64),
    AtLeast(f64),
    Multiple(f64),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ParagraphStyle {
    pub align: ParagraphAlign,
    pub left_indent: f64,
    pub right_indent: f64,
    pub first_line_indent: f64,
    pub space_before: f64,
    pub space_after: f64,
    pub line_spacing: LineSpacing,
    pub page_break_before: bool,
}

impl Default for ParagraphStyle {
    fn default() -> Self {
        Self {
            align: ParagraphAlign::Left,
            left_indent: 0.0,
            right_indent: 0.0,
            first_line_indent: 0.0,
            space_before: 0.0,
            space_after: 0.0,
            line_spacing: LineSpacing::Auto,
            page_break_before: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum ImageFormat {
    Png,
    Jpeg,
    Wmf,
    Emf,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ImageResource {
    pub id: String,
    pub format: ImageFormat,
    pub data: Vec<u8>,
    pub width: Option<f64>,
    pub height: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct Diagnostic {
    pub code: String,
    pub message: String,
    #[ts(type = "number")]
    pub offset: usize,
}
