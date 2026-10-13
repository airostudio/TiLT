//! A minimal libretro **frontend** that hosts the Amiberry libretro core in this process.
//!
//! Why: official Windows builds of the standalone Amiberry have no control channel (ADR-0001). The
//! Amiberry *libretro core* (published for every release, including `amiberry-libretro-win-x86_64.dll`)
//! is driven through the standard libretro API instead, which gives us - on any platform - the video
//! frames (embedded display), audio samples, keyboard/mouse/joypad injection, pause, reset, save
//! states and floppy swapping through the libretro disk-control interface.
//!
//! Known limit of that interface (verified against the core source): disk control swaps **DF0 only**;
//! DF1-DF3 can be configured at start-up (`.uae` content) but not hot-swapped.
//!
//! libretro callbacks are plain C function pointers without a user-data argument, so this crate keeps
//! its state in one process-wide static and supports **one running core at a time**.

mod ffi;
mod host;

pub use host::{Frame, RetroConfig, RetroHandle, RetroStats};

#[derive(Debug, thiserror::Error)]
pub enum RetroError {
    #[error("cannot load the libretro core: {0}")]
    Load(String),
    #[error("the core refused to load the content: {0}")]
    Content(String),
    #[error("a core is already running in this process")]
    Busy,
    #[error("the core is not running")]
    NotRunning,
    #[error("the core reported a failure: {0}")]
    Core(String),
}

pub type Result<T> = std::result::Result<T, RetroError>;

/// Joypad button ids for [`RetroHandle::joypad`] (libretro `RETRO_DEVICE_ID_JOYPAD_*`).
pub mod joypad {
    pub use crate::ffi::{
        JOYPAD_A as FIRE1, JOYPAD_B as FIRE2, JOYPAD_DOWN as DOWN, JOYPAD_LEFT as LEFT, JOYPAD_RIGHT as RIGHT,
        JOYPAD_UP as UP,
    };
}
