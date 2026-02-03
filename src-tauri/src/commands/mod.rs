use serde::{Deserialize, Serialize};
use std::fs;
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveResult {
    success: bool,
    message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoadResult {
    success: bool,
    data: Option<String>,
    message: String,
}

/// Save drawing to native JSON format
#[tauri::command]
pub fn save_file(path: String, data: String) -> SaveResult {
    match fs::write(&path, &data) {
        Ok(_) => SaveResult {
            success: true,
            message: format!("File saved to {}", path),
        },
        Err(e) => SaveResult {
            success: false,
            message: format!("Failed to save file: {}", e),
        },
    }
}

/// Load drawing from native JSON format
#[tauri::command]
pub fn load_file(path: String) -> LoadResult {
    match fs::read_to_string(&path) {
        Ok(content) => LoadResult {
            success: true,
            data: Some(content),
            message: "File loaded successfully".to_string(),
        },
        Err(e) => LoadResult {
            success: false,
            data: None,
            message: format!("Failed to load file: {}", e),
        },
    }
}

/// Export drawing to DXF format
#[tauri::command]
pub fn export_dxf(path: String, shapes_json: String) -> SaveResult {
    // Parse shapes from JSON
    let shapes: Vec<ShapeData> = match serde_json::from_str(&shapes_json) {
        Ok(s) => s,
        Err(e) => {
            return SaveResult {
                success: false,
                message: format!("Failed to parse shapes: {}", e),
            }
        }
    };

    // Create DXF drawing
    let mut drawing = dxf::Drawing::new();

    for shape in shapes {
        match shape.shape_type.as_str() {
            "line" => {
                if let (Some(start), Some(end)) = (shape.start, shape.end) {
                    let line = dxf::entities::Line::new(
                        dxf::Point::new(start.x, start.y, 0.0),
                        dxf::Point::new(end.x, end.y, 0.0),
                    );
                    drawing.add_entity(dxf::entities::Entity::new(
                        dxf::entities::EntityType::Line(line),
                    ));
                }
            }
            "circle" => {
                if let (Some(center), Some(radius)) = (shape.center, shape.radius) {
                    let circle = dxf::entities::Circle::new(
                        dxf::Point::new(center.x, center.y, 0.0),
                        radius,
                    );
                    drawing.add_entity(dxf::entities::Entity::new(
                        dxf::entities::EntityType::Circle(circle),
                    ));
                }
            }
            // Add more shape types as needed
            _ => {}
        }
    }

    // Save DXF file
    match drawing.save_file(&path) {
        Ok(_) => SaveResult {
            success: true,
            message: format!("DXF exported to {}", path),
        },
        Err(e) => SaveResult {
            success: false,
            message: format!("Failed to export DXF: {}", e),
        },
    }
}

/// Import drawing from DXF format
#[tauri::command]
pub fn import_dxf(path: String) -> LoadResult {
    let drawing = match dxf::Drawing::load_file(&path) {
        Ok(d) => d,
        Err(e) => {
            return LoadResult {
                success: false,
                data: None,
                message: format!("Failed to load DXF: {}", e),
            }
        }
    };

    let mut shapes: Vec<ShapeData> = Vec::new();

    for entity in drawing.entities() {
        match &entity.specific {
            dxf::entities::EntityType::Line(line) => {
                shapes.push(ShapeData {
                    shape_type: "line".to_string(),
                    start: Some(PointData {
                        x: line.p1.x,
                        y: line.p1.y,
                    }),
                    end: Some(PointData {
                        x: line.p2.x,
                        y: line.p2.y,
                    }),
                    center: None,
                    radius: None,
                    points: None,
                });
            }
            dxf::entities::EntityType::Circle(circle) => {
                shapes.push(ShapeData {
                    shape_type: "circle".to_string(),
                    start: None,
                    end: None,
                    center: Some(PointData {
                        x: circle.center.x,
                        y: circle.center.y,
                    }),
                    radius: Some(circle.radius),
                    points: None,
                });
            }
            // Add more entity types as needed
            _ => {}
        }
    }

    match serde_json::to_string(&shapes) {
        Ok(json) => LoadResult {
            success: true,
            data: Some(json),
            message: "DXF imported successfully".to_string(),
        },
        Err(e) => LoadResult {
            success: false,
            data: None,
            message: format!("Failed to serialize shapes: {}", e),
        },
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct ShapeData {
    shape_type: String,
    start: Option<PointData>,
    end: Option<PointData>,
    center: Option<PointData>,
    radius: Option<f64>,
    points: Option<Vec<PointData>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PointData {
    x: f64,
    y: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ShellResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
}

/// Open a file with the system's default application
#[tauri::command]
pub fn open_file_with_default_app(path: String) -> SaveResult {
    #[cfg(target_os = "windows")]
    {
        match Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
        {
            Ok(_) => SaveResult {
                success: true,
                message: format!("Opened {}", path),
            },
            Err(e) => SaveResult {
                success: false,
                message: format!("Failed to open file: {}", e),
            },
        }
    }
    #[cfg(target_os = "macos")]
    {
        match Command::new("open").arg(&path).spawn() {
            Ok(_) => SaveResult {
                success: true,
                message: format!("Opened {}", path),
            },
            Err(e) => SaveResult {
                success: false,
                message: format!("Failed to open file: {}", e),
            },
        }
    }
    #[cfg(target_os = "linux")]
    {
        match Command::new("xdg-open").arg(&path).spawn() {
            Ok(_) => SaveResult {
                success: true,
                message: format!("Opened {}", path),
            },
            Err(e) => SaveResult {
                success: false,
                message: format!("Failed to open file: {}", e),
            },
        }
    }
}

/// Execute a shell command (git, claude, or other allowed commands)
/// This is async to prevent blocking the UI while waiting for the command to complete
#[tauri::command]
pub async fn execute_shell(program: String, args: Vec<String>) -> ShellResult {
    // Only allow specific programs for security
    let allowed_programs = ["git", "claude", "cmd"];
    let program_name = program.to_lowercase();

    if !allowed_programs.iter().any(|&p| program_name == p || program_name.ends_with(&format!("\\{}", p)) || program_name.ends_with(&format!("/{}", p))) {
        return ShellResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Program '{}' is not allowed. Allowed: git, claude, cmd", program),
            code: -1,
        };
    }

    // Run the blocking command in a separate thread to avoid blocking the async runtime
    let result = tauri::async_runtime::spawn_blocking(move || {
        Command::new(&program).args(&args).output()
    }).await;

    match result {
        Ok(Ok(output)) => ShellResult {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            code: output.status.code().unwrap_or(-1),
        },
        Ok(Err(e)) => ShellResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to execute command: {}", e),
            code: -1,
        },
        Err(e) => ShellResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Task failed: {}", e),
            code: -1,
        },
    }
}
