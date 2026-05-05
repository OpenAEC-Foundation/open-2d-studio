//! `FilePicker` — in-app modal that replaces the native rfd Open dialog
//! for DWG / DXF / IFCDraw selection.
//!
//! Goals (vs. the native dialog):
//!   * Show a small **preview thumbnail** for each candidate file.
//!   * Show the **CAD-version badge** (R2010 / R2013 / R2018 / DXF
//!     AC1024 / IFCDraw / ...) right on the tile.
//!   * Stay inside the app window — no native chrome jumps around.
//!
//! Architecture:
//!   * Pure UI here. All heavy lifting (parsing the file to extract
//!     preview segments, hashing, caching to disk, threading) lives in
//!     the consumer (open_2d_studio.rs) and is funneled in via a
//!     `PreviewProvider` trait. That keeps `superui` parser-free and
//!     dependency-light.
//!   * Version detection IS done here via [`super::file_version`] —
//!     it's small (header read only) and useful as a building block.
//!   * Caller drives the lifecycle: instantiate once, store in app
//!     state, call `show()` each frame while open. On user click of
//!     "Open", `show()` returns `Some(FilePickerAction::Open(path))`.
//!
//! What this dialog does NOT do (kept native to rfd intentionally):
//!   * Save dialogs.
//!   * Folder pickers.
//!   * Any file write.

use crate::theme::Theme;
use egui::{Color32, ColorImage, Context, Pos2, RichText, Sense, TextureHandle, Ui};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::file_version::detect_version;

/// Action returned by the picker once the user clicks Open or Cancel.
#[derive(Debug, Clone)]
pub enum FilePickerAction {
    Open(PathBuf),
    Cancelled,
}

/// What the consumer hands us about each preview. The consumer is
/// expected to do the actual file parse off the UI thread and cache the
/// result so subsequent frames just look up the entry.
pub struct PreviewEntry {
    /// Pre-rasterized preview image (typically 160×120). `None` while
    /// the consumer is still computing it — we'll show a placeholder.
    pub image: Option<ColorImage>,
    /// True once the consumer is done trying — on failure leave
    /// `image` None and we show a "no preview" tile.
    pub finished: bool,
}

/// Trait the consumer implements to feed previews into the picker. The
/// picker calls `request(path)` once per visible tile per frame; the
/// consumer should kick off background work the first time and return
/// the cached entry thereafter.
pub trait PreviewProvider {
    /// Request a preview for `path`. Returning `None` means "not yet
    /// queued" — the picker will show a queued placeholder. The
    /// consumer is responsible for de-duplicating concurrent requests
    /// for the same path.
    fn request(&mut self, path: &Path) -> Option<&PreviewEntry>;
}

/// Persistent state for the picker — owned by the consumer across
/// frames so navigation history, the currently-selected file, and the
/// version-cache survive between repaints.
pub struct FilePickerState {
    /// Directory currently shown in the center pane.
    pub cwd: PathBuf,
    /// Currently selected entry (path + is_dir).
    pub selected: Option<PathBuf>,
    /// Version-string cache keyed by path. Detection is cheap but not
    /// free — caching avoids re-reading every header on every repaint.
    versions: HashMap<PathBuf, String>,
    /// egui texture handles per-path so we don't re-upload the same
    /// preview every frame.
    textures: HashMap<PathBuf, TextureHandle>,
    /// Recent directories (parent of recently opened files). Persisted
    /// elsewhere by the caller; we just display.
    pub recents: Vec<PathBuf>,
    /// Show hidden / non-CAD files as well? Default false.
    pub show_all: bool,
}

impl FilePickerState {
    pub fn new(start_dir: PathBuf, recents: Vec<PathBuf>) -> Self {
        Self {
            cwd: start_dir,
            selected: None,
            versions: HashMap::new(),
            textures: HashMap::new(),
            recents,
            show_all: false,
        }
    }

    /// Drop the cached texture for `path` — call when the consumer has
    /// produced a new preview image and wants the picker to re-upload.
    pub fn invalidate_texture(&mut self, path: &Path) {
        self.textures.remove(path);
    }
}

pub struct FilePicker;

impl FilePicker {
    /// Render one frame of the picker. Returns `Some(action)` when the
    /// user clicks Open or Cancel; `None` while still browsing.
    ///
    /// `open` is set to false once a terminal action is returned so the
    /// caller can use the same flag for `if state.is_some()` loops.
    pub fn show(
        ctx: &Context,
        state: &mut FilePickerState,
        provider: &mut dyn PreviewProvider,
        open: &mut bool,
    ) -> Option<FilePickerAction> {
        if !*open {
            return None;
        }
        let palette = Theme::Default.palette();
        let mut action: Option<FilePickerAction> = None;
        let mut local_open = *open;
        // Bigger window — needs room for tree + grid + detail. Modal
        // feel via `collapsible(false)` and centered on screen.
        let screen = ctx.screen_rect();
        let win_w = (screen.width() * 0.85).clamp(900.0, 1400.0);
        let win_h = (screen.height() * 0.80).clamp(600.0, 950.0);
        let pos = Pos2::new(
            screen.center().x - win_w * 0.5,
            screen.center().y - win_h * 0.5,
        );

        egui::Window::new("Open file")
            .title_bar(true)
            .resizable(true)
            .collapsible(false)
            .open(&mut local_open)
            .default_pos(pos)
            .default_size([win_w, win_h])
            .frame(
                egui::Frame::window(&ctx.style())
                    .fill(palette.panel_bg)
                    .stroke(egui::Stroke::new(1.0, palette.border)),
            )
            .show(ctx, |ui| {
                let avail = ui.available_size();
                ui.horizontal(|ui| {
                    // ---- Left pane: shortcuts + recents -----------------------
                    ui.vertical(|ui| {
                        ui.set_width(220.0);
                        ui.set_height(avail.y - 40.0);
                        ui.label(RichText::new("Shortcuts").color(palette.fg_dim).small());
                        for short in shortcut_dirs() {
                            if let Some(label) = short.file_name().and_then(|s| s.to_str()) {
                                if ui.button(label).clicked() {
                                    state.cwd = short;
                                    state.selected = None;
                                }
                            }
                        }
                        ui.add_space(8.0);
                        ui.label(RichText::new("Recent folders").color(palette.fg_dim).small());
                        let recents = state.recents.clone();
                        for r in recents {
                            let label = r.file_name()
                                .and_then(|s| s.to_str())
                                .unwrap_or_else(|| r.to_str().unwrap_or(""));
                            if ui.button(label)
                                .on_hover_text(r.to_string_lossy())
                                .clicked()
                            {
                                state.cwd = r;
                                state.selected = None;
                            }
                        }
                    });

                    ui.separator();

                    // ---- Center pane: breadcrumb + grid -----------------------
                    ui.vertical(|ui| {
                        let center_w = avail.x - 220.0 - 280.0 - 20.0;
                        ui.set_width(center_w.max(400.0));
                        ui.set_height(avail.y - 40.0);

                        // Breadcrumb / up button
                        ui.horizontal(|ui| {
                            if ui.button("Up").clicked() {
                                if let Some(parent) = state.cwd.parent() {
                                    state.cwd = parent.to_path_buf();
                                    state.selected = None;
                                }
                            }
                            ui.label(state.cwd.to_string_lossy().into_owned());
                        });
                        ui.separator();

                        // Read directory listing.
                        let (dirs, files) = read_dir_classified(&state.cwd, state.show_all);

                        egui::ScrollArea::vertical()
                            .auto_shrink([false; 2])
                            .show(ui, |ui| {
                                // Folders first (compact list), then file tiles.
                                for d in &dirs {
                                    let name = d.file_name()
                                        .and_then(|s| s.to_str())
                                        .unwrap_or("")
                                        .to_string();
                                    if ui.button(format!("[ {name} ]")).clicked() {
                                        state.cwd = d.clone();
                                        state.selected = None;
                                    }
                                }
                                ui.add_space(8.0);

                                // 200×200 tile grid using ui.horizontal_wrapped.
                                ui.horizontal_wrapped(|ui| {
                                    for f in &files {
                                        draw_tile(
                                            ui,
                                            ctx,
                                            f,
                                            state,
                                            provider,
                                            &palette,
                                        );
                                    }
                                });
                            });
                    });

                    ui.separator();

                    // ---- Right pane: detail panel -----------------------------
                    ui.vertical(|ui| {
                        ui.set_width(280.0);
                        ui.set_height(avail.y - 40.0);
                        ui.label(RichText::new("Details").strong());
                        ui.separator();
                        if let Some(sel) = state.selected.clone() {
                            ui.label(
                                RichText::new(
                                    sel.file_name()
                                        .and_then(|s| s.to_str())
                                        .unwrap_or("?")
                                        .to_string(),
                                )
                                .strong(),
                            );
                            ui.label(sel.to_string_lossy().into_owned());
                            ui.separator();

                            let meta = std::fs::metadata(&sel).ok();
                            if let Some(m) = &meta {
                                ui.label(format!("Size: {}", human_size(m.len())));
                                if let Ok(modified) = m.modified() {
                                    ui.label(format!("Modified: {}", format_time(modified)));
                                }
                            }
                            let ver = ensure_version(state, &sel);
                            ui.label(format!("Version: {ver}"));
                            ui.add_space(12.0);
                            if ui
                                .add_sized([260.0, 32.0], egui::Button::new("Open"))
                                .clicked()
                            {
                                action = Some(FilePickerAction::Open(sel.clone()));
                            }
                        } else {
                            ui.label(
                                RichText::new("Select a file to see details")
                                    .color(palette.fg_dim),
                            );
                        }
                    });
                });

                ui.separator();
                ui.horizontal(|ui| {
                    if ui.button("Cancel").clicked() {
                        action = Some(FilePickerAction::Cancelled);
                    }
                    ui.add_space(8.0);
                    let can_open = state.selected.is_some();
                    if ui
                        .add_enabled(can_open, egui::Button::new("Open selected"))
                        .clicked()
                    {
                        if let Some(sel) = state.selected.clone() {
                            action = Some(FilePickerAction::Open(sel));
                        }
                    }
                });
            });
        *open = local_open;
        if action.is_some() {
            *open = false;
        }
        action
    }
}

fn ensure_version(state: &mut FilePickerState, path: &Path) -> String {
    if let Some(v) = state.versions.get(path) {
        return v.clone();
    }
    let v = detect_version(path);
    state.versions.insert(path.to_path_buf(), v.clone());
    v
}

fn draw_tile(
    ui: &mut Ui,
    ctx: &Context,
    path: &Path,
    state: &mut FilePickerState,
    provider: &mut dyn PreviewProvider,
    palette: &crate::theme::Palette,
) {
    let tile_size = egui::vec2(200.0, 200.0);
    let (rect, resp) = ui.allocate_exact_size(tile_size, Sense::click());

    let selected = state.selected.as_deref() == Some(path);
    let bg = if selected {
        palette.button_active
    } else if resp.hovered() {
        palette.button_hover
    } else {
        palette.button_bg
    };
    ui.painter().rect_filled(rect, 4.0, bg);
    ui.painter().rect_stroke(rect, 4.0, egui::Stroke::new(1.0, palette.border));

    // Preview area (160×120 centered, top portion of tile).
    let preview_rect = egui::Rect::from_min_size(
        egui::pos2(rect.left() + 20.0, rect.top() + 8.0),
        egui::vec2(160.0, 120.0),
    );
    ui.painter().rect_filled(preview_rect, 2.0, Color32::from_rgb(245, 245, 245));

    // Pull preview from provider; upload as texture once available.
    let preview = provider.request(path);
    let need_upload = match (preview, state.textures.get(path)) {
        (Some(entry), None) if entry.image.is_some() => true,
        _ => false,
    };
    if need_upload {
        if let Some(entry) = provider.request(path) {
            if let Some(img) = entry.image.as_ref() {
                let tex = ctx.load_texture(
                    format!("file_picker:{}", path.display()),
                    img.clone(),
                    Default::default(),
                );
                state.textures.insert(path.to_path_buf(), tex);
            }
        }
    }
    if let Some(tex) = state.textures.get(path) {
        ui.painter().image(
            tex.id(),
            preview_rect,
            egui::Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)),
            Color32::WHITE,
        );
    } else {
        // Placeholder hatch — three dots.
        let cy = preview_rect.center().y;
        for i in 0..3 {
            let cx = preview_rect.center().x + (i as f32 - 1.0) * 8.0;
            ui.painter().circle_filled(egui::pos2(cx, cy), 2.5, palette.fg_dim);
        }
    }

    // Version badge — top-right corner of tile.
    let ver = ensure_version(state, path);
    let badge_text = ver.clone();
    let badge_pos = egui::pos2(rect.right() - 6.0, rect.top() + 6.0);
    let galley = ui.painter().layout_no_wrap(
        badge_text,
        egui::FontId::proportional(11.0),
        Color32::WHITE,
    );
    let bg_rect = egui::Rect::from_min_size(
        egui::pos2(
            badge_pos.x - galley.size().x - 6.0,
            badge_pos.y,
        ),
        egui::vec2(galley.size().x + 6.0, galley.size().y + 2.0),
    );
    ui.painter().rect_filled(bg_rect, 2.0, palette.accent);
    ui.painter().galley(bg_rect.min + egui::vec2(3.0, 1.0), galley, Color32::WHITE);

    // Filename (truncated) + size below preview.
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("?");
    let max_name_chars = 22usize;
    let display_name = if name.chars().count() > max_name_chars {
        let mut s: String = name.chars().take(max_name_chars - 1).collect();
        s.push('…');
        s
    } else {
        name.to_string()
    };
    let size_str = std::fs::metadata(path)
        .map(|m| human_size(m.len()))
        .unwrap_or_default();

    ui.painter().text(
        egui::pos2(rect.left() + 8.0, preview_rect.bottom() + 6.0),
        egui::Align2::LEFT_TOP,
        display_name,
        egui::FontId::proportional(12.0),
        palette.fg,
    );
    ui.painter().text(
        egui::pos2(rect.left() + 8.0, preview_rect.bottom() + 24.0),
        egui::Align2::LEFT_TOP,
        size_str,
        egui::FontId::proportional(11.0),
        palette.fg_dim,
    );

    if resp.clicked() {
        state.selected = Some(path.to_path_buf());
    }
    if resp.double_clicked() {
        state.selected = Some(path.to_path_buf());
    }
}

fn shortcut_dirs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let home = PathBuf::from(home);
        let docs = home.join("Documents");
        let desk = home.join("Desktop");
        if docs.is_dir() {
            out.push(docs);
        }
        if desk.is_dir() {
            out.push(desk);
        }
        out.push(home);
    }
    out
}

fn read_dir_classified(dir: &Path, show_all: bool) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir) else {
        return (dirs, files);
    };
    for entry in rd.flatten() {
        let path = entry.path();
        let Ok(ft) = entry.file_type() else { continue; };
        if ft.is_dir() {
            // Hide hidden dotfiles and known noisy roots.
            let name = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or_default();
            if !show_all && name.starts_with('.') {
                continue;
            }
            dirs.push(path);
        } else if ft.is_file() {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_ascii_lowercase())
                .unwrap_or_default();
            if show_all || matches!(ext.as_str(), "dwg" | "dxf" | "ifcdraw") {
                files.push(path);
            }
        }
    }
    dirs.sort();
    files.sort();
    (dirs, files)
}

fn human_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{bytes} B")
    }
}

fn format_time(t: std::time::SystemTime) -> String {
    // Avoid pulling chrono — show relative seconds-since-epoch resolved
    // to date by std::time::Duration.
    match t.duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => {
            let secs = d.as_secs() as i64;
            // Naive Y/M/D. Good enough for a "modified" badge.
            let days = secs / 86400;
            // 1970-01-01 + days. Use a simple civil-from-days conversion.
            let (y, m, day) = civil_from_days(days);
            format!("{y:04}-{m:02}-{day:02}")
        }
        Err(_) => "?".to_string(),
    }
}

/// Convert "days since 1970-01-01" to (year, month, day). Howard Hinnant's
/// civil_from_days algorithm — public domain. Used to avoid a chrono dep.
fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d)
}
