//! Error type shared by every module. Errors carry a stable machine-readable
//! `code` so the UI can show friendly, translated messages while logs keep the
//! technical detail.

use serde::Serialize;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("invalid ROM: {0}")]
    InvalidRom(String),
    #[error("invalid disk image: {0}")]
    InvalidDisk(String),
    #[error("invalid hard disk image: {0}")]
    InvalidHdf(String),
    #[error("DMS archive error: {0}")]
    Dms(String),
    #[error("invalid machine profile: {0}")]
    InvalidProfile(String),
    #[error("not enough free disk space: need {needed} bytes, only {available} available")]
    InsufficientSpace { needed: u64, available: u64 },
    #[error("{0} is in use by another operation or emulator session")]
    Locked(String),
    #[error("refusing unsafe operation: {0}")]
    Unsafe(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("already exists: {0}")]
    AlreadyExists(String),
    #[error("operation cancelled")]
    Cancelled,
    #[error("emulator error: {0}")]
    Emulator(String),
    #[error("feature not available on this platform: {0}")]
    Unsupported(String),
}

impl Error {
    pub fn code(&self) -> &'static str {
        match self {
            Error::Io(_) => "io",
            Error::Db(_) => "database",
            Error::InvalidRom(_) => "invalid_rom",
            Error::InvalidDisk(_) => "invalid_disk",
            Error::InvalidHdf(_) => "invalid_hdf",
            Error::Dms(_) => "dms",
            Error::InvalidProfile(_) => "invalid_profile",
            Error::InsufficientSpace { .. } => "insufficient_space",
            Error::Locked(_) => "locked",
            Error::Unsafe(_) => "unsafe",
            Error::NotFound(_) => "not_found",
            Error::AlreadyExists(_) => "already_exists",
            Error::Cancelled => "cancelled",
            Error::Emulator(_) => "emulator",
            Error::Unsupported(_) => "unsupported",
        }
    }
}

/// Serialisable form handed to the front end.
#[derive(Debug, Clone, Serialize)]
pub struct ErrorDto {
    pub code: &'static str,
    pub message: String,
}

impl From<&Error> for ErrorDto {
    fn from(e: &Error) -> Self {
        ErrorDto { code: e.code(), message: e.to_string() }
    }
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        ErrorDto::from(self).serialize(s)
    }
}
