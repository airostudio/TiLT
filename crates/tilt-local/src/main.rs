//! `tilt-local`: run TiLT in a normal web browser on THIS computer.
//!
//! The server listens on 127.0.0.1 only, serves the UI and the same allow-listed command API the
//! desktop app uses, and requires a random per-run token (see `security.rs`). Your ROMs, disks and
//! hard disk images are read from, and stay on, this machine. It is not a hosted service: do not
//! expose it to a network.
//!
//!   tilt-local [--ui <dir>] [--port N] [--root <storage dir>] [--no-open] [--token T]

mod security;

use amiga_service::{Service, StorageLayout};
use security::{gate_api, host_ok, token_eq, Decision};
use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tiny_http::{Header, Request, Response, StatusCode};

fn content_type(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "json" | "map" => "application/json",
        "woff2" => "font/woff2",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

fn find_ui(explicit: Option<PathBuf>) -> Option<PathBuf> {
    if let Some(p) = explicit {
        return p.join("index.html").is_file().then_some(p);
    }
    let exe = std::env::current_exe().ok()?;
    let d = exe.parent()?;
    [
        d.join("ui"),
        d.join("../ui"),
        d.join("../../apps/desktop/dist"),
        d.join("../../../apps/desktop/dist"),
        PathBuf::from("apps/desktop/dist"),
    ]
    .into_iter()
    .find(|p| p.join("index.html").is_file())
    .and_then(|p| p.canonicalize().ok())
}

fn header(req: &Request, name: &str) -> Option<String> {
    req.headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str().to_string())
}

fn h(k: &str, v: &str) -> Header {
    Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap()
}

fn text(status: u16, body: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(body.to_string())
        .with_status_code(StatusCode(status))
        .with_header(h("Content-Type", "text/plain; charset=utf-8"))
}

fn json_resp(status: u16, v: Value) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(v.to_string())
        .with_status_code(StatusCode(status))
        .with_header(h("Content-Type", "application/json"))
        .with_header(h("Cache-Control", "no-store"))
}

fn open_browser(url: &str) {
    let (cmd, args): (&str, Vec<&str>) = if cfg!(windows) {
        ("cmd", vec!["/C", "start", "", url])
    } else if cfg!(target_os = "macos") {
        ("open", vec![url])
    } else {
        ("xdg-open", vec![url])
    };
    if std::process::Command::new(cmd)
        .args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .is_err()
    {
        eprintln!("Could not open a browser automatically. Open the link above yourself.");
    }
}

fn main() {
    let (mut ui, mut port, mut root, mut open, mut token) = (None, 5174u16, None, true, None::<String>);
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--ui" => ui = it.next().map(PathBuf::from),
            "--port" => port = it.next().and_then(|p| p.parse().ok()).unwrap_or(port),
            "--root" => root = it.next().map(PathBuf::from),
            "--no-open" => open = false,
            "--token" => token = it.next(),
            "--help" | "-h" => {
                println!("tilt-local [--ui <dir>] [--port N (0 = any)] [--root <storage dir>] [--no-open] [--token T]");
                return;
            }
            other => {
                eprintln!("unknown argument {other} (try --help)");
                std::process::exit(2);
            }
        }
    }
    let Some(ui_dir) = find_ui(ui) else {
        eprintln!(
            "Cannot find the built UI. Build it (cd apps/desktop && npm ci && npm run build) or pass --ui <dir>."
        );
        std::process::exit(2);
    };
    let config_dir = StorageLayout::default_config_dir();
    let root = root.unwrap_or_else(|| {
        StorageLayout::resolve(Some(&config_dir), std::env::current_exe().ok().as_deref().and_then(Path::parent))
    });
    let svc: Arc<Service> =
        match Service::with_options(StorageLayout::new(root.clone()), None, vec![], Some(config_dir)) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Could not open the library at {}: {e}", root.display());
                std::process::exit(1);
            }
        };
    let server = tiny_http::Server::http(("127.0.0.1", port))
        .or_else(|_| tiny_http::Server::http(("127.0.0.1", 0)))
        .expect("cannot listen on 127.0.0.1");
    let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(port);
    let token =
        token.unwrap_or_else(|| format!("{}{}", amiga_core::fsutil::random_id(), amiga_core::fsutil::random_id()));
    let url = format!("http://127.0.0.1:{port}/?token={token}");

    println!("TiLT is running on this computer only (127.0.0.1).\n  Library: {}\n  Open:    {url}\nPress Ctrl+C to stop (a running Amiga is shut down safely).", root.display());
    {
        let svc = svc.clone();
        let _ = ctrlc::set_handler(move || {
            svc.shutdown();
            std::process::exit(0);
        });
    }
    if open {
        open_browser(&url);
    }

    let server = Arc::new(server);
    for req in server.incoming_requests() {
        let (svc, token, ui_dir) = (svc.clone(), token.clone(), ui_dir.clone());
        std::thread::spawn(move || handle(req, &svc, &token, &ui_dir, port));
    }
}

fn handle(mut req: Request, svc: &Arc<Service>, token: &str, ui_dir: &Path, port: u16) {
    let url = req.url().to_string();
    let (path, query) = url.split_once('?').unwrap_or((url.as_str(), ""));
    let host = header(&req, "Host");

    if let Some(cmd) = path.strip_prefix("/api/") {
        if req.method() != &tiny_http::Method::Post {
            let _ = req.respond(text(405, "POST only"));
            return;
        }
        match gate_api(
            host.as_deref(),
            header(&req, "Origin").as_deref(),
            header(&req, "Cookie").as_deref(),
            header(&req, "X-TiLT-Token").as_deref(),
            token,
            port,
        ) {
            Decision::Allow => {}
            Decision::Forbidden(why) => {
                let _ = req.respond(json_resp(403, json!({"error": {"code": "forbidden", "message": why}})));
                return;
            }
            Decision::Unauthorized => {
                let _ = req.respond(json_resp(401, json!({"error": {"code": "unauthorized", "message": "Open TiLT with the link printed by tilt-local."}})));
                return;
            }
        }
        let mut body = String::new();
        let _ = req.as_reader().take(4 * 1024 * 1024).read_to_string(&mut body);
        let args: Value =
            if body.trim().is_empty() { json!({}) } else { serde_json::from_str(&body).unwrap_or(json!({})) };
        let out = match svc.dispatch(cmd, args) {
            Ok(v) => json!({ "ok": v }),
            Err(e) => json!({ "error": e }),
        };
        let _ = req.respond(json_resp(200, out));
        return;
    }

    // Static UI. The Host check also protects these (no rebinding), but they hold no secrets.
    if !host_ok(host.as_deref(), port) {
        let _ = req.respond(text(403, "unexpected Host header"));
        return;
    }
    // First visit through the printed link: remember the token in a strict, HttpOnly cookie and drop it from the URL.
    if path == "/" {
        if let Some(t) = query.split('&').find_map(|kv| kv.strip_prefix("token=")) {
            if token_eq(t, token) {
                let r = Response::empty(StatusCode(302))
                    .with_header(h("Location", "/"))
                    .with_header(h("Set-Cookie", &format!("tilt_token={token}; HttpOnly; SameSite=Strict; Path=/")))
                    .with_header(h("Cache-Control", "no-store"));
                let _ = req.respond(r);
                return;
            }
        }
    }
    let rel = if path == "/" { "index.html" } else { path.trim_start_matches('/') };
    let candidate = ui_dir.join(rel);
    let safe = candidate.canonicalize().ok().filter(|c| c.starts_with(ui_dir) && c.is_file());
    let file = safe.unwrap_or_else(|| ui_dir.join("index.html"));
    match std::fs::read(&file) {
        Ok(bytes) => {
            let r = Response::from_data(bytes)
                .with_header(h("Content-Type", content_type(&file)))
                .with_header(h("Cache-Control", "no-cache"))
                .with_header(h("X-Content-Type-Options", "nosniff"))
                .with_header(h("Referrer-Policy", "no-referrer"));
            let _ = req.respond(r);
        }
        Err(_) => {
            let _ = req.respond(text(404, "not found"));
        }
    }
}
