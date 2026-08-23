use std::{
    collections::{HashMap, HashSet},
    str::FromStr,
    sync::Mutex,
};

#[cfg(target_os = "linux")]
use std::{process::Command, thread, time::Duration};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const CLUSTER_GAP: i32 = 10;
#[cfg(target_os = "linux")]
const DISCOVERY_ATTEMPTS: usize = 40;
#[cfg(target_os = "linux")]
const CENTER_ATTEMPTS: usize = 8;
#[cfg(target_os = "linux")]
const DISCOVERY_DELAY: Duration = Duration::from_millis(50);
#[cfg(target_os = "linux")]
const OPENING_SETTLE_DELAY: Duration = Duration::from_millis(1000);
#[cfg(target_os = "linux")]
const CENTER_RETRY_DELAY: Duration = Duration::from_millis(500);
#[cfg(target_os = "linux")]
const NIRI_EXHAUSTED: &str = "presenced-popup: Niri window operation exhausted retries";

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum WidgetId {
    Music,
    Rvc,
    Lyrics,
    System,
    Countdown,
    Pomodoro,
    Quote,
}

impl WidgetId {
    fn value(self) -> &'static str {
        match self {
            Self::Music => "music",
            Self::Rvc => "rvc",
            Self::Lyrics => "lyrics",
            Self::System => "system",
            Self::Countdown => "countdown",
            Self::Pomodoro => "pomodoro",
            Self::Quote => "quote",
        }
    }

    fn window_label(self) -> WindowLabel {
        WindowLabel::Widget(self)
    }
}

impl FromStr for WidgetId {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "music" => Ok(Self::Music),
            "rvc" => Ok(Self::Rvc),
            "lyrics" => Ok(Self::Lyrics),
            "system" => Ok(Self::System),
            "countdown" => Ok(Self::Countdown),
            "pomodoro" => Ok(Self::Pomodoro),
            "quote" => Ok(Self::Quote),
            _ => Err(format!("unknown widget id: {value}")),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum WindowLabel {
    Main,
    Widget(WidgetId),
    Settings,
}

impl WindowLabel {
    fn label(self) -> &'static str {
        match self {
            Self::Main => "widget-main",
            Self::Widget(widget_id) => match widget_id {
                WidgetId::Music => "widget-music",
                WidgetId::Rvc => "widget-rvc",
                WidgetId::Lyrics => "widget-lyrics",
                WidgetId::System => "widget-system",
                WidgetId::Countdown => "widget-countdown",
                WidgetId::Pomodoro => "widget-pomodoro",
                WidgetId::Quote => "widget-quote",
            },
            Self::Settings => "settings",
        }
    }

    fn title(self) -> &'static str {
        match self {
            Self::Main => "presenced:widget-main",
            Self::Widget(widget_id) => match widget_id {
                WidgetId::Music => "presenced:widget-music",
                WidgetId::Rvc => "presenced:widget-rvc",
                WidgetId::Lyrics => "presenced:widget-lyrics",
                WidgetId::System => "presenced:widget-system",
                WidgetId::Countdown => "presenced:widget-countdown",
                WidgetId::Pomodoro => "presenced:widget-pomodoro",
                WidgetId::Quote => "presenced:widget-quote",
            },
            Self::Settings => "presenced:settings",
        }
    }

    fn from_title(title: &str) -> Option<Self> {
        WINDOW_REGISTRY
            .iter()
            .find(|spec| spec.label.title() == title)
            .map(|spec| spec.label)
    }
}

#[derive(Clone, Copy)]
struct WindowSpec {
    label: WindowLabel,
    width: u32,
    height: u32,
    create_hidden: bool,
    magnetic: bool,
}

const WINDOW_REGISTRY: [WindowSpec; 9] = [
    WindowSpec {
        label: WindowLabel::Main,
        width: 720,
        height: 420,
        create_hidden: false,
        magnetic: false,
    },
    WindowSpec {
        label: WindowLabel::Widget(WidgetId::Music),
        width: 250,
        height: 190,
        create_hidden: true,
        magnetic: true,
    },
    WindowSpec {
        label: WindowLabel::Widget(WidgetId::Rvc),
        width: 250,
        height: 190,
        create_hidden: true,
        magnetic: true,
    },
    WindowSpec {
        label: WindowLabel::Widget(WidgetId::Lyrics),
        width: 250,
        height: 240,
        create_hidden: true,
        magnetic: true,
    },
    WindowSpec {
        label: WindowLabel::Widget(WidgetId::System),
        width: 220,
        height: 150,
        create_hidden: true,
        magnetic: true,
    },
    WindowSpec {
        label: WindowLabel::Widget(WidgetId::Countdown),
        width: 220,
        height: 140,
        create_hidden: true,
        magnetic: true,
    },
    WindowSpec {
        label: WindowLabel::Widget(WidgetId::Pomodoro),
        width: 220,
        height: 220,
        create_hidden: true,
        magnetic: true,
    },
    WindowSpec {
        label: WindowLabel::Widget(WidgetId::Quote),
        width: 250,
        height: 150,
        create_hidden: true,
        magnetic: true,
    },
    WindowSpec {
        label: WindowLabel::Settings,
        width: 820,
        height: 680,
        create_hidden: true,
        magnetic: false,
    },
];

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ClusterLayoutV1Payload {
    version: u8,
    left_visible: bool,
    right_visible: bool,
    edit_mode: bool,
    placements: Vec<WidgetPlacementPayload>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WidgetPlacementPayload {
    widget_id: String,
    side: String,
    order: u32,
    lane: String,
    size: String,
    visible: bool,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
enum Side {
    Left,
    Right,
}

impl Side {
    fn is_visible(self, layout: &ValidatedClusterLayout) -> bool {
        match self {
            Self::Left => layout.left_visible,
            Self::Right => layout.right_visible,
        }
    }
}

impl FromStr for Side {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "left" => Ok(Self::Left),
            "right" => Ok(Self::Right),
            _ => Err(format!("unknown cluster side: {value}")),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Lane {
    Top,
    Middle,
    Bottom,
}

impl FromStr for Lane {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "top" => Ok(Self::Top),
            "middle" => Ok(Self::Middle),
            "bottom" => Ok(Self::Bottom),
            _ => Err(format!("unknown widget lane: {value}")),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SizePreset {
    Compact,
    Standard,
    Tall,
    Wide,
}

impl SizePreset {
    fn dimensions(self) -> (u32, u32) {
        match self {
            Self::Compact => (220, 140),
            Self::Standard => (250, 190),
            Self::Tall => (250, 240),
            Self::Wide => (320, 180),
        }
    }
}

impl FromStr for SizePreset {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "compact" => Ok(Self::Compact),
            "standard" => Ok(Self::Standard),
            "tall" => Ok(Self::Tall),
            "wide" => Ok(Self::Wide),
            _ => Err(format!("unknown widget size: {value}")),
        }
    }
}

#[derive(Clone)]
struct ValidatedPlacement {
    widget_id: WidgetId,
    side: Side,
    order: u32,
    lane: Lane,
    size: SizePreset,
    visible: bool,
}

#[derive(Clone)]
struct ValidatedClusterLayout {
    left_visible: bool,
    right_visible: bool,
    edit_mode: bool,
    placements: Vec<ValidatedPlacement>,
}

fn validate_layout(payload: ClusterLayoutV1Payload) -> Result<ValidatedClusterLayout, String> {
    if payload.version != 1 {
        return Err(format!(
            "unsupported cluster layout version: {}",
            payload.version
        ));
    }

    let mut seen = HashSet::new();
    let mut placements = Vec::with_capacity(payload.placements.len());
    for placement in payload.placements {
        let widget_id = WidgetId::from_str(&placement.widget_id)?;
        let side = Side::from_str(&placement.side)?;
        let lane = Lane::from_str(&placement.lane)?;
        let size = SizePreset::from_str(&placement.size)?;
        if !seen.insert(widget_id) {
            return Err(format!("duplicate widget placement: {}", widget_id.value()));
        }
        placements.push(ValidatedPlacement {
            widget_id,
            side,
            order: placement.order,
            lane,
            size,
            visible: placement.visible,
        });
    }

    Ok(ValidatedClusterLayout {
        left_visible: payload.left_visible,
        right_visible: payload.right_visible,
        edit_mode: payload.edit_mode,
        placements,
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Rect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ProjectedWindow {
    widget_id: WidgetId,
    rect: Rect,
}

fn project_layout(layout: &ValidatedClusterLayout, main: Rect) -> Vec<ProjectedWindow> {
    let mut placements: Vec<&ValidatedPlacement> = layout
        .placements
        .iter()
        .filter(|placement| placement.visible && placement.side.is_visible(layout))
        .collect();
    placements.sort_by(|left, right| {
        left.side
            .cmp(&right.side)
            .then(left.order.cmp(&right.order))
    });

    let mut left_width = 0_i32;
    let mut right_width = 0_i32;
    let mut projected = Vec::with_capacity(placements.len());
    for placement in placements {
        let (width, height) = placement.size.dimensions();
        let width_i32 = i32::try_from(width).expect("window widths fit in i32");
        let height_i32 = i32::try_from(height).expect("window heights fit in i32");
        let main_width = i32::try_from(main.width).expect("main width fits in i32");
        let main_height = i32::try_from(main.height).expect("main height fits in i32");
        let x = match placement.side {
            Side::Left => {
                let x = main.x - CLUSTER_GAP - width_i32 - left_width;
                left_width += width_i32 + CLUSTER_GAP;
                x
            }
            Side::Right => {
                let x = main.x + main_width + CLUSTER_GAP + right_width;
                right_width += width_i32 + CLUSTER_GAP;
                x
            }
        };
        let y = match placement.lane {
            Lane::Top => main.y,
            Lane::Middle => main.y + (main_height - height_i32) / 2,
            Lane::Bottom => main.y + main_height - height_i32,
        };
        projected.push(ProjectedWindow {
            widget_id: placement.widget_id,
            rect: Rect {
                x,
                y,
                width,
                height,
            },
        });
    }

    projected
}

#[derive(Clone, Deserialize)]
struct NiriWindowLayout {
    tile_pos_in_workspace_view: Option<[f64; 2]>,
    window_size: Option<[u32; 2]>,
}

#[derive(Clone, Deserialize)]
struct NiriWindow {
    id: u64,
    pid: u64,
    title: String,
    layout: Option<NiriWindowLayout>,
}

fn parse_niri_windows(payload: &[u8]) -> Result<Vec<NiriWindow>, String> {
    serde_json::from_slice(payload).map_err(|error| format!("invalid Niri windows JSON: {error}"))
}

fn find_niri_windows(payload: &[u8], pid: u32) -> Result<HashMap<String, u64>, String> {
    let windows = parse_niri_windows(payload)?;
    let mut mapped = HashMap::new();

    for window in windows {
        if window.pid != u64::from(pid) {
            continue;
        }
        let Some(label) = WindowLabel::from_title(&window.title) else {
            continue;
        };
        let label = label.label().to_owned();
        if mapped.insert(label.clone(), window.id).is_some() {
            return Err(format!("duplicate Niri window title for {label}"));
        }
    }

    Ok(mapped)
}

pub(crate) struct WindowClusterController {
    app: AppHandle,
    pid: u32,
    niri_ids: HashMap<String, u64>,
    layout: Option<ValidatedClusterLayout>,
}

pub(crate) fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| tauri::Error::WindowNotFound)?;
    main.set_title(WindowLabel::Main.title())?;
    main.set_decorations(false)?;
    main.set_resizable(false)?;

    app.manage(Mutex::new(WindowClusterController {
        app: app.handle().clone(),
        pid: std::process::id(),
        niri_ids: HashMap::new(),
        layout: None,
    }));
    center_main_window_on_niri(std::process::id());
    Ok(())
}

fn build_hidden_windows(app: &AppHandle) -> Result<(), String> {
    for spec in WINDOW_REGISTRY.iter().filter(|spec| spec.create_hidden) {
        let label = spec.label.label();
        if app.get_webview_window(label).is_some() {
            continue;
        }
        let url = format!("index.html?window={label}");
        let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
            .title(spec.label.title())
            .inner_size(f64::from(spec.width), f64::from(spec.height))
            .transparent(true)
            .decorations(false)
            .resizable(false)
            .skip_taskbar(true)
            .visible(false)
            .build()
            .map_err(|error| format!("failed to build {label}: {error}"))?;
        let window_to_hide = window.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window_to_hide.hide();
            }
        });
    }
    Ok(())
}

fn sync_window_visibility(app: &AppHandle, layout: &ValidatedClusterLayout) -> Result<(), String> {
    for spec in WINDOW_REGISTRY.iter().filter(|spec| spec.magnetic) {
        let WindowLabel::Widget(widget_id) = spec.label else {
            continue;
        };
        let visible = layout.placements.iter().any(|placement| {
            placement.widget_id == widget_id
                && placement.visible
                && placement.side.is_visible(layout)
        });
        let window = app
            .get_webview_window(spec.label.label())
            .ok_or_else(|| format!("missing window: {}", spec.label.label()))?;
        if visible {
            window.show()
        } else {
            window.hide()
        }
        .map_err(|error| {
            format!(
                "failed to update {} visibility: {error}",
                spec.label.label()
            )
        })?;
    }
    Ok(())
}

fn emit_edit_mode(app: &AppHandle, enabled: bool) -> Result<(), String> {
    app.emit("cluster-edit-mode", enabled)
        .map_err(|error| format!("failed to emit edit mode: {error}"))
}

fn controller_values(
    state: &State<'_, Mutex<WindowClusterController>>,
) -> Result<(AppHandle, u32), String> {
    let controller = state
        .lock()
        .map_err(|_| "window cluster state is unavailable".to_owned())?;
    Ok((controller.app.clone(), controller.pid))
}

fn store_layout(
    state: &State<'_, Mutex<WindowClusterController>>,
    layout: ValidatedClusterLayout,
) -> Result<(), String> {
    state
        .lock()
        .map_err(|_| "window cluster state is unavailable".to_owned())?
        .layout = Some(layout);
    Ok(())
}

fn store_niri_ids(
    state: &State<'_, Mutex<WindowClusterController>>,
    niri_ids: HashMap<String, u64>,
) -> Result<(), String> {
    state
        .lock()
        .map_err(|_| "window cluster state is unavailable".to_owned())?
        .niri_ids = niri_ids;
    Ok(())
}

async fn apply_validated_layout(
    state: State<'_, Mutex<WindowClusterController>>,
    layout: ValidatedClusterLayout,
    initialize: bool,
) -> Result<(), String> {
    let (app, pid) = controller_values(&state)?;
    if initialize {
        build_hidden_windows(&app)?;
    }
    sync_window_visibility(&app, &layout)?;
    emit_edit_mode(&app, layout.edit_mode)?;
    store_layout(&state, layout.clone())?;
    let niri_ids = reapply_niri_layout(pid, layout).await?;
    store_niri_ids(&state, niri_ids)
}

#[tauri::command]
pub(crate) async fn initialize_widget_windows(
    state: State<'_, Mutex<WindowClusterController>>,
    layout: ClusterLayoutV1Payload,
) -> Result<(), String> {
    let layout = validate_layout(layout)?;
    apply_validated_layout(state, layout, true).await
}

#[tauri::command]
pub(crate) async fn apply_widget_layout(
    state: State<'_, Mutex<WindowClusterController>>,
    layout: ClusterLayoutV1Payload,
) -> Result<(), String> {
    let layout = validate_layout(layout)?;
    apply_validated_layout(state, layout, false).await
}

#[tauri::command]
pub(crate) async fn set_cluster_visibility(
    state: State<'_, Mutex<WindowClusterController>>,
    side: String,
    visible: bool,
) -> Result<(), String> {
    let side = Side::from_str(&side)?;
    let layout = {
        let mut controller = state
            .lock()
            .map_err(|_| "window cluster state is unavailable".to_owned())?;
        let layout = controller
            .layout
            .as_mut()
            .ok_or_else(|| "window cluster is not initialized".to_owned())?;
        match side {
            Side::Left => layout.left_visible = visible,
            Side::Right => layout.right_visible = visible,
        }
        layout.clone()
    };
    apply_validated_layout(state, layout, false).await
}

#[tauri::command]
pub(crate) fn set_cluster_edit_mode(
    state: State<'_, Mutex<WindowClusterController>>,
    enabled: bool,
) -> Result<(), String> {
    let app = {
        let mut controller = state
            .lock()
            .map_err(|_| "window cluster state is unavailable".to_owned())?;
        let layout = controller
            .layout
            .as_mut()
            .ok_or_else(|| "window cluster is not initialized".to_owned())?;
        layout.edit_mode = enabled;
        controller.app.clone()
    };
    emit_edit_mode(&app, enabled)
}

#[tauri::command]
pub(crate) fn hide_widget_window(
    state: State<'_, Mutex<WindowClusterController>>,
    widget_id: String,
) -> Result<(), String> {
    let widget_id = WidgetId::from_str(&widget_id)?;
    let label = widget_id.window_label();
    let mut controller = state
        .lock()
        .map_err(|_| "window cluster state is unavailable".to_owned())?;
    let window = controller
        .app
        .get_webview_window(label.label())
        .ok_or_else(|| format!("missing window: {}", label.label()))?;
    window
        .hide()
        .map_err(|error| format!("failed to hide {}: {error}", label.label()))?;
    if let Some(layout) = controller.layout.as_mut() {
        if let Some(placement) = layout
            .placements
            .iter_mut()
            .find(|placement| placement.widget_id == widget_id)
        {
            placement.visible = false;
        }
    }
    controller.niri_ids.remove(label.label());
    Ok(())
}

#[cfg(target_os = "linux")]
fn discover_niri_windows(
    pid: u32,
    required: &[WindowLabel],
) -> Result<(Vec<NiriWindow>, HashMap<String, u64>), String> {
    let mut last_error = "Niri windows were not available".to_owned();
    for attempt in 0..DISCOVERY_ATTEMPTS {
        match Command::new("niri")
            .args(["msg", "--json", "windows"])
            .output()
        {
            Ok(output) if output.status.success() => match find_niri_windows(&output.stdout, pid) {
                Ok(mapped)
                    if required
                        .iter()
                        .all(|label| mapped.contains_key(label.label())) =>
                {
                    return Ok((parse_niri_windows(&output.stdout)?, mapped));
                }
                Ok(_) => last_error = "required Niri windows were not mapped".to_owned(),
                Err(error) => last_error = error,
            },
            Ok(_) => last_error = "Niri windows command failed".to_owned(),
            Err(error) => last_error = format!("could not start Niri windows command: {error}"),
        }
        if attempt + 1 < DISCOVERY_ATTEMPTS {
            thread::sleep(DISCOVERY_DELAY);
        }
    }
    Err(last_error)
}

#[cfg(target_os = "linux")]
fn run_niri_action(arguments: &[&str]) -> Result<(), String> {
    let output = Command::new("niri")
        .args(arguments)
        .output()
        .map_err(|error| format!("could not start Niri action: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err("Niri action failed".to_owned())
    }
}

#[cfg(target_os = "linux")]
fn center_main_window_on_niri(pid: u32) {
    thread::spawn(move || {
        let result = (|| {
            let (_, mapped) = discover_niri_windows(pid, &[WindowLabel::Main])?;
            let id = mapped[WindowLabel::Main.label()].to_string();
            thread::sleep(OPENING_SETTLE_DELAY);
            for attempt in 0..CENTER_ATTEMPTS {
                if run_niri_action(&["msg", "action", "center-window", "--id", &id]).is_ok() {
                    return Ok(());
                }
                if attempt + 1 < CENTER_ATTEMPTS {
                    thread::sleep(CENTER_RETRY_DELAY);
                }
            }
            Err("center action failed".to_owned())
        })();
        if result.is_err() {
            eprintln!("{NIRI_EXHAUSTED}: startup placement");
        }
    });
}

#[cfg(not(target_os = "linux"))]
fn center_main_window_on_niri(_pid: u32) {}

#[cfg(target_os = "linux")]
fn main_rect(windows: &[NiriWindow], pid: u32) -> Result<Rect, String> {
    let main = windows
        .iter()
        .find(|window| {
            window.pid == u64::from(pid)
                && WindowLabel::from_title(&window.title) == Some(WindowLabel::Main)
        })
        .ok_or_else(|| "main Niri window is missing".to_owned())?;
    let layout = main
        .layout
        .as_ref()
        .ok_or_else(|| "main Niri layout is missing".to_owned())?;
    let position = layout
        .tile_pos_in_workspace_view
        .ok_or_else(|| "main Niri position is missing".to_owned())?;
    let size = layout
        .window_size
        .ok_or_else(|| "main Niri size is missing".to_owned())?;
    Ok(Rect {
        x: position[0].round() as i32,
        y: position[1].round() as i32,
        width: size[0],
        height: size[1],
    })
}

#[cfg(target_os = "linux")]
fn apply_niri_layout(
    pid: u32,
    layout: &ValidatedClusterLayout,
) -> Result<HashMap<String, u64>, String> {
    let mut required = vec![WindowLabel::Main];
    required.extend(
        layout
            .placements
            .iter()
            .filter(|placement| placement.visible && placement.side.is_visible(layout))
            .map(|placement| placement.widget_id.window_label()),
    );
    let (windows, mapped) = discover_niri_windows(pid, &required)?;
    let main = main_rect(&windows, pid)?;

    for projected in project_layout(layout, main) {
        let label = projected.widget_id.window_label();
        let id = mapped
            .get(label.label())
            .ok_or_else(|| format!("missing Niri id for {}", label.label()))?
            .to_string();
        let width = projected.rect.width.to_string();
        let height = projected.rect.height.to_string();
        let x = projected.rect.x.to_string();
        let y = projected.rect.y.to_string();
        run_niri_action(&["msg", "action", "set-window-width", &width, "--id", &id])?;
        run_niri_action(&["msg", "action", "set-window-height", &height, "--id", &id])?;
        run_niri_action(&[
            "msg",
            "action",
            "move-floating-window",
            "--id",
            &id,
            "-x",
            &x,
            "-y",
            &y,
        ])?;
    }

    Ok(mapped)
}

#[cfg(target_os = "linux")]
async fn reapply_niri_layout(
    pid: u32,
    layout: ValidatedClusterLayout,
) -> Result<HashMap<String, u64>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = apply_niri_layout(pid, &layout);
        if result.is_err() {
            eprintln!("{NIRI_EXHAUSTED}: cluster layout");
        }
        result
    })
    .await
    .map_err(|error| format!("Niri layout worker failed: {error}"))?
}

#[cfg(not(target_os = "linux"))]
async fn reapply_niri_layout(
    _pid: u32,
    _layout: ValidatedClusterLayout,
) -> Result<HashMap<String, u64>, String> {
    Ok(HashMap::new())
}

#[cfg(test)]
mod tests {
    use super::{
        find_niri_windows, project_layout, validate_layout, ClusterLayoutV1Payload, Lane, Rect,
        Side, SizePreset, WidgetId, WidgetPlacementPayload, WindowLabel, WINDOW_REGISTRY,
    };

    fn placement() -> WidgetPlacementPayload {
        WidgetPlacementPayload {
            widget_id: "music".to_owned(),
            side: "left".to_owned(),
            order: 0,
            lane: "top".to_owned(),
            size: "standard".to_owned(),
            visible: true,
        }
    }

    fn layout(placements: Vec<WidgetPlacementPayload>) -> ClusterLayoutV1Payload {
        ClusterLayoutV1Payload {
            version: 1,
            left_visible: true,
            right_visible: true,
            edit_mode: false,
            placements,
        }
    }

    #[test]
    fn maps_same_pid_windows_by_exact_title() {
        let json = br#"[
          {"id": 11, "pid": 55, "title": "presenced:widget-main"},
          {"id": 12, "pid": 55, "title": "presenced:widget-rvc"}
        ]"#;

        let map = find_niri_windows(json, 55).unwrap();

        assert_eq!(map["widget-main"], 11);
        assert_eq!(map["widget-rvc"], 12);
    }

    #[test]
    fn excludes_windows_from_other_processes() {
        let json = br#"[
          {"id": 11, "pid": 54, "title": "presenced:widget-main"},
          {"id": 12, "pid": 55, "title": "presenced:widget-rvc"}
        ]"#;

        let map = find_niri_windows(json, 55).unwrap();

        assert_eq!(map.len(), 1);
        assert_eq!(map["widget-rvc"], 12);
    }

    #[test]
    fn rejects_malformed_niri_json() {
        assert!(find_niri_windows(b"not-json", 55).is_err());
    }

    #[test]
    fn ignores_unknown_window_titles() {
        let json = br#"[
          {"id": 11, "pid": 55, "title": "presenced:widget-unknown"},
          {"id": 12, "pid": 55, "title": "unrelated"}
        ]"#;

        let map = find_niri_windows(json, 55).unwrap();

        assert!(map.is_empty());
    }

    #[test]
    fn rejects_duplicate_known_titles() {
        let json = br#"[
          {"id": 11, "pid": 55, "title": "presenced:widget-rvc"},
          {"id": 12, "pid": 55, "title": "presenced:widget-rvc"}
        ]"#;

        assert!(find_niri_windows(json, 55).is_err());
    }

    #[test]
    fn validates_every_layout_string_through_fixed_enums() {
        let validated = validate_layout(layout(vec![placement()])).unwrap();
        let parsed = &validated.placements[0];
        assert_eq!(parsed.widget_id, WidgetId::Music);
        assert_eq!(parsed.side, Side::Left);
        assert_eq!(parsed.lane, Lane::Top);
        assert_eq!(parsed.size, SizePreset::Standard);

        let mut invalid_widget = placement();
        invalid_widget.widget_id = "unknown".to_owned();
        assert!(validate_layout(layout(vec![invalid_widget])).is_err());

        let mut invalid_side = placement();
        invalid_side.side = "center".to_owned();
        assert!(validate_layout(layout(vec![invalid_side])).is_err());

        let mut invalid_lane = placement();
        invalid_lane.lane = "floating".to_owned();
        assert!(validate_layout(layout(vec![invalid_lane])).is_err());

        let mut invalid_size = placement();
        invalid_size.size = "giant".to_owned();
        assert!(validate_layout(layout(vec![invalid_size])).is_err());
    }

    #[test]
    fn rejects_wrong_layout_version_and_duplicate_widgets() {
        let mut wrong_version = layout(vec![]);
        wrong_version.version = 2;
        assert!(validate_layout(wrong_version).is_err());

        assert!(validate_layout(layout(vec![placement(), placement()])).is_err());
    }

    #[test]
    fn registry_contains_every_hidden_window_and_settings_dimensions() {
        assert_eq!(WINDOW_REGISTRY.len(), 9);
        assert_eq!(
            WINDOW_REGISTRY
                .iter()
                .filter(|spec| spec.create_hidden)
                .count(),
            8
        );
        let settings = WINDOW_REGISTRY
            .iter()
            .find(|spec| spec.label == WindowLabel::Settings)
            .unwrap();
        assert_eq!((settings.width, settings.height), (820, 680));
        assert!(!settings.magnetic);
    }

    #[test]
    fn projects_widget_geometry_around_main_without_projecting_main() {
        let mut lyrics = placement();
        lyrics.widget_id = "lyrics".to_owned();
        lyrics.side = "right".to_owned();
        lyrics.lane = "bottom".to_owned();
        lyrics.size = "tall".to_owned();
        let validated = validate_layout(layout(vec![placement(), lyrics])).unwrap();
        let main = Rect {
            x: 600,
            y: 330,
            width: 720,
            height: 420,
        };

        let projected = project_layout(&validated, main);

        assert_eq!(projected.len(), 2);
        assert_eq!(
            projected
                .iter()
                .find(|window| window.widget_id == WidgetId::Music)
                .unwrap()
                .rect,
            Rect {
                x: 340,
                y: 330,
                width: 250,
                height: 190,
            }
        );
        assert_eq!(
            projected
                .iter()
                .find(|window| window.widget_id == WidgetId::Lyrics)
                .unwrap()
                .rect,
            Rect {
                x: 1330,
                y: 510,
                width: 250,
                height: 240,
            }
        );
    }
}
