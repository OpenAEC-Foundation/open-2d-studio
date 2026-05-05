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
