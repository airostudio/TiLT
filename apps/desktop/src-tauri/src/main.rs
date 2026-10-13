// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use amiga_core::error::ErrorDto;
use amiga_service::{Service, StorageLayout};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Manager, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

struct AppState(Arc<Service>);

/// The ONLY command exposed to the web view. `cmd` is matched against an allow-list in
/// `amiga_service::Service::dispatch`; unknown commands are rejected there.
#[tauri::command]
async fn amiga(state: tauri::State<'_, AppState>, cmd: String, args: Value) -> Result<Value, ErrorDto> {
    let svc = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || svc.dispatch(&cmd, args))
        .await
        .map_err(|_| ErrorDto { code: "internal", message: "the backend task failed".into() })?
}

fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok().and_then(|p| p.parent().map(PathBuf::from))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // The storage location pointer lives in the app config dir; a `portable.flag`
            // file next to the executable selects a fully portable install.
            let config_dir = app.path().app_config_dir()?;
            let exe = exe_dir();
            let root = StorageLayout::resolve(Some(&config_dir), exe.as_deref());
            let bundled = app.path().resource_dir().ok().map(|d| d.join("engine")).or_else(|| exe.map(|d| d.join("engine")));
            let svc = Service::with_options(StorageLayout::new(root), bundled, vec![], Some(config_dir))
                .map_err(|e| format!("could not open the Amiga Studio library: {e}"))?;
            app.manage(AppState(svc));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle().clone();
                let svc = app.state::<AppState>().0.clone();
                if svc.machine_running() {
                    // Never kill a running Amiga silently: ask, then shut it down safely.
                    api.prevent_close();
                    let app2 = app.clone();
                    app.dialog()
                        .message("An Amiga is still running. Power it off safely and quit?")
                        .title("Quit TiLT")
                        .buttons(MessageDialogButtons::OkCancelCustom("Power off and quit".into(), "Keep running".into()))
                        .show(move |yes| {
                            if yes {
                                let svc = app2.state::<AppState>().0.clone();
                                std::thread::spawn(move || {
                                    svc.shutdown();
                                    app2.exit(0);
                                });
                            }
                        });
                } else {
                    svc.shutdown();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![amiga])
        .run(tauri::generate_context!())
        .expect("error while running the TiLT application");
}
