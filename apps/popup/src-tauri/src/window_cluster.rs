use std::{
    collections::{HashMap, HashSet},
    str::FromStr,
    sync::Mutex as StdMutex,
};

#[cfg(target_os = "linux")]
use std::{
    io::Read,
    process::{Child, Command, ExitStatus, Stdio},
    thread,
    time::{Duration, Instant},
};

use serde::Deserialize;
use tauri::async_runtime::Mutex as AsyncMutex;
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
const NIRI_EXEC_TIMEOUT: Duration = Duration::from_millis(1500);
#[cfg(target_os = "linux")]
const PROCESS_POLL_DELAY: Duration = Duration::from_millis(5);
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

    fn from_label(label: &str) -> Option<Self> {
        WINDOW_REGISTRY
            .iter()
            .find(|spec| spec.label.label() == label)
            .map(|spec| spec.label)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CloseDisposition {
    ExitCluster,
    Hide,
    HideAndFocusMain,
}

fn close_disposition(label: WindowLabel) -> CloseDisposition {
    match label {
        WindowLabel::Main => CloseDisposition::ExitCluster,
        WindowLabel::Widget(_) => CloseDisposition::Hide,
        WindowLabel::Settings => CloseDisposition::HideAndFocusMain,
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

#[derive(Clone, Debug, Eq, PartialEq)]
struct ProjectedLayout {
    windows: Vec<ProjectedWindow>,
    overflow_widget_ids: Vec<WidgetId>,
}

fn visible_projected_widget_ids(projection: &ProjectedLayout) -> HashSet<WidgetId> {
    let overflow: HashSet<WidgetId> = projection.overflow_widget_ids.iter().copied().collect();
    projection
        .windows
        .iter()
        .filter(|projected| !overflow.contains(&projected.widget_id))
        .map(|projected| projected.widget_id)
        .collect()
}

fn overlaps(left: Rect, right: Rect) -> bool {
    let left_right = i64::from(left.x) + i64::from(left.width);
    let right_right = i64::from(right.x) + i64::from(right.width);
    let left_bottom = i64::from(left.y) + i64::from(left.height);
    let right_bottom = i64::from(right.y) + i64::from(right.height);
    i64::from(left.x) < right_right
        && left_right > i64::from(right.x)
        && i64::from(left.y) < right_bottom
        && left_bottom > i64::from(right.y)
}

fn clamp_rect(rect: Rect, output: Rect) -> Rect {
    let width = rect.width.min(output.width);
    let height = rect.height.min(output.height);
    let minimum_x = i64::from(output.x);
    let minimum_y = i64::from(output.y);
    let maximum_x = minimum_x + i64::from(output.width) - i64::from(width);
    let maximum_y = minimum_y + i64::from(output.height) - i64::from(height);
    Rect {
        x: i32::try_from(i64::from(rect.x).clamp(minimum_x, maximum_x))
            .expect("clamped x remains in output i32 bounds"),
        y: i32::try_from(i64::from(rect.y).clamp(minimum_y, maximum_y))
            .expect("clamped y remains in output i32 bounds"),
        width,
        height,
    }
}

fn rect_outside(rect: Rect, output: Rect) -> bool {
    i64::from(rect.x) < i64::from(output.x)
        || i64::from(rect.y) < i64::from(output.y)
        || i64::from(rect.x) + i64::from(rect.width) > i64::from(output.x) + i64::from(output.width)
        || i64::from(rect.y) + i64::from(rect.height)
            > i64::from(output.y) + i64::from(output.height)
}

fn project_layout(layout: &ValidatedClusterLayout, main: Rect, output: Rect) -> ProjectedLayout {
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
    let mut windows = Vec::with_capacity(placements.len());
    let mut overflow_widget_ids = Vec::new();
    let mut occupied = vec![main];
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
        let desired = Rect {
            x,
            y,
            width,
            height,
        };
        let rect = clamp_rect(desired, output);
        if rect_outside(desired, output)
            || occupied
                .iter()
                .any(|occupied_rect| overlaps(rect, *occupied_rect))
        {
            overflow_widget_ids.push(placement.widget_id);
        }
        occupied.push(rect);
        windows.push(ProjectedWindow {
            widget_id: placement.widget_id,
            rect,
        });
    }

    ProjectedLayout {
        windows,
        overflow_widget_ids,
    }
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

#[derive(Default)]
struct ApplyGenerationTracker {
    latest: u64,
    committed: u64,
}

impl ApplyGenerationTracker {
    fn request(&mut self) -> u64 {
        self.latest = self
            .latest
            .checked_add(1)
            .expect("apply generation exhausted");
        self.latest
    }

    fn is_latest(&self, generation: u64) -> bool {
        self.latest == generation
    }

    fn commit(&mut self, generation: u64) -> bool {
        if !self.is_latest(generation) {
            return false;
        }
        self.committed = generation;
        true
    }

    #[cfg(test)]
    fn committed(&self) -> u64 {
        self.committed
    }
}

struct ControllerData {
    generations: ApplyGenerationTracker,
    layout: Option<ValidatedClusterLayout>,
}

pub(crate) struct WindowClusterController {
    app: AppHandle,
    pid: u32,
    data: StdMutex<ControllerData>,
    apply_lock: AsyncMutex<()>,
}

pub(crate) fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let main = app
        .get_webview_window(WindowLabel::Main.label())
        .ok_or_else(|| tauri::Error::WindowNotFound)?;
    main.set_title(WindowLabel::Main.title())?;
    main.set_decorations(false)?;
    main.set_resizable(false)?;
    let app_on_main_close = app.handle().clone();
    main.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = handle_close_request(&app_on_main_close, WindowLabel::Main);
        }
    });

    app.manage(WindowClusterController {
        app: app.handle().clone(),
        pid: std::process::id(),
        data: StdMutex::new(ControllerData {
            generations: ApplyGenerationTracker::default(),
            layout: None,
        }),
        apply_lock: AsyncMutex::new(()),
    });
    center_main_window_on_niri(std::process::id());
    Ok(())
}

fn handle_close_request(app: &AppHandle, label: WindowLabel) -> Result<(), String> {
    match close_disposition(label) {
        CloseDisposition::ExitCluster => {
            let mut first_error = None;
            for spec in WINDOW_REGISTRY {
                if let Some(window) = app.get_webview_window(spec.label.label()) {
                    let result = window
                        .destroy()
                        .map_err(|error| format!("failed to close cluster window: {error}"));
                    if first_error.is_none() {
                        first_error = result.err();
                    }
                }
            }
            app.exit(0);
            first_error.map_or(Ok(()), Err)
        }
        CloseDisposition::Hide => app
            .get_webview_window(label.label())
            .ok_or_else(|| "cluster window is missing".to_owned())?
            .hide()
            .map_err(|error| format!("failed to hide cluster window: {error}")),
        CloseDisposition::HideAndFocusMain => {
            app.get_webview_window(label.label())
                .ok_or_else(|| "settings window is missing".to_owned())?
                .hide()
                .map_err(|error| format!("failed to hide settings window: {error}"))?;
            let main = app
                .get_webview_window(WindowLabel::Main.label())
                .ok_or_else(|| "main window is missing".to_owned())?;
            main.show()
                .map_err(|error| format!("failed to show main window: {error}"))?;
            main.set_focus()
                .map_err(|error| format!("failed to focus main window: {error}"))
        }
    }
}

#[tauri::command]
pub(crate) fn close_window(window: tauri::WebviewWindow) -> Result<(), String> {
    let label = WindowLabel::from_label(window.label())
        .ok_or_else(|| "unknown cluster window".to_owned())?;
    handle_close_request(window.app_handle(), label)
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
        let app_on_close = app.clone();
        let label_on_close = spec.label;
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = handle_close_request(&app_on_close, label_on_close);
            }
        });
    }
    Ok(())
}

fn set_optional_visibility(
    app: &AppHandle,
    visible_widget_ids: &HashSet<WidgetId>,
) -> Result<(), String> {
    for spec in WINDOW_REGISTRY.iter().filter(|spec| spec.magnetic) {
        let WindowLabel::Widget(widget_id) = spec.label else {
            continue;
        };
        let window = app
            .get_webview_window(spec.label.label())
            .ok_or_else(|| format!("missing window: {}", spec.label.label()))?;
        if visible_widget_ids.contains(&widget_id) {
            window.show()
        } else {
            window.hide()
        }
        .map_err(|error| format!("failed to update optional window visibility: {error}"))?;
    }
    Ok(())
}

fn hide_optional_windows(app: &AppHandle) -> Result<(), String> {
    let mut first_error = None;
    for spec in WINDOW_REGISTRY.iter().filter(|spec| spec.magnetic) {
        let result = app
            .get_webview_window(spec.label.label())
            .ok_or_else(|| "optional window is missing".to_owned())
            .and_then(|window| {
                window
                    .hide()
                    .map_err(|error| format!("failed to hide optional window: {error}"))
            });
        if first_error.is_none() {
            first_error = result.err();
        }
    }
    first_error.map_or(Ok(()), Err)
}

fn requested_widget_ids(layout: &ValidatedClusterLayout) -> HashSet<WidgetId> {
    layout
        .placements
        .iter()
        .filter(|placement| placement.visible && placement.side.is_visible(layout))
        .map(|placement| placement.widget_id)
        .collect()
}

fn emit_edit_mode(app: &AppHandle, enabled: bool) -> Result<(), String> {
    app.emit("cluster-edit-mode", enabled)
        .map_err(|error| format!("failed to emit edit mode: {error}"))
}

fn current_output_rect(app: &AppHandle) -> Result<Rect, String> {
    let main = app
        .get_webview_window(WindowLabel::Main.label())
        .ok_or_else(|| "main window is missing".to_owned())?;
    let monitor = main
        .current_monitor()
        .map_err(|error| format!("failed to read main output: {error}"))?
        .ok_or_else(|| "main output is unavailable".to_owned())?;
    let scale = monitor.scale_factor();
    if !scale.is_finite() || scale <= 0.0 {
        return Err("main output scale is invalid".to_owned());
    }
    let size = monitor.size();
    let width = (f64::from(size.width) / scale).round() as u32;
    let height = (f64::from(size.height) / scale).round() as u32;
    if width == 0 || height == 0 {
        return Err("main output has no usable bounds".to_owned());
    }
    Ok(Rect {
        x: 0,
        y: 0,
        width,
        height,
    })
}

#[derive(Clone, Debug)]
struct AppliedNiriLayout {
    visible_widget_ids: HashSet<WidgetId>,
}

fn committed_visibility(result: &Result<AppliedNiriLayout, String>) -> HashSet<WidgetId> {
    result
        .as_ref()
        .map(|applied| applied.visible_widget_ids.clone())
        .unwrap_or_default()
}

fn generation_is_latest(
    controller: &WindowClusterController,
    generation: u64,
) -> Result<bool, String> {
    Ok(controller
        .data
        .lock()
        .map_err(|_| "window cluster state is unavailable".to_owned())?
        .generations
        .is_latest(generation))
}

async fn apply_validated_layout(
    state: State<'_, WindowClusterController>,
    layout: ValidatedClusterLayout,
    generation: u64,
) -> Result<(), String> {
    let _apply_guard = state.apply_lock.lock().await;
    if !generation_is_latest(&state, generation)? {
        return Ok(());
    }

    let app = state.app.clone();
    build_hidden_windows(&app)?;
    hide_optional_windows(&app)?;
    let output = current_output_rect(&app)?;
    let staged_widget_ids = requested_widget_ids(&layout);
    if let Err(error) = set_optional_visibility(&app, &staged_widget_ids) {
        let _ = hide_optional_windows(&app);
        return Err(error);
    }

    let result = reapply_niri_layout(state.pid, layout.clone(), output).await;
    hide_optional_windows(&app)?;
    let visible_widget_ids = committed_visibility(&result);
    let applied = result?;

    let mut data = state
        .data
        .lock()
        .map_err(|_| "window cluster state is unavailable".to_owned())?;
    if !data.generations.is_latest(generation) {
        return Ok(());
    }
    if let Err(error) = emit_edit_mode(&app, layout.edit_mode) {
        drop(data);
        let _ = hide_optional_windows(&app);
        return Err(error);
    }
    if let Err(error) = set_optional_visibility(&app, &visible_widget_ids) {
        drop(data);
        let _ = hide_optional_windows(&app);
        return Err(error);
    }
    if !data.generations.commit(generation) {
        drop(data);
        let _ = hide_optional_windows(&app);
        return Ok(());
    }
    debug_assert_eq!(applied.visible_widget_ids, visible_widget_ids);
    data.layout = Some(layout);
    Ok(())
}

#[tauri::command]
pub(crate) async fn initialize_widget_windows(
    state: State<'_, WindowClusterController>,
    layout: ClusterLayoutV1Payload,
) -> Result<(), String> {
    let layout = validate_layout(layout)?;
    let generation = state
        .data
        .lock()
        .map_err(|_| "window cluster state is unavailable".to_owned())?
        .generations
        .request();
    apply_validated_layout(state, layout, generation).await
}

#[tauri::command]
pub(crate) async fn apply_widget_layout(
    state: State<'_, WindowClusterController>,
    layout: ClusterLayoutV1Payload,
) -> Result<(), String> {
    let layout = validate_layout(layout)?;
    let generation = state
        .data
        .lock()
        .map_err(|_| "window cluster state is unavailable".to_owned())?
        .generations
        .request();
    apply_validated_layout(state, layout, generation).await
}

#[tauri::command]
pub(crate) async fn set_cluster_visibility(
    state: State<'_, WindowClusterController>,
    side: String,
    visible: bool,
) -> Result<(), String> {
    let side = Side::from_str(&side)?;
    let (layout, generation) = {
        let mut data = state
            .data
            .lock()
            .map_err(|_| "window cluster state is unavailable".to_owned())?;
        let mut layout = data
            .layout
            .clone()
            .ok_or_else(|| "window cluster is not initialized".to_owned())?;
        match side {
            Side::Left => layout.left_visible = visible,
            Side::Right => layout.right_visible = visible,
        }
        let generation = data.generations.request();
        (layout, generation)
    };
    apply_validated_layout(state, layout, generation).await
}

#[tauri::command]
pub(crate) async fn set_cluster_edit_mode(
    state: State<'_, WindowClusterController>,
    enabled: bool,
) -> Result<(), String> {
    let _apply_guard = state.apply_lock.lock().await;
    let mut data = state
        .data
        .lock()
        .map_err(|_| "window cluster state is unavailable".to_owned())?;
    let layout = data
        .layout
        .as_mut()
        .ok_or_else(|| "window cluster is not initialized".to_owned())?;
    emit_edit_mode(&state.app, enabled)?;
    layout.edit_mode = enabled;
    Ok(())
}

#[tauri::command]
pub(crate) fn hide_widget_window(
    state: State<'_, WindowClusterController>,
    widget_id: String,
) -> Result<(), String> {
    let widget_id = WidgetId::from_str(&widget_id)?;
    let label = widget_id.window_label();
    let window = state
        .app
        .get_webview_window(label.label())
        .ok_or_else(|| format!("missing window: {}", label.label()))?;
    window
        .hide()
        .map_err(|error| format!("failed to hide {}: {error}", label.label()))?;
    let mut data = state
        .data
        .lock()
        .map_err(|_| "window cluster state is unavailable".to_owned())?;
    if let Some(layout) = data.layout.as_mut() {
        if let Some(placement) = layout
            .placements
            .iter_mut()
            .find(|placement| placement.widget_id == widget_id)
        {
            placement.visible = false;
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn wait_for_child_with_timeout(child: &mut Child, timeout: Duration) -> Result<ExitStatus, String> {
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) if started.elapsed() < timeout => thread::sleep(PROCESS_POLL_DELAY),
            Ok(None) => {
                let _ = child.kill();
                child
                    .wait()
                    .map_err(|error| format!("failed to reap timed-out Niri command: {error}"))?;
                return Err("Niri command timed out".to_owned());
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("failed while waiting for Niri command: {error}"));
            }
        }
    }
}

#[cfg(target_os = "linux")]
struct NiriCommandOutput {
    success: bool,
    stdout: Vec<u8>,
}

#[cfg(target_os = "linux")]
fn run_niri_command(arguments: &[&str]) -> Result<NiriCommandOutput, String> {
    let mut child = Command::new("niri")
        .args(arguments)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("could not start Niri command: {error}"))?;
    let mut stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Niri stdout was unavailable".to_owned());
        }
    };
    let mut stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Niri stderr was unavailable".to_owned());
        }
    };
    let stdout_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).map(|_| bytes)
    });
    let stderr_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes).map(|_| bytes)
    });

    let status = wait_for_child_with_timeout(&mut child, NIRI_EXEC_TIMEOUT);
    let stdout = stdout_reader
        .join()
        .map_err(|_| "Niri stdout reader failed".to_owned())?
        .map_err(|error| format!("failed to read Niri stdout: {error}"))?;
    stderr_reader
        .join()
        .map_err(|_| "Niri stderr reader failed".to_owned())?
        .map_err(|error| format!("failed to read Niri stderr: {error}"))?;
    let status = status?;

    Ok(NiriCommandOutput {
        success: status.success(),
        stdout,
    })
}

#[cfg(target_os = "linux")]
fn discover_niri_windows(
    pid: u32,
    required: &[WindowLabel],
) -> Result<(Vec<NiriWindow>, HashMap<String, u64>), String> {
    let mut last_error = "Niri windows were not available".to_owned();
    for attempt in 0..DISCOVERY_ATTEMPTS {
        match run_niri_command(&["msg", "--json", "windows"]) {
            Ok(output) if output.success => match find_niri_windows(&output.stdout, pid) {
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
            Err(error) => last_error = error,
        }
        if attempt + 1 < DISCOVERY_ATTEMPTS {
            thread::sleep(DISCOVERY_DELAY);
        }
    }
    Err(last_error)
}

#[cfg(target_os = "linux")]
fn run_niri_action(arguments: &[&str]) -> Result<(), String> {
    let output = run_niri_command(arguments)?;
    if output.success {
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
    output: Rect,
) -> Result<AppliedNiriLayout, String> {
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

    let projection = project_layout(layout, main, output);
    let visible_widget_ids = visible_projected_widget_ids(&projection);

    for projected in projection
        .windows
        .into_iter()
        .filter(|projected| visible_widget_ids.contains(&projected.widget_id))
    {
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

    Ok(AppliedNiriLayout { visible_widget_ids })
}

#[cfg(target_os = "linux")]
async fn reapply_niri_layout(
    pid: u32,
    layout: ValidatedClusterLayout,
    output: Rect,
) -> Result<AppliedNiriLayout, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = apply_niri_layout(pid, &layout, output);
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
    layout: ValidatedClusterLayout,
    _output: Rect,
) -> Result<AppliedNiriLayout, String> {
    Ok(AppliedNiriLayout {
        visible_widget_ids: requested_widget_ids(&layout),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        close_disposition, committed_visibility, find_niri_windows, project_layout,
        validate_layout, visible_projected_widget_ids, wait_for_child_with_timeout,
        AppliedNiriLayout, ApplyGenerationTracker, CloseDisposition, ClusterLayoutV1Payload, Lane,
        Rect, Side, SizePreset, WidgetId, WidgetPlacementPayload, WindowLabel, WINDOW_REGISTRY,
    };
    use std::{
        collections::HashSet,
        process::Command,
        time::{Duration, Instant},
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
    fn failed_apply_commits_no_optional_visibility() {
        let failed: Result<AppliedNiriLayout, String> = Err("niri failed".to_owned());

        assert!(committed_visibility(&failed).is_empty());
    }

    #[test]
    fn stale_apply_generation_cannot_commit() {
        let mut tracker = ApplyGenerationTracker::default();
        let stale = tracker.request();
        let latest = tracker.request();

        assert!(!tracker.commit(stale));
        assert!(tracker.commit(latest));
        assert_eq!(tracker.committed(), latest);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn timed_out_child_is_killed_and_reaped() {
        let mut child = Command::new("sh")
            .args(["-c", "exec sleep 5"])
            .spawn()
            .unwrap();
        let started = Instant::now();

        let result = wait_for_child_with_timeout(&mut child, Duration::from_millis(50));

        assert!(result.is_err());
        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(child.try_wait().unwrap().is_some());
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
    fn close_requests_follow_cluster_lifecycle_policy() {
        assert_eq!(
            close_disposition(WindowLabel::Main),
            CloseDisposition::ExitCluster
        );
        assert_eq!(
            close_disposition(WindowLabel::Widget(WidgetId::Music)),
            CloseDisposition::Hide
        );
        assert_eq!(
            close_disposition(WindowLabel::Settings),
            CloseDisposition::HideAndFocusMain
        );
    }

    #[test]
    fn configured_main_matches_registry_and_has_no_resize_path() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let configured = &config["app"]["windows"][0];

        assert_eq!(configured["label"], WindowLabel::Main.label());
        assert_eq!(configured["title"], WindowLabel::Main.title());
        assert_eq!(configured["width"], 720);
        assert_eq!(configured["height"], 420);
        assert_eq!(configured["resizable"], false);
        assert_eq!(configured["maximizable"], false);
        assert!(!include_str!("lib.rs").contains("toggle_maximize"));
    }

    #[test]
    fn registry_is_the_exact_unique_window_source_of_truth() {
        let actual: Vec<_> = WINDOW_REGISTRY
            .iter()
            .map(|spec| {
                (
                    spec.label.label(),
                    spec.label.title(),
                    spec.width,
                    spec.height,
                    spec.create_hidden,
                    spec.magnetic,
                )
            })
            .collect();

        assert_eq!(
            actual,
            vec![
                (
                    "widget-main",
                    "presenced:widget-main",
                    720,
                    420,
                    false,
                    false
                ),
                (
                    "widget-music",
                    "presenced:widget-music",
                    250,
                    190,
                    true,
                    true
                ),
                ("widget-rvc", "presenced:widget-rvc", 250, 190, true, true),
                (
                    "widget-lyrics",
                    "presenced:widget-lyrics",
                    250,
                    240,
                    true,
                    true
                ),
                (
                    "widget-system",
                    "presenced:widget-system",
                    220,
                    150,
                    true,
                    true
                ),
                (
                    "widget-countdown",
                    "presenced:widget-countdown",
                    220,
                    140,
                    true,
                    true
                ),
                (
                    "widget-pomodoro",
                    "presenced:widget-pomodoro",
                    220,
                    220,
                    true,
                    true
                ),
                (
                    "widget-quote",
                    "presenced:widget-quote",
                    250,
                    150,
                    true,
                    true
                ),
                ("settings", "presenced:settings", 820, 680, true, false),
            ]
        );
        assert_eq!(
            actual
                .iter()
                .map(|spec| spec.0)
                .collect::<HashSet<_>>()
                .len(),
            actual.len()
        );
        assert_eq!(
            actual
                .iter()
                .map(|spec| spec.1)
                .collect::<HashSet<_>>()
                .len(),
            actual.len()
        );
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

        let projected = project_layout(
            &validated,
            main,
            Rect {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            },
        );

        assert_eq!(projected.windows.len(), 2);
        assert_eq!(
            projected
                .windows
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
                .windows
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

    #[test]
    fn marks_output_overflow_and_collisions_for_hiding() {
        let mut music = placement();
        music.size = "wide".to_owned();
        let mut system = placement();
        system.widget_id = "system".to_owned();
        system.order = 1;
        let validated = validate_layout(layout(vec![music, system])).unwrap();

        let projected = project_layout(
            &validated,
            Rect {
                x: 400,
                y: 40,
                width: 300,
                height: 420,
            },
            Rect {
                x: 0,
                y: 0,
                width: 800,
                height: 600,
            },
        );

        assert_eq!(projected.overflow_widget_ids, vec![WidgetId::System]);
        assert_eq!(
            visible_projected_widget_ids(&projected),
            HashSet::from([WidgetId::Music])
        );
        assert_eq!(
            projected
                .windows
                .iter()
                .find(|window| window.widget_id == WidgetId::System)
                .unwrap()
                .rect,
            Rect {
                x: 0,
                y: 40,
                width: 250,
                height: 190,
            }
        );
    }
}
