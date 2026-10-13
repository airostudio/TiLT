//! Development / CI bridge: exposes the allow-listed `amiga-service` commands over
//! HTTP on 127.0.0.1 so the real UI can be driven in a normal browser (Playwright)
//! against the REAL backend. It is not part of release builds.
//!
//!   amiga-devserver --root <dir> [--port 5174] [--static apps/desktop/dist] [--bundled <dir>]
//!
//! POST /api/<command>   body = JSON args   ->  {"ok": ...} | {"error": {"code","message"}}

use amiga_service::Service;
use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};

fn content_type(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "json" => "application/json",
        "woff2" => "font/woff2",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

fn main() {
    let mut root = None;
    let mut port = 5174u16;
    let mut statik: Option<PathBuf> = None;
    let mut bundled = None;
    let mut config_dir: Option<PathBuf> = None;
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--root" => root = it.next().map(PathBuf::from),
            "--port" => port = it.next().and_then(|p| p.parse().ok()).unwrap_or(port),
            "--static" => statik = it.next().map(PathBuf::from),
            "--bundled" => bundled = it.next().map(PathBuf::from),
            "--config-dir" => config_dir = it.next().map(PathBuf::from),
            other => {
                eprintln!("unknown argument {other}");
                std::process::exit(2);
            }
        }
    }
    let root = root.unwrap_or_else(|| {
        eprintln!("--root <storage dir> is required (use a throw-away directory)");
        std::process::exit(2);
    });
    let svc = Service::with_options(amiga_service::StorageLayout::new(root), bundled, vec![], config_dir)
        .expect("open library");
    let server = tiny_http::Server::http(("127.0.0.1", port)).expect("bind 127.0.0.1");
    eprintln!("amiga-devserver listening on http://127.0.0.1:{port}");
    for mut req in server.incoming_requests() {
        let svc = svc.clone();
        let statik = statik.clone();
        std::thread::spawn(move || {
            let url = req.url().split('?').next().unwrap_or("/").to_string();
            let json_header = tiny_http::Header::from_bytes("Content-Type", "application/json").unwrap();
            if let Some(cmd) = url.strip_prefix("/api/") {
                let mut body = String::new();
                let _ = req.as_reader().take(4 * 1024 * 1024).read_to_string(&mut body);
                let args: Value =
                    if body.trim().is_empty() { json!({}) } else { serde_json::from_str(&body).unwrap_or(json!({})) };
                let out = match svc.dispatch(cmd, args) {
                    Ok(v) => json!({ "ok": v }),
                    Err(e) => json!({ "error": e }),
                };
                let _ = req.respond(tiny_http::Response::from_string(out.to_string()).with_header(json_header));
                return;
            }
            if let Some(dir) = statik {
                let rel = if url == "/" { "index.html" } else { url.trim_start_matches('/') };
                let candidate = dir.join(rel);
                let ok = candidate
                    .canonicalize()
                    .ok()
                    .filter(|c| dir.canonicalize().map(|d| c.starts_with(d)).unwrap_or(false));
                let file = ok.filter(|c| c.is_file()).unwrap_or_else(|| dir.join("index.html"));
                if let Ok(bytes) = std::fs::read(&file) {
                    let h = tiny_http::Header::from_bytes("Content-Type", content_type(&file)).unwrap();
                    let _ = req.respond(tiny_http::Response::from_data(bytes).with_header(h));
                    return;
                }
            }
            let _ = req.respond(tiny_http::Response::from_string("not found").with_status_code(404));
        });
    }
}
