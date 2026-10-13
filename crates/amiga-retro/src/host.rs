//! The libretro host: one emulation thread owns the core; everything else talks to it through
//! shared state (video/audio/input) and a command channel (reset, states, disk swaps).

use crate::ffi::*;
use crate::{Result, RetroError};
use libloading::Library;
use std::collections::{HashMap, VecDeque};
use std::ffi::{c_uint, c_void, CStr, CString};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct RetroConfig {
    pub core: PathBuf,
    pub system_dir: PathBuf,
    pub save_dir: PathBuf,
    /// `.uae` configuration, disk image or hard disk the core should load.
    pub content: PathBuf,
    /// Core option overrides answered to `GET_VARIABLE`.
    pub options: Vec<(String, String)>,
}

#[derive(Debug, Clone, Default)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    /// RGBA, 8 bits per channel.
    pub rgba: Vec<u8>,
    /// Increases with every new picture.
    pub seq: u64,
}

#[derive(Debug, Clone, Default)]
pub struct RetroStats {
    pub fps_target: f64,
    pub sample_rate: f64,
    pub frames_run: u64,
    pub audio_frames: u64,
    /// Peak absolute sample value in the most recent audio batch (0 = silence).
    pub audio_peak: i32,
    pub geometry: (u32, u32),
    pub aspect: f32,
    pub paused: bool,
    pub measured_fps: f64,
}

#[derive(Default)]
struct InputState {
    keys: Vec<bool>,
    pending_dx: i32,
    pending_dy: i32,
    frame_dx: i32,
    frame_dy: i32,
    buttons: [bool; 8],
    joy: [[bool; 16]; 2],
}

struct Shared {
    pixel_format: AtomicU32,
    frame: Mutex<Frame>,
    seq: AtomicU64,
    audio: Mutex<VecDeque<i16>>,
    audio_frames: AtomicU64,
    audio_peak: AtomicU32,
    input: Mutex<InputState>,
    messages: Mutex<Vec<String>>,
    disk: Mutex<Option<DiskControl>>,
    kb_cb: Mutex<Option<KeyboardEventCb>>,
    av: Mutex<SystemAvInfo>,
    options: HashMap<String, CString>,
    system_dir: CString,
    save_dir: CString,
    core_path: CString,
    paused: AtomicBool,
    frames_run: AtomicU64,
    measured_fps_milli: AtomicU64,
    shutdown_requested: AtomicBool,
}

static ACTIVE: Mutex<Option<Arc<Shared>>> = Mutex::new(None);

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}
fn active() -> Option<Arc<Shared>> {
    lock(&ACTIVE).clone()
}

// ------------------------------------------------------------------ libretro callbacks

unsafe extern "C" fn cb_environment(cmd: c_uint, data: *mut c_void) -> bool {
    let Some(s) = active() else { return false };
    let cmd = cmd & !0x10000; // strip the "experimental" flag
    match cmd {
        ENV_GET_CAN_DUPE => {
            *(data as *mut bool) = true;
            true
        }
        ENV_GET_OVERSCAN => {
            *(data as *mut bool) = false;
            true
        }
        ENV_SET_PIXEL_FORMAT => {
            let f = *(data as *const u32);
            if matches!(f, PIXEL_0RGB1555 | PIXEL_XRGB8888 | PIXEL_RGB565) {
                s.pixel_format.store(f, Ordering::SeqCst);
                true
            } else {
                false
            }
        }
        ENV_GET_SYSTEM_DIRECTORY | ENV_GET_CORE_ASSETS_DIRECTORY => {
            *(data as *mut *const std::ffi::c_char) = s.system_dir.as_ptr();
            true
        }
        ENV_GET_SAVE_DIRECTORY => {
            *(data as *mut *const std::ffi::c_char) = s.save_dir.as_ptr();
            true
        }
        ENV_GET_LIBRETRO_PATH => {
            *(data as *mut *const std::ffi::c_char) = s.core_path.as_ptr();
            true
        }
        ENV_GET_VARIABLE => {
            let v = &mut *(data as *mut Variable);
            let key = CStr::from_ptr(v.key).to_string_lossy();
            match s.options.get(key.as_ref()) {
                Some(val) => {
                    v.value = val.as_ptr();
                    true
                }
                None => {
                    v.value = std::ptr::null();
                    false
                }
            }
        }
        ENV_GET_VARIABLE_UPDATE => {
            *(data as *mut bool) = false;
            true
        }
        ENV_SET_VARIABLES
        | ENV_SET_CORE_OPTIONS
        | ENV_SET_CORE_OPTIONS_INTL
        | ENV_SET_CORE_OPTIONS_V2
        | ENV_SET_CORE_OPTIONS_V2_INTL
        | ENV_SET_CORE_OPTIONS_DISPLAY
        | ENV_SET_VARIABLE => true,
        ENV_GET_CORE_OPTIONS_VERSION => {
            *(data as *mut u32) = 0; // plain SET_VARIABLES is enough: we answer only explicit overrides
            true
        }
        ENV_SET_MESSAGE => {
            let m = &*(data as *const Message);
            if !m.msg.is_null() {
                lock(&s.messages).push(CStr::from_ptr(m.msg).to_string_lossy().into_owned());
            }
            true
        }
        ENV_SET_MESSAGE_EXT => {
            let m = &*(data as *const MessageExt);
            if !m.msg.is_null() {
                lock(&s.messages).push(CStr::from_ptr(m.msg).to_string_lossy().into_owned());
            }
            true
        }
        ENV_GET_MESSAGE_INTERFACE_VERSION => {
            *(data as *mut u32) = 1;
            true
        }
        ENV_GET_DISK_CONTROL_INTERFACE_VERSION => {
            *(data as *mut u32) = 1;
            true
        }
        ENV_SET_DISK_CONTROL_INTERFACE | ENV_SET_DISK_CONTROL_EXT_INTERFACE => {
            *lock(&s.disk) = Some(*(data as *const DiskControl));
            true
        }
        ENV_SET_KEYBOARD_CALLBACK => {
            #[repr(C)]
            struct KbCb {
                callback: Option<KeyboardEventCb>,
            }
            *lock(&s.kb_cb) = (*(data as *const KbCb)).callback;
            true
        }
        ENV_SET_GEOMETRY => {
            lock(&s.av).geometry = *(data as *const GameGeometry);
            true
        }
        ENV_SET_SYSTEM_AV_INFO => {
            *lock(&s.av) = *(data as *const SystemAvInfo);
            true
        }
        ENV_GET_INPUT_DEVICE_CAPABILITIES => {
            *(data as *mut u64) = (1 << DEVICE_JOYPAD) | (1 << DEVICE_MOUSE) | (1 << DEVICE_KEYBOARD);
            true
        }
        ENV_GET_INPUT_MAX_USERS => {
            *(data as *mut c_uint) = 2;
            true
        }
        ENV_GET_LANGUAGE => {
            *(data as *mut c_uint) = 0; // English
            true
        }
        ENV_GET_JIT_CAPABLE => {
            *(data as *mut bool) = true;
            true
        }
        ENV_SHUTDOWN => {
            s.shutdown_requested.store(true, Ordering::SeqCst);
            true
        }
        ENV_SET_PERFORMANCE_LEVEL
        | ENV_SET_INPUT_DESCRIPTORS
        | ENV_SET_CONTROLLER_INFO
        | ENV_SET_SUPPORT_NO_GAME
        | ENV_SET_SERIALIZATION_QUIRKS
        | ENV_SET_MINIMUM_AUDIO_LATENCY => true,
        _ => false, // log interface, perf, HW render, VFS, ... are not offered
    }
}

unsafe extern "C" fn cb_video(data: *const c_void, width: c_uint, height: c_uint, pitch: usize) {
    if data.is_null() || width == 0 || height == 0 {
        return; // duplicate frame
    }
    let Some(s) = active() else { return };
    let (w, h) = (width as usize, height as usize);
    let mut rgba = vec![255u8; w * h * 4];
    let fmt = s.pixel_format.load(Ordering::SeqCst);
    let base = data as *const u8;
    for y in 0..h {
        let row = base.add(y * pitch);
        for x in 0..w {
            let o = (y * w + x) * 4;
            match fmt {
                PIXEL_XRGB8888 => {
                    let p = row.add(x * 4);
                    rgba[o] = *p.add(2);
                    rgba[o + 1] = *p.add(1);
                    rgba[o + 2] = *p;
                }
                PIXEL_RGB565 => {
                    let v = u16::from_le_bytes([*row.add(x * 2), *row.add(x * 2 + 1)]);
                    rgba[o] = (((v >> 11) & 31) as u32 * 255 / 31) as u8;
                    rgba[o + 1] = (((v >> 5) & 63) as u32 * 255 / 63) as u8;
                    rgba[o + 2] = ((v & 31) as u32 * 255 / 31) as u8;
                }
                _ => {
                    let v = u16::from_le_bytes([*row.add(x * 2), *row.add(x * 2 + 1)]);
                    rgba[o] = (((v >> 10) & 31) as u32 * 255 / 31) as u8;
                    rgba[o + 1] = (((v >> 5) & 31) as u32 * 255 / 31) as u8;
                    rgba[o + 2] = ((v & 31) as u32 * 255 / 31) as u8;
                }
            }
        }
    }
    let seq = s.seq.fetch_add(1, Ordering::SeqCst) + 1;
    *lock(&s.frame) = Frame { width, height, rgba, seq };
}

const AUDIO_CAP_SAMPLES: usize = 48_000 * 2 * 2; // two seconds of stereo

fn push_audio(s: &Shared, samples: &[i16]) {
    let mut q = lock(&s.audio);
    q.extend(samples.iter().copied());
    while q.len() > AUDIO_CAP_SAMPLES {
        q.pop_front();
    }
    drop(q);
    s.audio_frames.fetch_add((samples.len() / 2) as u64, Ordering::SeqCst);
    let peak = samples.iter().map(|v| (*v as i32).unsigned_abs()).max().unwrap_or(0);
    s.audio_peak.store(peak, Ordering::SeqCst);
}

unsafe extern "C" fn cb_audio_sample(l: i16, r: i16) {
    if let Some(s) = active() {
        push_audio(&s, &[l, r]);
    }
}

unsafe extern "C" fn cb_audio_batch(data: *const i16, frames: usize) -> usize {
    if let Some(s) = active() {
        if !data.is_null() {
            push_audio(&s, std::slice::from_raw_parts(data, frames * 2));
        }
    }
    frames
}

unsafe extern "C" fn cb_input_poll() {
    if let Some(s) = active() {
        let mut i = lock(&s.input);
        i.frame_dx = std::mem::take(&mut i.pending_dx);
        i.frame_dy = std::mem::take(&mut i.pending_dy);
    }
}

unsafe extern "C" fn cb_input_state(port: c_uint, device: c_uint, _index: c_uint, id: c_uint) -> i16 {
    let Some(s) = active() else { return 0 };
    let i = lock(&s.input);
    match device {
        DEVICE_MOUSE if port == 0 => match id {
            MOUSE_X => i.frame_dx.clamp(-32768, 32767) as i16,
            MOUSE_Y => i.frame_dy.clamp(-32768, 32767) as i16,
            MOUSE_LEFT => i.buttons[0] as i16,
            MOUSE_RIGHT => i.buttons[1] as i16,
            MOUSE_MIDDLE => i.buttons[2] as i16,
            _ => 0,
        },
        DEVICE_JOYPAD if (port as usize) < 2 && (id as usize) < 16 => i.joy[port as usize][id as usize] as i16,
        DEVICE_KEYBOARD => i.keys.get(id as usize).copied().unwrap_or(false) as i16,
        _ => 0,
    }
}

// ------------------------------------------------------------------ commands

enum DiskOp {
    Eject,
    /// Insert an image into DF0 (libretro disk control addresses DF0 only).
    Insert(PathBuf),
}

enum Cmd {
    Reset,
    SaveState(Sender<Result<Vec<u8>>>),
    LoadState(Vec<u8>, Sender<Result<()>>),
    Disk(DiskOp, Sender<Result<()>>),
    KeyCallback(bool, u32),
    Stop,
}

pub struct RetroHandle {
    shared: Arc<Shared>,
    tx: Sender<Cmd>,
    thread: Option<std::thread::JoinHandle<()>>,
}

struct Api {
    set_environment: unsafe extern "C" fn(EnvironmentCb),
    set_video_refresh: unsafe extern "C" fn(VideoRefreshCb),
    set_audio_sample: unsafe extern "C" fn(AudioSampleCb),
    set_audio_sample_batch: unsafe extern "C" fn(AudioBatchCb),
    set_input_poll: unsafe extern "C" fn(InputPollCb),
    set_input_state: unsafe extern "C" fn(InputStateCb),
    init: unsafe extern "C" fn(),
    deinit: unsafe extern "C" fn(),
    api_version: unsafe extern "C" fn() -> c_uint,
    get_system_info: unsafe extern "C" fn(*mut SystemInfo),
    get_system_av_info: unsafe extern "C" fn(*mut SystemAvInfo),
    set_controller_port_device: unsafe extern "C" fn(c_uint, c_uint),
    reset: unsafe extern "C" fn(),
    run: unsafe extern "C" fn(),
    serialize_size: unsafe extern "C" fn() -> usize,
    serialize: unsafe extern "C" fn(*mut c_void, usize) -> bool,
    unserialize: unsafe extern "C" fn(*const c_void, usize) -> bool,
    load_game: unsafe extern "C" fn(*const GameInfo) -> bool,
    unload_game: unsafe extern "C" fn(),
}

fn load_api(lib: &Library) -> std::result::Result<Api, libloading::Error> {
    macro_rules! sym {
        ($n:literal) => {
            *lib.get($n)?
        };
    }
    unsafe {
        Ok(Api {
            set_environment: sym!(b"retro_set_environment\0"),
            set_video_refresh: sym!(b"retro_set_video_refresh\0"),
            set_audio_sample: sym!(b"retro_set_audio_sample\0"),
            set_audio_sample_batch: sym!(b"retro_set_audio_sample_batch\0"),
            set_input_poll: sym!(b"retro_set_input_poll\0"),
            set_input_state: sym!(b"retro_set_input_state\0"),
            init: sym!(b"retro_init\0"),
            deinit: sym!(b"retro_deinit\0"),
            api_version: sym!(b"retro_api_version\0"),
            get_system_info: sym!(b"retro_get_system_info\0"),
            get_system_av_info: sym!(b"retro_get_system_av_info\0"),
            set_controller_port_device: sym!(b"retro_set_controller_port_device\0"),
            reset: sym!(b"retro_reset\0"),
            run: sym!(b"retro_run\0"),
            serialize_size: sym!(b"retro_serialize_size\0"),
            serialize: sym!(b"retro_serialize\0"),
            unserialize: sym!(b"retro_unserialize\0"),
            load_game: sym!(b"retro_load_game\0"),
            unload_game: sym!(b"retro_unload_game\0"),
        })
    }
}

fn cstr(p: &Path) -> std::result::Result<CString, RetroError> {
    CString::new(p.to_string_lossy().as_bytes())
        .map_err(|_| RetroError::Content("path contains a NUL character".into()))
}

fn do_disk(dc: &DiskControl, op: DiskOp) -> Result<()> {
    let (Some(set_eject), Some(replace), Some(set_index), Some(num), Some(add)) =
        (dc.set_eject_state, dc.replace_image_index, dc.set_image_index, dc.get_num_images, dc.add_image_index)
    else {
        return Err(RetroError::Core("the core offers no disk control".into()));
    };
    unsafe {
        match op {
            DiskOp::Eject => {
                if !set_eject(true) {
                    return Err(RetroError::Core("the core refused to eject".into()));
                }
            }
            DiskOp::Insert(path) => {
                let c = cstr(&path)?;
                if !set_eject(true) {
                    return Err(RetroError::Core("the core refused to eject the current disk".into()));
                }
                if num() == 0 && !add() {
                    return Err(RetroError::Core("the core cannot add a disk slot".into()));
                }
                let info = GameInfo { path: c.as_ptr(), data: std::ptr::null(), size: 0, meta: std::ptr::null() };
                if !replace(0, &info) {
                    return Err(RetroError::Core("the core refused the disk image".into()));
                }
                if !set_index(0) {
                    return Err(RetroError::Core("the core could not select the disk".into()));
                }
                if !set_eject(false) {
                    return Err(RetroError::Core("the core refused to close the drive".into()));
                }
            }
        }
    }
    Ok(())
}

impl RetroHandle {
    /// Load the core, load the content and start running frames on a dedicated thread.
    pub fn start(cfg: RetroConfig) -> Result<RetroHandle> {
        {
            let mut a = lock(&ACTIVE);
            if a.is_some() {
                return Err(RetroError::Busy);
            }
            let opts =
                cfg.options.iter().filter_map(|(k, v)| Some((k.clone(), CString::new(v.as_bytes()).ok()?))).collect();
            *a = Some(Arc::new(Shared {
                pixel_format: AtomicU32::new(PIXEL_0RGB1555),
                frame: Mutex::new(Frame::default()),
                seq: AtomicU64::new(0),
                audio: Mutex::new(VecDeque::new()),
                audio_frames: AtomicU64::new(0),
                audio_peak: AtomicU32::new(0),
                input: Mutex::new(InputState { keys: vec![false; KEYBOARD_MAX], ..Default::default() }),
                messages: Mutex::new(vec![]),
                disk: Mutex::new(None),
                kb_cb: Mutex::new(None),
                av: Mutex::new(SystemAvInfo::default()),
                options: opts,
                system_dir: cstr(&cfg.system_dir)?,
                save_dir: cstr(&cfg.save_dir)?,
                core_path: cstr(&cfg.core)?,
                paused: AtomicBool::new(false),
                frames_run: AtomicU64::new(0),
                measured_fps_milli: AtomicU64::new(0),
                shutdown_requested: AtomicBool::new(false),
            }));
        }
        let shared = active().expect("just set");
        let (tx, rx) = channel::<Cmd>();
        let (ready_tx, ready_rx) = channel::<Result<()>>();
        let sh = shared.clone();
        let thread = std::thread::Builder::new()
            .name("libretro-core".into())
            .spawn(move || emulation_thread(cfg, sh, rx, ready_tx))
            .map_err(|e| RetroError::Load(e.to_string()))?;
        match ready_rx.recv() {
            Ok(Ok(())) => Ok(RetroHandle { shared, tx, thread: Some(thread) }),
            Ok(Err(e)) => {
                let _ = thread.join();
                *lock(&ACTIVE) = None;
                Err(e)
            }
            Err(_) => {
                *lock(&ACTIVE) = None;
                Err(RetroError::Load("the core thread died while starting".into()))
            }
        }
    }

    fn send(&self, c: Cmd) -> Result<()> {
        self.tx.send(c).map_err(|_| RetroError::NotRunning)
    }

    pub fn pause(&self) {
        self.shared.paused.store(true, Ordering::SeqCst);
    }
    pub fn resume(&self) {
        self.shared.paused.store(false, Ordering::SeqCst);
    }
    pub fn is_paused(&self) -> bool {
        self.shared.paused.load(Ordering::SeqCst)
    }
    pub fn reset(&self) -> Result<()> {
        self.send(Cmd::Reset)
    }

    pub fn save_state(&self) -> Result<Vec<u8>> {
        let (t, r) = channel();
        self.send(Cmd::SaveState(t))?;
        r.recv_timeout(Duration::from_secs(20)).map_err(|_| RetroError::NotRunning)?
    }
    pub fn load_state(&self, data: Vec<u8>) -> Result<()> {
        let (t, r) = channel();
        self.send(Cmd::LoadState(data, t))?;
        r.recv_timeout(Duration::from_secs(20)).map_err(|_| RetroError::NotRunning)?
    }
    pub fn eject_df0(&self) -> Result<()> {
        let (t, r) = channel();
        self.send(Cmd::Disk(DiskOp::Eject, t))?;
        r.recv_timeout(Duration::from_secs(10)).map_err(|_| RetroError::NotRunning)?
    }
    pub fn insert_df0(&self, path: &Path) -> Result<()> {
        let (t, r) = channel();
        self.send(Cmd::Disk(DiskOp::Insert(path.to_path_buf()), t))?;
        r.recv_timeout(Duration::from_secs(10)).map_err(|_| RetroError::NotRunning)?
    }

    /// Latest picture (cloned), if any has been produced yet.
    pub fn frame(&self) -> Option<Frame> {
        let f = lock(&self.shared.frame).clone();
        (f.seq > 0).then_some(f)
    }
    pub fn frame_seq(&self) -> u64 {
        self.shared.seq.load(Ordering::SeqCst)
    }

    pub fn screenshot_png(&self) -> Option<Vec<u8>> {
        let f = self.frame()?;
        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, f.width, f.height);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            let mut w = enc.write_header().ok()?;
            w.write_image_data(&f.rgba).ok()?;
        }
        Some(out)
    }

    /// Drain up to `max_frames` stereo audio frames (interleaved i16).
    pub fn take_audio(&self, max_frames: usize) -> Vec<i16> {
        let mut q = lock(&self.shared.audio);
        let n = (max_frames * 2).min(q.len()) & !1;
        q.drain(..n).collect()
    }

    pub fn messages(&self) -> Vec<String> {
        lock(&self.shared.messages).clone()
    }

    pub fn stats(&self) -> RetroStats {
        let av = *lock(&self.shared.av);
        RetroStats {
            fps_target: av.timing.fps,
            sample_rate: av.timing.sample_rate,
            frames_run: self.shared.frames_run.load(Ordering::SeqCst),
            audio_frames: self.shared.audio_frames.load(Ordering::SeqCst),
            audio_peak: self.shared.audio_peak.load(Ordering::SeqCst) as i32,
            geometry: (av.geometry.base_width, av.geometry.base_height),
            aspect: av.geometry.aspect_ratio,
            paused: self.is_paused(),
            measured_fps: self.shared.measured_fps_milli.load(Ordering::SeqCst) as f64 / 1000.0,
        }
    }

    // ---- input injection (libretro key codes are SDL 1.2 style, e.g. 'a' = 97, Enter = 13) ----
    pub fn key(&self, code: u32, down: bool) {
        if let Some(k) = lock(&self.shared.input).keys.get_mut(code as usize) {
            *k = down;
        }
        let _ = self.send(Cmd::KeyCallback(down, code));
    }
    pub fn mouse_move(&self, dx: i32, dy: i32) {
        let mut i = lock(&self.shared.input);
        i.pending_dx += dx;
        i.pending_dy += dy;
    }
    /// `button`: 0 left, 1 right, 2 middle.
    pub fn mouse_button(&self, button: usize, down: bool) {
        if let Some(b) = lock(&self.shared.input).buttons.get_mut(button) {
            *b = down;
        }
    }
    /// `port` 0/1, `id` a libretro joypad id (UP=4 DOWN=5 LEFT=6 RIGHT=7 fire=8).
    pub fn joypad(&self, port: usize, id: usize, down: bool) {
        if let Some(b) = lock(&self.shared.input).joy.get_mut(port).and_then(|p| p.get_mut(id)) {
            *b = down;
        }
    }

    pub fn shutdown_requested(&self) -> bool {
        self.shared.shutdown_requested.load(Ordering::SeqCst)
    }

    /// Stop the core and release it. The core stays mapped in the process (libretro cores are not
    /// designed to be unloaded), see [`RetroHandle::start`] limits in the crate docs.
    pub fn stop(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        let _ = self.tx.send(Cmd::Stop);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
        *lock(&ACTIVE) = None;
    }
}

impl Drop for RetroHandle {
    fn drop(&mut self) {
        if self.thread.is_some() {
            self.shutdown();
        }
    }
}

fn emulation_thread(cfg: RetroConfig, sh: Arc<Shared>, rx: Receiver<Cmd>, ready: Sender<Result<()>>) {
    let lib = match unsafe { Library::new(&cfg.core) } {
        Ok(l) => l,
        Err(e) => {
            let _ = ready.send(Err(RetroError::Load(e.to_string())));
            return;
        }
    };
    let api = match load_api(&lib) {
        Ok(a) => a,
        Err(e) => {
            let _ = ready.send(Err(RetroError::Load(format!("not a libretro core: {e}"))));
            return;
        }
    };
    unsafe {
        if (api.api_version)() != 1 {
            let _ = ready.send(Err(RetroError::Load("unsupported libretro API version".into())));
            return;
        }
        (api.set_environment)(cb_environment);
        (api.set_video_refresh)(cb_video);
        (api.set_audio_sample)(cb_audio_sample);
        (api.set_audio_sample_batch)(cb_audio_batch);
        (api.set_input_poll)(cb_input_poll);
        (api.set_input_state)(cb_input_state);
        (api.init)();
        let mut info = std::mem::MaybeUninit::<SystemInfo>::zeroed().assume_init();
        (api.get_system_info)(&mut info);
        let content = match cstr(&cfg.content) {
            Ok(c) => c,
            Err(e) => {
                let _ = ready.send(Err(e));
                return;
            }
        };
        // The Amiberry core needs a real path (need_fullpath = true); data stays NULL.
        let game = GameInfo { path: content.as_ptr(), data: std::ptr::null(), size: 0, meta: std::ptr::null() };
        if !(api.load_game)(&game) {
            let _ = ready.send(Err(RetroError::Content(format!("{} was not accepted", cfg.content.display()))));
            return;
        }
        let mut av = SystemAvInfo::default();
        (api.get_system_av_info)(&mut av);
        *lock(&sh.av) = av;
        (api.set_controller_port_device)(0, DEVICE_MOUSE);
        (api.set_controller_port_device)(1, DEVICE_JOYPAD);
    }
    let _ = ready.send(Ok(()));

    let mut next = Instant::now();
    let mut window_start = Instant::now();
    let mut window_frames = 0u64;
    'outer: loop {
        loop {
            match rx.try_recv() {
                Ok(Cmd::Stop) => break 'outer,
                Ok(Cmd::Reset) => unsafe { (api.reset)() },
                Ok(Cmd::SaveState(t)) => {
                    let r = unsafe {
                        let n = (api.serialize_size)();
                        let mut buf = vec![0u8; n];
                        if n > 0 && (api.serialize)(buf.as_mut_ptr() as *mut c_void, n) {
                            Ok(buf)
                        } else {
                            Err(RetroError::Core("the core could not serialize its state".into()))
                        }
                    };
                    let _ = t.send(r);
                }
                Ok(Cmd::LoadState(d, t)) => {
                    let ok = unsafe { (api.unserialize)(d.as_ptr() as *const c_void, d.len()) };
                    let _ = t.send(if ok {
                        Ok(())
                    } else {
                        Err(RetroError::Core("the core rejected that saved state".into()))
                    });
                }
                Ok(Cmd::Disk(op, t)) => {
                    let dc = *lock(&sh.disk);
                    let _ = t.send(match dc {
                        Some(dc) => do_disk(&dc, op),
                        None => Err(RetroError::Core("the core offers no disk control".into())),
                    });
                }
                Ok(Cmd::KeyCallback(down, code)) => {
                    if let Some(cb) = *lock(&sh.kb_cb) {
                        unsafe { cb(down, code, 0, 0) };
                    }
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => break,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => break 'outer,
            }
        }
        if sh.shutdown_requested.load(Ordering::SeqCst) {
            break;
        }
        if sh.paused.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(10));
            next = Instant::now();
            continue;
        }
        unsafe { (api.run)() };
        sh.frames_run.fetch_add(1, Ordering::SeqCst);
        window_frames += 1;
        if window_start.elapsed() >= Duration::from_secs(1) {
            let fps = window_frames as f64 / window_start.elapsed().as_secs_f64();
            sh.measured_fps_milli.store((fps * 1000.0) as u64, Ordering::SeqCst);
            window_start = Instant::now();
            window_frames = 0;
        }
        let fps = lock(&sh.av).timing.fps;
        let frame_time = Duration::from_secs_f64(1.0 / if fps > 1.0 { fps } else { 50.0 });
        next += frame_time;
        let now = Instant::now();
        if next > now {
            std::thread::sleep(next - now);
        } else if now - next > frame_time * 5 {
            next = now; // fell far behind: do not try to catch up
        }
    }
    unsafe {
        (api.unload_game)();
        (api.deinit)();
    }
    // libretro cores keep process-wide state and are not built to be dlclose()d: leave it mapped.
    std::mem::forget(lib);
}
