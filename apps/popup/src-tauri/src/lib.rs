mod window_cluster;

#[tauri::command]
fn minimize_window(window: tauri::WebviewWindow) {
    let _ = window.minimize();
}

#[tauri::command]
fn toggle_visibility(window: tauri::WebviewWindow) {
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            minimize_window,
            window_cluster::close_window,
            toggle_visibility,
            window_cluster::initialize_widget_windows,
            window_cluster::set_cluster_visibility,
            window_cluster::apply_widget_layout,
            window_cluster::set_cluster_edit_mode,
            window_cluster::hide_widget_window,
            window_cluster::complete_widget_drag,
            window_cluster::get_cluster_geometry,
        ])
        .setup(window_cluster::setup)
        .run(tauri::generate_context!())
        .expect("error while running presenced-popup application");
}
