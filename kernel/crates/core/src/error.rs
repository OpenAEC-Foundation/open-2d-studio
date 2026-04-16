//! Kernel-wide error types.

use thiserror::Error;

pub type KernelResult<T> = Result<T, KernelError>;

#[derive(Debug, Error)]
pub enum KernelError {
    #[error("shape {0:?} not found")]
    ShapeNotFound(crate::ShapeId),

    #[error("entity has no {component} component")]
    MissingComponent { component: &'static str },

    #[error("invalid state: {0}")]
    InvalidState(String),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),
}
