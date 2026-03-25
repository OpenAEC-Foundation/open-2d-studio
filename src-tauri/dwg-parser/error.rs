/// Errors that can occur during DWG parsing.
#[derive(Debug)]
pub enum DwgError {
    /// JSON serialization/deserialization error.
    Json(serde_json::Error),

    /// I/O error.
    Io(std::io::Error),

    /// Invalid or corrupt DWG binary data.
    InvalidBinary(String),

    /// Feature not yet implemented.
    NotImplemented(String),
}

impl std::fmt::Display for DwgError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DwgError::Json(e) => write!(f, "JSON error: {}", e),
            DwgError::Io(e) => write!(f, "I/O error: {}", e),
            DwgError::InvalidBinary(msg) => write!(f, "Invalid DWG binary: {}", msg),
            DwgError::NotImplemented(msg) => write!(f, "Not implemented: {}", msg),
        }
    }
}

impl std::error::Error for DwgError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            DwgError::Json(e) => Some(e),
            DwgError::Io(e) => Some(e),
            _ => None,
        }
    }
}

impl From<serde_json::Error> for DwgError {
    fn from(e: serde_json::Error) -> Self {
        DwgError::Json(e)
    }
}

impl From<std::io::Error> for DwgError {
    fn from(e: std::io::Error) -> Self {
        DwgError::Io(e)
    }
}
