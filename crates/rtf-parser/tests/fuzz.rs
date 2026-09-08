//! Structure-aware mutation of real fixtures, plus replay of every minimized regression.
//!
//! Random bytes rarely form RTF control words, so a mutation campaign that starts from valid
//! documents reaches far more of the parser. This runs in the fast gate with a fixed seed;
//! the open-ended campaign is `cargo +nightly fuzz run parse`, documented in docs/testing.md.

use rtf_parser::parse;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// Generous enough that only a catastrophic regression trips it, not a slow machine.
const PER_INPUT_BUDGET: Duration = Duration::from_secs(5);
const ITERATIONS_PER_SEED: usize = 400;

fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("the crate always sits two levels below the repository root")
}

fn seeds() -> Vec<(String, Vec<u8>)> {
    let root = repository_root();
    let mut seeds = Vec::new();
    for directory in ["fixtures/synthetic", "fixtures/real"] {
        let path = root.join(directory);
        let mut names: Vec<_> = fs::read_dir(&path)
            .unwrap_or_else(|error| panic!("{} should be readable: {error}", path.display()))
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|entry| {
                entry
                    .extension()
                    .is_some_and(|extension| extension == "rtf")
            })
            .collect();
        names.sort();
        for name in names {
            let label = name
                .strip_prefix(&root)
                .unwrap_or(&name)
                .display()
                .to_string();
            seeds.push((label, fs::read(&name).expect("fixture should be readable")));
        }
    }
    assert!(!seeds.is_empty(), "no seed fixtures were found");
    seeds
}

struct Random(u64);

impl Random {
    fn next(&mut self) -> u64 {
        // xorshift64*, so the campaign is identical on every machine and every run.
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    fn below(&mut self, bound: usize) -> usize {
        if bound == 0 {
            0
        } else {
            (self.next() % bound as u64) as usize
        }
    }
}

/// One deterministic edit that keeps the input recognisably RTF-shaped.
fn mutate(random: &mut Random, input: &[u8], other: &[u8]) -> Vec<u8> {
    let mut bytes = input.to_vec();
    if bytes.is_empty() {
        return bytes;
    }
    match random.below(8) {
        0 => bytes.truncate(random.below(bytes.len())),
        1 => {
            let at = random.below(bytes.len());
            bytes[at] ^= 1 << random.below(8);
        }
        2 => {
            let at = random.below(bytes.len());
            bytes.insert(at, random.next() as u8);
        }
        3 => {
            let at = random.below(bytes.len());
            bytes.remove(at);
        }
        4 => {
            // Splice a slice of another document in, which moves whole control words around.
            if !other.is_empty() {
                let from = random.below(other.len());
                let length = random.below(other.len() - from).min(256);
                let at = random.below(bytes.len());
                bytes.splice(at..at, other[from..from + length].iter().copied());
            }
        }
        5 => {
            let at = random.below(bytes.len());
            bytes.insert(
                at,
                if random.next().is_multiple_of(2) {
                    b'{'
                } else {
                    b'}'
                },
            );
        }
        6 => {
            // An extreme control parameter, which is where bounds checks live.
            let at = random.below(bytes.len());
            let extreme: &[u8] = match random.below(4) {
                0 => b"\\bin-1 ",
                1 => b"\\u-32768 ",
                2 => b"\\paperw99999999999 ",
                _ => b"\\cellx-2147483648 ",
            };
            bytes.splice(at..at, extreme.iter().copied());
        }
        _ => {
            let at = random.below(bytes.len());
            bytes.splice(at..at, b"\\'".iter().copied());
        }
    }
    bytes
}

/// A model that parsed must be usable: layout multiplies these numbers.
fn assert_finite(document: &rtf_parser::DocumentModel) {
    let page = &document.page;
    for value in [
        page.width,
        page.height,
        page.margin_left,
        page.margin_right,
        page.margin_top,
        page.margin_bottom,
        document.default_tab,
    ] {
        assert!(value.is_finite(), "page geometry must stay finite");
    }
    for block in &document.blocks {
        if let rtf_parser::Block::Row { cells, left, .. } = block {
            assert!(left.is_finite(), "row offset must stay finite");
            for cell in cells {
                assert!(cell.right.is_finite(), "cell boundary must stay finite");
                for value in [
                    cell.padding.left,
                    cell.padding.top,
                    cell.padding.right,
                    cell.padding.bottom,
                ] {
                    assert!(value.is_finite(), "cell padding must stay finite");
                }
            }
        }
    }
}

fn check(label: &str, bytes: &[u8]) {
    let started = Instant::now();
    let outcome = std::panic::catch_unwind(|| parse(bytes));
    let elapsed = started.elapsed();
    let Ok(result) = outcome else {
        panic!("parser panicked on {label} ({} bytes)", bytes.len());
    };
    assert!(
        elapsed < PER_INPUT_BUDGET,
        "{label} took {elapsed:?}, over the {PER_INPUT_BUDGET:?} budget"
    );
    if let Ok(document) = result {
        assert_finite(&document);
    }
}

#[test]
fn mutated_fixtures_never_panic_or_produce_unusable_geometry() {
    let seeds = seeds();
    let mut random = Random(0x2026_0908_0000_0001);
    for (index, (label, bytes)) in seeds.iter().enumerate() {
        let other = &seeds[(index + 1) % seeds.len()].1;
        for iteration in 0..ITERATIONS_PER_SEED {
            let mutated = mutate(&mut random, bytes, other);
            check(&format!("{label} mutation {iteration}"), &mutated);
        }
    }
}

#[test]
fn every_minimized_regression_still_parses_without_panic() {
    let directory = repository_root().join("fuzz/regressions");
    let mut inputs: Vec<_> = fs::read_dir(&directory)
        .unwrap_or_else(|error| panic!("{} should exist: {error}", directory.display()))
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|entry| {
            entry
                .extension()
                .is_some_and(|extension| extension == "rtf")
        })
        .collect();
    inputs.sort();
    for input in inputs {
        let bytes = fs::read(&input).expect("regression should be readable");
        check(&input.display().to_string(), &bytes);
    }
}
