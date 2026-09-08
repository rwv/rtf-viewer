use std::{env, fs, process::ExitCode};

fn main() -> ExitCode {
    let Some(path) = env::args_os().nth(1) else {
        eprintln!("usage: cargo run -p rtf-parser --example inspect -- <file.rtf>");
        return ExitCode::from(2);
    };
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) => {
            eprintln!("could not read {:?}: {error}", path);
            return ExitCode::FAILURE;
        }
    };
    match rtf_parser::parse(&bytes).and_then(|model| {
        serde_json::to_string_pretty(&model)
            .map_err(|error| rtf_parser::ParseError::Serialization(error.to_string()))
    }) {
        Ok(json) => {
            println!("{json}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
