use std::{
    collections::{HashMap, HashSet},
    str::FromStr,
    sync::Mutex as StdMutex,
};

#[cfg(target_os = "linux")]
use std::{
    io::Read,
    os::fd::AsRawFd,
    os::unix::process::CommandExt,
    process::{Child, ChildStderr, ChildStdout, Command, ExitStatus, Stdio},
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::async_runtime::Mutex as AsyncMutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

#[cfg(target_os = "linux")]
use gtk::prelude::{WidgetExt, WidgetExtManual};

const CLUSTER_GAP: i32 = 10;
const NATIVE_DRAG_RELEASE_EVENT: &str = "cluster-native-drag-release";
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
const NATIVE_RELEASE_REGISTRATION_TIMEOUT: Duration = Duration::from_millis(2500);
#[cfg(target_os = "linux")]
const NIRI_EXEC_TIMEOUT: Duration = Duration::from_millis(1500);
#[cfg(target_os = "linux")]
const NIRI_OUTPUT_LIMIT: usize = 1024 * 1024;
#[cfg(target_os = "linux")]
const PROCESS_CLEANUP_RESERVE: Duration = Duration::from_millis(100);
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

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
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

fn niri_window_rect(windows: &[NiriWindow], pid: u32, label: WindowLabel) -> Result<Rect, String> {
    let matching: Vec<_> = windows
        .iter()
        .filter(|window| {
            window.pid == u64::from(pid) && WindowLabel::from_title(&window.title) == Some(label)
        })
        .collect();
    if matching.len() != 1 {
        return Err(format!(
            "expected exactly one Niri window for {}, found {}",
            label.label(),
            matching.len()
        ));
    }
    let layout = matching[0]
        .layout
        .as_ref()
        .ok_or_else(|| format!("{} Niri layout is missing", label.label()))?;
    let position = layout
        .tile_pos_in_workspace_view
        .ok_or_else(|| format!("{} Niri position is missing", label.label()))?;
    let size = layout
        .window_size
        .ok_or_else(|| format!("{} Niri size is missing", label.label()))?;
    if !position[0].is_finite()
        || !position[1].is_finite()
        || position[0].round() < f64::from(i32::MIN)
        || position[0].round() > f64::from(i32::MAX)
        || position[1].round() < f64::from(i32::MIN)
        || position[1].round() > f64::from(i32::MAX)
        || size[0] == 0
        || size[1] == 0
    {
        return Err(format!("{} Niri rectangle is invalid", label.label()));
    }
    Ok(Rect {
        x: position[0].round() as i32,
        y: position[1].round() as i32,
        width: size[0],
        height: size[1],
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub(crate) struct DragSnapshotPayload {
    dragged: Rect,
    main: Rect,
    output: Rect,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub(crate) struct ClusterGeometryPayload {
    main: Rect,
    output: Rect,
}

fn cluster_geometry_from_payload(
    payload: &[u8],
    pid: u32,
    output: Rect,
) -> Result<ClusterGeometryPayload, String> {
    if output.width == 0 || output.height == 0 {
        return Err("Niri output rectangle is invalid".to_owned());
    }
    find_niri_windows(payload, pid)?;
    let windows = parse_niri_windows(payload)?;
    let main = niri_window_rect(&windows, pid, WindowLabel::Main)?;
    if rect_outside(main, output) {
        return Err("widget-main Niri rectangle is outside the output".to_owned());
    }
    Ok(ClusterGeometryPayload { main, output })
}

fn drag_snapshot_from_payload(
    payload: &[u8],
    pid: u32,
    widget_id: WidgetId,
    output: Rect,
) -> Result<DragSnapshotPayload, String> {
    if output.width == 0 || output.height == 0 {
        return Err("Niri output rectangle is invalid".to_owned());
    }
    find_niri_windows(payload, pid)?;
    let windows = parse_niri_windows(payload)?;
    let dragged = niri_window_rect(&windows, pid, widget_id.window_label())?;
    let main = niri_window_rect(&windows, pid, WindowLabel::Main)?;
    if rect_outside(dragged, output) {
        return Err("dragged widget Niri rectangle is outside the output".to_owned());
    }
    if rect_outside(main, output) {
        return Err("widget-main Niri rectangle is outside the output".to_owned());
    }
    Ok(DragSnapshotPayload {
        dragged,
        main,
        output,
    })
}

fn validate_completed_drag(
    origin: DragSnapshotPayload,
    completed: DragSnapshotPayload,
) -> Result<DragSnapshotPayload, String> {
    if completed.dragged == origin.dragged {
        return Err("native drag completed without moving the widget".to_owned());
    }
    if completed.main != origin.main {
        return Err("main window geometry changed during widget drag".to_owned());
    }
    if completed.output != origin.output {
        return Err("cluster output changed during widget drag".to_owned());
    }
    Ok(completed)
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

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeDragReleasePayload {
    window_label: &'static str,
    drag_token: u64,
}

#[derive(Clone, Copy, Debug)]
struct PreparedDrag {
    widget_id: WidgetId,
    origin: DragSnapshotPayload,
    release_observed: bool,
}

fn observe_native_drag_release(
    prepared_drags: &mut HashMap<u64, PreparedDrag>,
    window_label: WindowLabel,
) -> Option<NativeDragReleasePayload> {
    let WindowLabel::Widget(widget_id) = window_label else {
        return None;
    };
    let matching_tokens: Vec<_> = prepared_drags
        .iter()
        .filter_map(|(token, prepared)| {
            (prepared.widget_id == widget_id && !prepared.release_observed).then_some(*token)
        })
        .collect();
    let [drag_token] = matching_tokens.as_slice() else {
        return None;
    };
    prepared_drags.get_mut(drag_token)?.release_observed = true;
    Some(NativeDragReleasePayload {
        window_label: window_label.label(),
        drag_token: *drag_token,
    })
}

fn take_released_drag(
    prepared_drags: &mut HashMap<u64, PreparedDrag>,
    widget_id: WidgetId,
    drag_token: u64,
) -> Result<PreparedDrag, String> {
    let prepared = prepared_drags
        .remove(&drag_token)
        .ok_or_else(|| "native drag token is missing, expired, or already consumed".to_owned())?;
    if prepared.widget_id != widget_id {
        return Err("native drag token belongs to a different widget".to_owned());
    }
    if !prepared.release_observed {
        return Err("native drag token has no authoritative button-release evidence".to_owned());
    }
    Ok(prepared)
}

struct ControllerData {
    generations: ApplyGenerationTracker,
    layout: Option<ValidatedClusterLayout>,
    next_drag_token: u64,
    prepared_drags: HashMap<u64, PreparedDrag>,
}

pub(crate) struct WindowClusterController {
    app: AppHandle,
    pid: u32,
    data: StdMutex<ControllerData>,
    apply_lock: AsyncMutex<()>,
}

#[cfg(target_os = "linux")]
fn register_native_drag_release_observer(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    window_label: WindowLabel,
) -> Result<(), String> {
    if !matches!(window_label, WindowLabel::Widget(_)) {
        return Ok(());
    }
    let gtk_window = window.gtk_window().map_err(|error| {
        format!(
            "failed to access {} GTK window: {error}",
            window_label.label()
        )
    })?;
    gtk_window.add_events(gtk::gdk::EventMask::BUTTON_RELEASE_MASK);
    let app_on_release = app.clone();
    gtk_window.connect_event_after(move |_, event| {
        let Some(button) = event.downcast_ref::<gtk::gdk::EventButton>() else {
            return;
        };
        if event.event_type() != gtk::gdk::EventType::ButtonRelease || button.button() != 1 {
            return;
        }
        let payload = app_on_release
            .try_state::<WindowClusterController>()
            .and_then(|state| {
                state.data.lock().ok().and_then(|mut data| {
                    observe_native_drag_release(&mut data.prepared_drags, window_label)
                })
            });
        if let Some(payload) = payload {
            let _ =
                app_on_release.emit_to(window_label.label(), NATIVE_DRAG_RELEASE_EVENT, payload);
        }
    });
    Ok(())
}

#[cfg(target_os = "linux")]
fn register_dynamic_native_drag_release_observer(
    window: tauri::WebviewWindow,
    window_label: WindowLabel,
) -> Result<(), String> {
    let app = window.app_handle().clone();
    let window_on_main = window.clone();
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    window
        .run_on_main_thread(move || {
            let result = register_native_drag_release_observer(&app, &window_on_main, window_label);
            let _ = sender.send(result);
        })
        .map_err(|error| {
            format!(
                "failed to schedule {} release observer: {error}",
                window_label.label()
            )
        })?;
    receiver
        .recv_timeout(NATIVE_RELEASE_REGISTRATION_TIMEOUT)
        .map_err(|_| {
            format!(
                "{} release observer registration did not finish within the deadline",
                window_label.label()
            )
        })?
}

#[cfg(not(target_os = "linux"))]
fn register_dynamic_native_drag_release_observer(
    _window: tauri::WebviewWindow,
    _window_label: WindowLabel,
) -> Result<(), String> {
    Err("authoritative native drag release observation is only available on Linux".to_owned())
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
            next_drag_token: 0,
            prepared_drags: HashMap::new(),
        }),
        apply_lock: AsyncMutex::new(()),
    });
    #[cfg(target_os = "linux")]
    for spec in WINDOW_REGISTRY.iter().filter(|spec| spec.magnetic) {
        if let Some(window) = app.get_webview_window(spec.label.label()) {
            register_native_drag_release_observer(app.handle(), &window, spec.label)
                .map_err(std::io::Error::other)?;
        }
    }
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
        if spec.magnetic {
            if let Err(error) =
                register_dynamic_native_drag_release_observer(window.clone(), spec.label)
            {
                let _ = window.destroy();
                return Err(error);
            }
        }
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
    if !layout.edit_mode {
        data.prepared_drags.clear();
    }
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
    if !enabled {
        data.prepared_drags.clear();
    }
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

fn validate_drag_layout(
    layout: Option<&ValidatedClusterLayout>,
    widget_id: WidgetId,
) -> Result<(), String> {
    let layout = layout.ok_or_else(|| "window cluster is not initialized".to_owned())?;
    if !layout.edit_mode {
        return Err("window cluster is not in edit mode".to_owned());
    }
    if !layout
        .placements
        .iter()
        .any(|placement| placement.widget_id == widget_id && placement.visible)
    {
        return Err("dragged widget has no visible placement".to_owned());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn prepare_widget_drag(
    state: State<'_, WindowClusterController>,
    widget_id: String,
) -> Result<u64, String> {
    let widget_id = WidgetId::from_str(&widget_id)?;
    {
        let data = state
            .data
            .lock()
            .map_err(|_| "window cluster state is unavailable".to_owned())?;
        validate_drag_layout(data.layout.as_ref(), widget_id)?;
    }
    let output = current_output_rect(&state.app)?;

    #[cfg(target_os = "linux")]
    let origin = {
        let pid = state.pid;
        tauri::async_runtime::spawn_blocking(move || {
            let snapshot = run_niri_command(&["msg", "--json", "windows"])?;
            if !snapshot.success {
                return Err(format!(
                    "Niri windows command failed: {}",
                    String::from_utf8_lossy(&snapshot.stderr)
                ));
            }
            drag_snapshot_from_payload(&snapshot.stdout, pid, widget_id, output)
        })
        .await
        .map_err(|error| format!("Niri drag preparation worker failed: {error}"))??
    };

    #[cfg(not(target_os = "linux"))]
    let origin = {
        let _ = output;
        return Err("Niri drag preparation is only available on Linux".to_owned());
    };

    let mut data = state
        .data
        .lock()
        .map_err(|_| "window cluster state is unavailable".to_owned())?;
    validate_drag_layout(data.layout.as_ref(), widget_id)?;
    data.next_drag_token = data
        .next_drag_token
        .checked_add(1)
        .ok_or_else(|| "native drag token space was exhausted".to_owned())?;
    let token = data.next_drag_token;
    data.prepared_drags
        .retain(|_, prepared| prepared.widget_id != widget_id);
    data.prepared_drags.insert(
        token,
        PreparedDrag {
            widget_id,
            origin,
            release_observed: false,
        },
    );
    Ok(token)
}

#[tauri::command]
pub(crate) fn cancel_widget_drag(
    state: State<'_, WindowClusterController>,
    drag_token: u64,
) -> Result<(), String> {
    state
        .data
        .lock()
        .map_err(|_| "window cluster state is unavailable".to_owned())?
        .prepared_drags
        .remove(&drag_token);
    Ok(())
}

#[tauri::command]
pub(crate) async fn complete_widget_drag(
    state: State<'_, WindowClusterController>,
    widget_id: String,
    drag_token: u64,
) -> Result<DragSnapshotPayload, String> {
    let widget_id = WidgetId::from_str(&widget_id)?;
    let prepared = {
        let mut data = state
            .data
            .lock()
            .map_err(|_| "window cluster state is unavailable".to_owned())?;
        validate_drag_layout(data.layout.as_ref(), widget_id)?;
        take_released_drag(&mut data.prepared_drags, widget_id, drag_token)?
    };
    let output = current_output_rect(&state.app)?;

    #[cfg(target_os = "linux")]
    {
        let pid = state.pid;
        tauri::async_runtime::spawn_blocking(move || {
            let snapshot = run_niri_command(&["msg", "--json", "windows"])?;
            if !snapshot.success {
                return Err(format!(
                    "Niri windows command failed: {}",
                    String::from_utf8_lossy(&snapshot.stderr)
                ));
            }
            let completed = drag_snapshot_from_payload(&snapshot.stdout, pid, widget_id, output)?;
            validate_completed_drag(prepared.origin, completed)
        })
        .await
        .map_err(|error| format!("Niri drag snapshot worker failed: {error}"))?
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = (widget_id, output, prepared);
        Err("Niri drag completion is only available on Linux".to_owned())
    }
}

#[tauri::command]
pub(crate) async fn get_cluster_geometry(
    state: State<'_, WindowClusterController>,
) -> Result<ClusterGeometryPayload, String> {
    let output = current_output_rect(&state.app)?;

    #[cfg(target_os = "linux")]
    {
        let pid = state.pid;
        tauri::async_runtime::spawn_blocking(move || {
            let snapshot = run_niri_command(&["msg", "--json", "windows"])?;
            if !snapshot.success {
                return Err("Niri windows command failed".to_owned());
            }
            cluster_geometry_from_payload(&snapshot.stdout, pid, output)
        })
        .await
        .map_err(|error| format!("Niri geometry worker failed: {error}"))?
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = output;
        Err("Niri geometry is only available on Linux".to_owned())
    }
}

#[cfg(target_os = "linux")]
#[derive(Debug)]
struct NiriCommandOutput {
    success: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

#[cfg(target_os = "linux")]
fn set_nonblocking<T: AsRawFd>(pipe: &T) -> Result<(), String> {
    let descriptor = pipe.as_raw_fd();
    let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFL) };
    if flags < 0 {
        return Err(format!(
            "failed to read command pipe flags: {}",
            std::io::Error::last_os_error()
        ));
    }
    if unsafe { libc::fcntl(descriptor, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(format!(
            "failed to bound command pipe reads: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn drain_pipe<R: Read>(
    pipe: &mut R,
    output: &mut Vec<u8>,
    output_limit: usize,
    stream_name: &str,
) -> Result<bool, String> {
    let mut chunk = [0_u8; 8192];
    loop {
        match pipe.read(&mut chunk) {
            Ok(0) => return Ok(true),
            Ok(read) => {
                if read > output_limit.saturating_sub(output.len()) {
                    return Err(format!("{stream_name} exceeded the command output limit"));
                }
                output.extend_from_slice(&chunk[..read]);
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => return Ok(false),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(format!("failed to read command {stream_name}: {error}")),
        }
    }
}

#[cfg(target_os = "linux")]
fn terminate_process_group(child: &mut Child) {
    let process_group = i32::try_from(child.id()).unwrap_or(i32::MAX);
    unsafe {
        libc::kill(-process_group, libc::SIGKILL);
    }
    let _ = child.kill();
}

#[cfg(target_os = "linux")]
fn reap_until(child: &mut Child, deadline: Instant) -> Result<ExitStatus, String> {
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) if Instant::now() < deadline => {
                let remaining = deadline.saturating_duration_since(Instant::now());
                thread::sleep(PROCESS_POLL_DELAY.min(remaining));
            }
            Ok(None) => {
                return Err("command cleanup deadline elapsed before child reaping".to_owned())
            }
            Err(error) => return Err(format!("failed while reaping command: {error}")),
        }
    }
}

#[cfg(target_os = "linux")]
fn run_command_with_limits(
    program: &str,
    arguments: &[&str],
    timeout: Duration,
    output_limit: usize,
) -> Result<NiriCommandOutput, String> {
    if timeout.is_zero() || output_limit == 0 {
        return Err("command bounds must be positive".to_owned());
    }
    let started = Instant::now();
    let deadline = started + timeout;
    let cleanup_reserve = PROCESS_CLEANUP_RESERVE.min(timeout / 2);
    let execution_deadline = deadline - cleanup_reserve;
    let mut child = Command::new(program)
        .args(arguments)
        .process_group(0)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("could not start bounded command {program}: {error}"))?;
    let mut stdout: ChildStdout = child.stdout.take().ok_or_else(|| {
        terminate_process_group(&mut child);
        let _ = reap_until(&mut child, deadline);
        "command stdout was unavailable".to_owned()
    })?;
    let mut stderr: ChildStderr = child.stderr.take().ok_or_else(|| {
        terminate_process_group(&mut child);
        let _ = reap_until(&mut child, deadline);
        "command stderr was unavailable".to_owned()
    })?;
    if let Err(error) = set_nonblocking(&stdout).and_then(|()| set_nonblocking(&stderr)) {
        terminate_process_group(&mut child);
        reap_until(&mut child, deadline)?;
        return Err(error);
    }

    let mut stdout_bytes = Vec::new();
    let mut stderr_bytes = Vec::new();
    let mut stdout_eof = false;
    let mut stderr_eof = false;
    let mut status = None;
    let mut failure: Option<String> = None;
    let mut terminated = false;

    loop {
        if !stdout_eof {
            match drain_pipe(&mut stdout, &mut stdout_bytes, output_limit, "stdout") {
                Ok(eof) => stdout_eof = eof,
                Err(error) => {
                    failure.get_or_insert(error);
                }
            };
        }
        if !stderr_eof {
            match drain_pipe(&mut stderr, &mut stderr_bytes, output_limit, "stderr") {
                Ok(eof) => stderr_eof = eof,
                Err(error) => {
                    failure.get_or_insert(error);
                }
            };
        }
        if status.is_none() {
            match child.try_wait() {
                Ok(next) => status = next,
                Err(error) => {
                    failure.get_or_insert_with(|| {
                        format!("failed while waiting for bounded command: {error}")
                    });
                }
            }
        }

        if stdout_eof && stderr_eof {
            if let Some(completed_status) = status {
                if let Some(error) = failure {
                    return Err(error);
                }
                return Ok(NiriCommandOutput {
                    success: completed_status.success(),
                    stdout: stdout_bytes,
                    stderr: stderr_bytes,
                });
            }
        }

        let now = Instant::now();
        if failure.is_none() && now >= execution_deadline {
            failure = Some(if status.is_some() {
                "command descendants held output pipes beyond the deadline".to_owned()
            } else {
                "command timed out".to_owned()
            });
        }
        if failure.is_some() && !terminated {
            terminate_process_group(&mut child);
            terminated = true;
        }
        if now >= deadline {
            if status.is_none() {
                return match reap_until(&mut child, deadline) {
                    Ok(_) => Err(failure.unwrap_or_else(|| {
                        "bounded command exceeded its wall-clock deadline".to_owned()
                    })),
                    Err(cleanup_error) => Err(format!(
                        "{}; {cleanup_error}",
                        failure.unwrap_or_else(|| "bounded command did not complete".to_owned())
                    )),
                };
            }
            return Err(failure.unwrap_or_else(|| {
                "command output pipes did not close within the wall-clock bound".to_owned()
            }));
        }
        let remaining = deadline.saturating_duration_since(now);
        thread::sleep(PROCESS_POLL_DELAY.min(remaining));
    }
}

#[cfg(target_os = "linux")]
fn run_niri_command(arguments: &[&str]) -> Result<NiriCommandOutput, String> {
    run_command_with_limits("niri", arguments, NIRI_EXEC_TIMEOUT, NIRI_OUTPUT_LIMIT)
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
    niri_window_rect(windows, pid, WindowLabel::Main)
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
        close_disposition, cluster_geometry_from_payload, committed_visibility,
        drag_snapshot_from_payload, find_niri_windows, observe_native_drag_release, project_layout,
        run_command_with_limits, take_released_drag, validate_completed_drag, validate_layout,
        visible_projected_widget_ids, AppliedNiriLayout, ApplyGenerationTracker, CloseDisposition,
        ClusterLayoutV1Payload, Lane, PreparedDrag, Rect, Side, SizePreset, WidgetId,
        WidgetPlacementPayload, WindowLabel, WINDOW_REGISTRY,
    };
    use std::{
        collections::{HashMap, HashSet},
        fs,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
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
    fn complete_command_helper_times_out_kills_and_reaps() {
        let pid_file = std::env::temp_dir().join(format!(
            "presenced-niri-helper-{}-{}.pid",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let script = format!("printf '%s' $$ > {}; exec sleep 5", pid_file.display());
        let started = Instant::now();

        let result =
            run_command_with_limits("sh", &["-c", &script], Duration::from_millis(120), 1024);

        assert!(result.is_err());
        assert!(started.elapsed() < Duration::from_secs(1));
        let pid: i32 = fs::read_to_string(&pid_file).unwrap().parse().unwrap();
        let probe = unsafe { libc::kill(pid, 0) };
        assert_eq!(
            probe, -1,
            "timed-out direct child must be killed and reaped"
        );
        let _ = fs::remove_file(pid_file);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn complete_command_helper_caps_stdout_and_stderr() {
        for script in [
            "dd if=/dev/zero bs=4096 count=1 2>/dev/null",
            "dd if=/dev/zero bs=4096 count=1 1>&2 2>/dev/null",
        ] {
            let started = Instant::now();
            let result =
                run_command_with_limits("sh", &["-c", script], Duration::from_millis(500), 1024);
            assert!(result.unwrap_err().contains("output limit"));
            assert!(started.elapsed() < Duration::from_secs(1));
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn complete_command_helper_bounds_inherited_held_pipe_handles() {
        let started = Instant::now();
        let result = run_command_with_limits(
            "sh",
            &["-c", "sleep 5 & printf '{}'"],
            Duration::from_millis(120),
            1024,
        );

        assert!(result.is_err());
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn complete_command_helper_returns_successful_bounded_json_and_stderr() {
        let output = run_command_with_limits(
            "sh",
            &["-c", "printf '{\"ok\":true}'; printf warning >&2"],
            Duration::from_millis(500),
            1024,
        )
        .unwrap();

        assert!(output.success);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&output.stdout).unwrap(),
            serde_json::json!({"ok": true})
        );
        assert_eq!(output.stderr, b"warning");
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
    fn returns_validated_plain_drag_main_and_output_rectangles_from_one_snapshot() {
        let json = br#"[
          {"id": 11, "pid": 55, "title": "presenced:widget-main", "layout": {"tile_pos_in_workspace_view": [600.0, 330.0], "window_size": [720, 420]}},
          {"id": 12, "pid": 55, "title": "presenced:widget-rvc", "layout": {"tile_pos_in_workspace_view": [345.0, 334.0], "window_size": [250, 190]}}
        ]"#;
        let output = Rect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };

        let snapshot = drag_snapshot_from_payload(json, 55, WidgetId::Rvc, output).unwrap();

        assert_eq!(
            snapshot.dragged,
            Rect {
                x: 345,
                y: 334,
                width: 250,
                height: 190
            }
        );
        assert_eq!(
            snapshot.main,
            Rect {
                x: 600,
                y: 330,
                width: 720,
                height: 420
            }
        );
        assert_eq!(snapshot.output, output);
        let geometry = cluster_geometry_from_payload(json, 55, output).unwrap();
        assert_eq!(geometry.main, snapshot.main);
        assert_eq!(geometry.output, output);
        assert_eq!(
            serde_json::to_value(snapshot).unwrap(),
            serde_json::json!({
                "dragged": {"x": 345, "y": 334, "width": 250, "height": 190},
                "main": {"x": 600, "y": 330, "width": 720, "height": 420},
                "output": {"x": 0, "y": 0, "width": 1920, "height": 1080}
            })
        );
    }

    #[test]
    fn drag_snapshot_rejects_missing_duplicate_or_invalid_rectangles() {
        let output = Rect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let missing_dragged = br#"[
          {"id": 11, "pid": 55, "title": "presenced:widget-main", "layout": {"tile_pos_in_workspace_view": [600.0, 330.0], "window_size": [720, 420]}}
        ]"#;
        assert!(drag_snapshot_from_payload(missing_dragged, 55, WidgetId::Rvc, output).is_err());

        let duplicate_dragged = br#"[
          {"id": 11, "pid": 55, "title": "presenced:widget-main", "layout": {"tile_pos_in_workspace_view": [600.0, 330.0], "window_size": [720, 420]}},
          {"id": 12, "pid": 55, "title": "presenced:widget-rvc", "layout": {"tile_pos_in_workspace_view": [345.0, 334.0], "window_size": [250, 190]}},
          {"id": 13, "pid": 55, "title": "presenced:widget-rvc", "layout": {"tile_pos_in_workspace_view": [346.0, 334.0], "window_size": [250, 190]}}
        ]"#;
        assert!(drag_snapshot_from_payload(duplicate_dragged, 55, WidgetId::Rvc, output).is_err());

        let zero_sized = br#"[
          {"id": 11, "pid": 55, "title": "presenced:widget-main", "layout": {"tile_pos_in_workspace_view": [600.0, 330.0], "window_size": [720, 420]}},
          {"id": 12, "pid": 55, "title": "presenced:widget-rvc", "layout": {"tile_pos_in_workspace_view": [345.0, 334.0], "window_size": [0, 190]}}
        ]"#;
        assert!(drag_snapshot_from_payload(zero_sized, 55, WidgetId::Rvc, output).is_err());

        let dragged_outside = br#"[
          {"id": 11, "pid": 55, "title": "presenced:widget-main", "layout": {"tile_pos_in_workspace_view": [600.0, 330.0], "window_size": [720, 420]}},
          {"id": 12, "pid": 55, "title": "presenced:widget-rvc", "layout": {"tile_pos_in_workspace_view": [-1.0, 334.0], "window_size": [250, 190]}}
        ]"#;
        assert!(drag_snapshot_from_payload(dragged_outside, 55, WidgetId::Rvc, output).is_err());

        let main_outside = br#"[
          {"id": 11, "pid": 55, "title": "presenced:widget-main", "layout": {"tile_pos_in_workspace_view": [1500.0, 330.0], "window_size": [720, 420]}},
          {"id": 12, "pid": 55, "title": "presenced:widget-rvc", "layout": {"tile_pos_in_workspace_view": [345.0, 334.0], "window_size": [250, 190]}}
        ]"#;
        assert!(cluster_geometry_from_payload(main_outside, 55, output).is_err());
        assert!(drag_snapshot_from_payload(main_outside, 55, WidgetId::Rvc, output).is_err());
    }

    #[test]
    fn completed_drag_requires_real_movement_and_stable_main_output() {
        let output = Rect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let origin = super::DragSnapshotPayload {
            dragged: Rect {
                x: 340,
                y: 330,
                width: 250,
                height: 190,
            },
            main: Rect {
                x: 600,
                y: 330,
                width: 720,
                height: 420,
            },
            output,
        };
        let moved = super::DragSnapshotPayload {
            dragged: Rect {
                x: 350,
                ..origin.dragged
            },
            ..origin
        };

        assert!(validate_completed_drag(origin, moved).is_ok());
        assert!(validate_completed_drag(origin, origin).is_err());
        assert!(validate_completed_drag(
            origin,
            super::DragSnapshotPayload {
                main: Rect {
                    x: 601,
                    ..origin.main
                },
                ..moved
            }
        )
        .is_err());
        assert!(validate_completed_drag(
            origin,
            super::DragSnapshotPayload {
                output: Rect {
                    width: 1280,
                    ..output
                },
                ..moved
            }
        )
        .is_err());
    }

    #[test]
    fn native_release_requires_exact_widget_label_and_is_one_use() {
        let origin = super::DragSnapshotPayload {
            dragged: Rect {
                x: 340,
                y: 330,
                width: 250,
                height: 190,
            },
            main: Rect {
                x: 600,
                y: 330,
                width: 720,
                height: 420,
            },
            output: Rect {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            },
        };
        let mut prepared = HashMap::from([(
            71,
            PreparedDrag {
                widget_id: WidgetId::Music,
                origin,
                release_observed: false,
            },
        )]);

        assert!(observe_native_drag_release(&mut prepared, WindowLabel::Main).is_none());
        assert!(
            observe_native_drag_release(&mut prepared, WindowLabel::Widget(WidgetId::Rvc))
                .is_none()
        );
        let release =
            observe_native_drag_release(&mut prepared, WindowLabel::Widget(WidgetId::Music))
                .unwrap();
        assert_eq!(release.window_label, "widget-music");
        assert_eq!(release.drag_token, 71);
        assert!(
            observe_native_drag_release(&mut prepared, WindowLabel::Widget(WidgetId::Music))
                .is_none()
        );
    }

    #[test]
    fn completion_consumes_tokens_and_requires_prior_exact_release() {
        let origin = super::DragSnapshotPayload {
            dragged: Rect {
                x: 340,
                y: 330,
                width: 250,
                height: 190,
            },
            main: Rect {
                x: 600,
                y: 330,
                width: 720,
                height: 420,
            },
            output: Rect {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            },
        };
        let prepared_drag = || PreparedDrag {
            widget_id: WidgetId::Music,
            origin,
            release_observed: false,
        };

        let mut early = HashMap::from([(72, prepared_drag())]);
        assert!(take_released_drag(&mut early, WidgetId::Music, 72)
            .unwrap_err()
            .contains("release"));
        assert!(!early.contains_key(&72));

        let mut wrong_widget = HashMap::from([(73, prepared_drag())]);
        assert!(observe_native_drag_release(
            &mut wrong_widget,
            WindowLabel::Widget(WidgetId::Music)
        )
        .is_some());
        assert!(take_released_drag(&mut wrong_widget, WidgetId::Rvc, 73).is_err());
        assert!(!wrong_widget.contains_key(&73));

        let mut completed = HashMap::from([(74, prepared_drag())]);
        assert!(
            observe_native_drag_release(&mut completed, WindowLabel::Widget(WidgetId::Music))
                .is_some()
        );
        assert_eq!(
            take_released_drag(&mut completed, WidgetId::Music, 74)
                .unwrap()
                .origin,
            origin
        );
        assert!(take_released_drag(&mut completed, WidgetId::Music, 74).is_err());
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
