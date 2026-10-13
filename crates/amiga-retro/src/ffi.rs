//! Hand-written subset of libretro.h (numbers checked against the header shipped with Amiberry 8.4.0).

use std::ffi::{c_char, c_uint, c_void};

pub type EnvironmentCb = unsafe extern "C" fn(cmd: c_uint, data: *mut c_void) -> bool;
pub type VideoRefreshCb = unsafe extern "C" fn(data: *const c_void, width: c_uint, height: c_uint, pitch: usize);
pub type AudioSampleCb = unsafe extern "C" fn(left: i16, right: i16);
pub type AudioBatchCb = unsafe extern "C" fn(data: *const i16, frames: usize) -> usize;
pub type InputPollCb = unsafe extern "C" fn();
pub type InputStateCb = unsafe extern "C" fn(port: c_uint, device: c_uint, index: c_uint, id: c_uint) -> i16;
pub type KeyboardEventCb = unsafe extern "C" fn(down: bool, keycode: c_uint, character: u32, modifiers: u16);

#[repr(C)]
pub struct SystemInfo {
    pub library_name: *const c_char,
    pub library_version: *const c_char,
    pub valid_extensions: *const c_char,
    pub need_fullpath: bool,
    pub block_extract: bool,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct GameGeometry {
    pub base_width: c_uint,
    pub base_height: c_uint,
    pub max_width: c_uint,
    pub max_height: c_uint,
    pub aspect_ratio: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct SystemTiming {
    pub fps: f64,
    pub sample_rate: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct SystemAvInfo {
    pub geometry: GameGeometry,
    pub timing: SystemTiming,
}

#[repr(C)]
pub struct GameInfo {
    pub path: *const c_char,
    pub data: *const c_void,
    pub size: usize,
    pub meta: *const c_char,
}

#[repr(C)]
pub struct Variable {
    pub key: *const c_char,
    pub value: *const c_char,
}

#[repr(C)]
pub struct Message {
    pub msg: *const c_char,
    pub frames: c_uint,
}

#[repr(C)]
pub struct MessageExt {
    pub msg: *const c_char,
    pub duration: c_uint,
    pub priority: c_uint,
    pub level: c_uint,
    pub target: c_uint,
    pub kind: c_uint,
    pub progress: i8,
}

pub type SetEjectStateFn = unsafe extern "C" fn(bool) -> bool;
pub type GetEjectStateFn = unsafe extern "C" fn() -> bool;
pub type GetImageIndexFn = unsafe extern "C" fn() -> c_uint;
pub type SetImageIndexFn = unsafe extern "C" fn(c_uint) -> bool;
pub type GetNumImagesFn = unsafe extern "C" fn() -> c_uint;
pub type ReplaceImageIndexFn = unsafe extern "C" fn(c_uint, *const GameInfo) -> bool;
pub type AddImageIndexFn = unsafe extern "C" fn() -> bool;

/// `retro_disk_control_callback` and the first seven fields of the `_ext` variant share a layout.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct DiskControl {
    pub set_eject_state: Option<SetEjectStateFn>,
    pub get_eject_state: Option<GetEjectStateFn>,
    pub get_image_index: Option<GetImageIndexFn>,
    pub set_image_index: Option<SetImageIndexFn>,
    pub get_num_images: Option<GetNumImagesFn>,
    pub replace_image_index: Option<ReplaceImageIndexFn>,
    pub add_image_index: Option<AddImageIndexFn>,
}

// environment commands
pub const ENV_GET_OVERSCAN: u32 = 2;
pub const ENV_GET_CAN_DUPE: u32 = 3;
pub const ENV_SET_MESSAGE: u32 = 6;
pub const ENV_SHUTDOWN: u32 = 7;
pub const ENV_SET_PERFORMANCE_LEVEL: u32 = 8;
pub const ENV_GET_SYSTEM_DIRECTORY: u32 = 9;
pub const ENV_SET_PIXEL_FORMAT: u32 = 10;
pub const ENV_SET_INPUT_DESCRIPTORS: u32 = 11;
pub const ENV_SET_KEYBOARD_CALLBACK: u32 = 12;
pub const ENV_SET_DISK_CONTROL_INTERFACE: u32 = 13;
pub const ENV_GET_VARIABLE: u32 = 15;
pub const ENV_SET_VARIABLES: u32 = 16;
pub const ENV_GET_VARIABLE_UPDATE: u32 = 17;
pub const ENV_SET_SUPPORT_NO_GAME: u32 = 18;
pub const ENV_GET_LIBRETRO_PATH: u32 = 19;
pub const ENV_GET_INPUT_DEVICE_CAPABILITIES: u32 = 24;
pub const ENV_GET_CORE_ASSETS_DIRECTORY: u32 = 30;
pub const ENV_GET_SAVE_DIRECTORY: u32 = 31;
pub const ENV_SET_SYSTEM_AV_INFO: u32 = 32;
pub const ENV_SET_CONTROLLER_INFO: u32 = 35;
pub const ENV_SET_GEOMETRY: u32 = 37;
pub const ENV_GET_LANGUAGE: u32 = 39;
pub const ENV_SET_SERIALIZATION_QUIRKS: u32 = 44;
pub const ENV_GET_CORE_OPTIONS_VERSION: u32 = 52;
pub const ENV_SET_CORE_OPTIONS: u32 = 53;
pub const ENV_SET_CORE_OPTIONS_INTL: u32 = 54;
pub const ENV_SET_CORE_OPTIONS_DISPLAY: u32 = 55;
pub const ENV_GET_DISK_CONTROL_INTERFACE_VERSION: u32 = 57;
pub const ENV_SET_DISK_CONTROL_EXT_INTERFACE: u32 = 58;
pub const ENV_GET_MESSAGE_INTERFACE_VERSION: u32 = 59;
pub const ENV_SET_MESSAGE_EXT: u32 = 60;
pub const ENV_GET_INPUT_MAX_USERS: u32 = 61;
pub const ENV_SET_MINIMUM_AUDIO_LATENCY: u32 = 63;
pub const ENV_SET_CORE_OPTIONS_V2: u32 = 67;
pub const ENV_SET_CORE_OPTIONS_V2_INTL: u32 = 68;
pub const ENV_SET_VARIABLE: u32 = 70;
pub const ENV_GET_JIT_CAPABLE: u32 = 74;

// pixel formats
pub const PIXEL_0RGB1555: u32 = 0;
pub const PIXEL_XRGB8888: u32 = 1;
pub const PIXEL_RGB565: u32 = 2;

// devices
pub const DEVICE_JOYPAD: u32 = 1;
pub const DEVICE_MOUSE: u32 = 2;
pub const DEVICE_KEYBOARD: u32 = 3;

pub const MOUSE_X: u32 = 0;
pub const MOUSE_Y: u32 = 1;
pub const MOUSE_LEFT: u32 = 2;
pub const MOUSE_RIGHT: u32 = 3;
pub const MOUSE_MIDDLE: u32 = 6;

pub const JOYPAD_UP: u32 = 4;
pub const JOYPAD_DOWN: u32 = 5;
pub const JOYPAD_LEFT: u32 = 6;
pub const JOYPAD_RIGHT: u32 = 7;
pub const JOYPAD_A: u32 = 8; // fire 1
pub const JOYPAD_B: u32 = 0; // fire 2

pub const KEYBOARD_MAX: usize = 512;
