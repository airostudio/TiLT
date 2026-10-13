//! Amiga Studio core library.
pub mod adf;
pub mod dms;
pub mod emu_config;
pub mod engine;
pub mod error;
pub mod fsutil;
pub mod hash;
pub mod hdf;
pub mod ipc;
pub mod library;
pub mod matrix;
pub mod profiles;
pub mod rom;
pub mod xcopy;

pub use error::{Error, Result};
