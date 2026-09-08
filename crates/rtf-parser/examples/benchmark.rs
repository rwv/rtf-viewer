//! Repeatable parse latency and peak-allocation baseline for large documents.
//!
//! Run with `cargo run --release -p rtf-parser --example benchmark`. Every shape is generated
//! from a fixed recipe, so two runs on the same machine are comparable and two machines differ
//! only by their own speed. Exits non-zero when a shape exceeds its documented budget.

use std::alloc::{GlobalAlloc, Layout, System};
use std::fmt::Write as _;
use std::process::ExitCode;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

struct Counting;

/// Tracks live bytes so the report shows the peak the parser actually holds, not total churn.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let pointer = unsafe { System.alloc(layout) };
        if !pointer.is_null() {
            let live = LIVE.fetch_add(layout.size(), Ordering::Relaxed) + layout.size();
            PEAK.fetch_max(live, Ordering::Relaxed);
        }
        pointer
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
        unsafe { System.dealloc(pointer, layout) };
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

/// Budgets are what the project is willing to ship for a document of this size, not the
/// current measurement plus a margin: roughly fifteen times the observed latency and two and a
/// half times the observed peak, so a real regression trips them and machine noise does not.
const BUDGET_LATENCY: Duration = Duration::from_millis(300);
const BUDGET_PEAK: usize = 48 << 20;

struct Shape {
    name: &'static str,
    /// Wall-clock budget for one parse, generous enough to survive a slow shared runner.
    latency: Duration,
    /// Peak live bytes budget, which is what actually bounds a browser tab.
    peak: usize,
    build: fn() -> Vec<u8>,
}

fn prose(paragraphs: usize) -> Vec<u8> {
    let mut out = String::from(r"{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\froman Serif;}}\fs24 ");
    for index in 0..paragraphs {
        let _ = write!(
            out,
            r"Paragraph {index} carries enough words to wrap several times across a normal measure, which is what a long report actually looks like.\par "
        );
    }
    out.push('}');
    out.into_bytes()
}

fn table(rows: usize) -> Vec<u8> {
    let mut out = String::from(r"{\rtf1\ansi\deff0{\fonttbl{\f0\froman Serif;}}\fs24 ");
    for index in 0..rows {
        out.push_str(
            r"\trowd\trgaph108\trbrdrt\brdrs\brdrw10\trbrdrl\brdrs\brdrw10\trbrdrb\brdrs\brdrw10\
\trbrdrr\brdrs\brdrw10\clpadfl3\clpadl108\cellx3000\clpadfl3\clpadl108\cellx6000\
\clpadfl3\clpadl108\cellx9000",
        );
        let _ = write!(
            out,
            r"\intbl Row {index} first\cell Row {index} second\cell Row {index} third\cell\row "
        );
    }
    out.push('}');
    out.into_bytes()
}

fn list(items: usize) -> Vec<u8> {
    let mut out = String::from(
        r"{\rtf1\ansi\deff0{\fonttbl{\f0\froman Serif;}}\
{\*\listtable{\list{\listlevel\levelnfc0\levelstartat1{\leveltext \'02\'00.;}\
{\levelnumbers\'01;}\fi-360\li720}\listid1}}\
{\*\listoverridetable{\listoverride\listid1\ls1}}\fs24 ",
    );
    for index in 0..items {
        let _ = write!(
            out,
            r"\ls1\ilvl0 Item {index} of a long numbered list.\par "
        );
    }
    out.push('}');
    out.into_bytes()
}

fn unicode(paragraphs: usize) -> Vec<u8> {
    let mut out = String::from(
        r"{\rtf1\ansi\ansicpg936\deff0\uc1{\fonttbl{\f0\fnil\fcharset134 SimSun;}}\fs24 ",
    );
    for index in 0..paragraphs {
        let _ = write!(out, r" 3?▙1?➗9?㕹7? {index}\par ");
    }
    out.push('}');
    out.into_bytes()
}

struct Measurement {
    input: usize,
    median: Duration,
    peak: usize,
    blocks: usize,
}

/// A shape that fails to parse is a broken benchmark, not a fast one: the rejection path is
/// cheap and would silently look like a pass.
fn measure(shape: &Shape) -> Result<Measurement, rtf_parser::ParseError> {
    let bytes = (shape.build)();
    // One warm parse first, so the reported timing is not the allocator's first growth.
    let blocks = rtf_parser::parse(&bytes)?.blocks.len();
    let mut timings = Vec::new();
    let mut peak = 0;
    for _ in 0..5 {
        LIVE.store(0, Ordering::Relaxed);
        PEAK.store(0, Ordering::Relaxed);
        let started = Instant::now();
        let parsed = rtf_parser::parse(&bytes);
        timings.push(started.elapsed());
        peak = peak.max(PEAK.load(Ordering::Relaxed));
        parsed?;
    }
    timings.sort();
    Ok(Measurement {
        input: bytes.len(),
        median: timings[timings.len() / 2],
        peak,
        blocks,
    })
}

fn main() -> ExitCode {
    let shapes = [
        Shape {
            name: "prose, 12000 paragraphs",
            latency: BUDGET_LATENCY,
            peak: BUDGET_PEAK,
            build: || prose(12_000),
        },
        Shape {
            name: "tables, 5000 rows",
            latency: BUDGET_LATENCY,
            peak: BUDGET_PEAK,
            build: || table(5_000),
        },
        Shape {
            name: "list, 20000 items",
            latency: BUDGET_LATENCY,
            peak: BUDGET_PEAK,
            build: || list(20_000),
        },
        Shape {
            name: "unicode, 12000 paragraphs",
            latency: BUDGET_LATENCY,
            peak: BUDGET_PEAK,
            build: || unicode(12_000),
        },
    ];

    println!(
        "{:<26} {:>10} {:>10} {:>12} {:>12} {:>10}",
        "shape", "input KiB", "blocks", "median ms", "peak KiB", "verdict"
    );
    let mut failed = false;
    for shape in &shapes {
        match measure(shape) {
            Ok(measurement) => {
                let within = measurement.median <= shape.latency && measurement.peak <= shape.peak;
                failed |= !within;
                println!(
                    "{:<26} {:>10} {:>10} {:>12.1} {:>12} {:>10}",
                    shape.name,
                    measurement.input / 1024,
                    measurement.blocks,
                    measurement.median.as_secs_f64() * 1000.0,
                    measurement.peak / 1024,
                    if within { "within" } else { "OVER" }
                );
            }
            Err(error) => {
                failed = true;
                println!("{:<26} {:>58}", shape.name, format!("FAILED: {error}"));
            }
        }
    }
    if failed {
        eprintln!("at least one shape exceeded its documented budget");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
