mod model;
mod parser;

pub use model::*;
pub use parser::{ParseError, parse};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn parse_rtf(bytes: &[u8]) -> Result<String, JsValue> {
    let model = parse(bytes).map_err(|error| JsValue::from_str(&error.to_string()))?;
    serde_json::to_string(&model).map_err(|error| JsValue::from_str(&error.to_string()))
}
