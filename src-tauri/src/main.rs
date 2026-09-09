// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{webview::DownloadEvent, Manager, WebviewWindowBuilder};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // wry on macOS cancels navigations that would be downloads unless the
            // window has a download handler, so "Download PDF" and "Calibration
            // page" (blob: links) would otherwise do nothing there. Built manually
            // (tauri.conf.json sets this window's "create" to false) so the
            // handler can be attached before the window opens.
            WebviewWindowBuilder::from_config(app.handle(), &app.config().app.windows[0])?
                .on_download(|webview, event| {
                    if let DownloadEvent::Requested { destination, .. } = event {
                        if let (Ok(dir), Some(name)) = (
                            webview.path().download_dir(),
                            destination.file_name().map(|n| n.to_owned()),
                        ) {
                            *destination = dir.join(name);
                        }
                    }
                    true
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
