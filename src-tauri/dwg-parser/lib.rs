/// Debug-print macro for the DWG parser.
///
/// Expands to `eprintln!` only when the `dwg-debug` cargo feature is
/// enabled; otherwise it expands to nothing and the formatting arguments
/// are not evaluated. Used for the verbose `[dwg-dbg]` traces that
/// document the clean-room reverse-engineering work — useful while
/// chasing a new fixture, but noise on a normal parse.
#[macro_export]
macro_rules! dwg_dbg {
    ($($arg:tt)*) => {{
        #[cfg(feature = "dwg-debug")]
        { eprintln!($($arg)*); }
        // In release builds the format args are formally consumed via
        // `format_args!` so that any locals only used inside debug
        // prints are not flagged as unused.
        #[cfg(not(feature = "dwg-debug"))]
        { let _ = format_args!($($arg)*); }
    }};
}

pub mod error;
pub mod bitreader;
pub mod r2007;
pub mod parser;

pub use parser::{DwgParser, DwgFile, DwgObject, DwgClass, DwgVersion};
pub use error::DwgError;

// =============================================================================
// Process-global cancellation flag (Bug 2 wire-through).
// =============================================================================
//
// The host application's loader (`scene_io::load_dwg`) holds an
// `Arc<AtomicBool>` that the UI thread flips when the user clicks the
// loading overlay's Cancel button. The parser runs in a separate crate
// (this one) and has no direct view of that Arc. Two options:
//
//   1. Plumb an `Arc<AtomicBool>` through every parser entry point. Cheap
//      at runtime but invasive — `DwgParser::parse`, the four version
//      dispatchers (R2000/R2004/R2007/R2018), and every object-loop
//      function would need the parameter, and we'd risk merge churn with
//      ongoing parser work happening on the same branch.
//
//   2. Use a process-global `AtomicBool` here that the host loader
//      mirrors before/after each parse call. The parser-side helper
//      `check_cancelled()` is one relaxed atomic load per check (sub-ns
//      on x86), which lets us sprinkle checks freely inside the hot
//      loops without measurable cost.
//
// We go with (2) — strictly simpler. The cost is that two concurrent
// `DwgParser::parse` calls in the same process would share the flag, but
// the host only runs one load at a time per process (`spawn_load_job`
// posts to the UI thread when done before starting another).
//
// Host contract:
//   * Before calling `DwgParser::parse`, set `LOAD_CANCELLED` to the
//     current state of the host's cancel flag (`store(false, Relaxed)`
//     on a fresh load, or `store(true, Relaxed)` if it was already
//     cancelled before we got here).
//   * The host may keep mirroring its `Arc<AtomicBool>` into
//     `LOAD_CANCELLED` while the parse runs (e.g. when the user clicks
//     Cancel mid-parse), or — simpler — install the flag once before
//     `parse` and let the host's UI thread store directly into
//     `LOAD_CANCELLED` from the cancel-button handler.
//   * After `parse` returns (success or cancelled), reset
//     `LOAD_CANCELLED` to false so the next load isn't pre-cancelled.
//
// Parser-side contract: long-running loops poll `check_cancelled()`
// every ~256 iterations and return `DwgError::Cancelled` if set.
pub static LOAD_CANCELLED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Returns true iff a host has flipped `LOAD_CANCELLED` to true. Loops
/// that respect cancellation should bail with `DwgError::Cancelled` when
/// this returns true.
#[inline]
pub fn check_cancelled() -> bool {
    LOAD_CANCELLED.load(std::sync::atomic::Ordering::Relaxed)
}

/// Reset the cancel flag. The host should call this after a parse run
/// completes (regardless of outcome) so a subsequent parse on the same
/// process starts uncancelled.
#[inline]
pub fn reset_cancelled() {
    LOAD_CANCELLED.store(false, std::sync::atomic::Ordering::Relaxed);
}
