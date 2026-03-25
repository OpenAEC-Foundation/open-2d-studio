use serde::{Deserialize, Serialize};
use std::fs;
use std::process::Command;

use crate::dwg_parser::{DwgParser};

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

/// Import drawing from DWG format
#[tauri::command]
pub fn import_dwg(path: String) -> LoadResult {
    let data = match fs::read(&path) {
        Ok(d) => d,
        Err(e) => {
            return LoadResult {
                success: false,
                data: None,
                message: format!("Failed to read DWG file: {}", e),
            }
        }
    };

    let parse_result = std::panic::catch_unwind(|| {
        let mut parser = DwgParser::new();
        parser.parse(&data)
    });

    let dwg_file = match parse_result {
        Ok(Ok(f)) => f,
        Ok(Err(e)) => {
            return LoadResult {
                success: false,
                data: None,
                message: format!("Failed to parse DWG file: {}", e),
            }
        }
        Err(_) => {
            return LoadResult {
                success: false,
                data: None,
                message: "DWG parser crashed (unsupported file format or corrupted file)".to_string(),
            }
        }
    };

    // Manually build JSON since DwgFile does not derive Serialize
    let objects_json: Vec<serde_json::Value> = dwg_file
        .objects
        .iter()
        .filter(|obj| obj.is_entity)
        .map(|obj| {
            let mut map = serde_json::Map::new();
            map.insert("type_name".to_string(), serde_json::Value::String(obj.type_name.clone()));
            map.insert("data".to_string(), serde_json::Value::Object(
                obj.data.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
            ));
            map.insert("is_entity".to_string(), serde_json::Value::Bool(obj.is_entity));
            map.insert("handle".to_string(), serde_json::json!(obj.handle));

            // Include layer handle reference if present
            if let Some(layer_handle) = obj.handle_refs.layer {
                map.insert("layer_handle".to_string(), serde_json::json!(layer_handle));
            }

            // Try to extract layer name from entity data if available
            if let Some(layer_val) = obj.data.get("layer") {
                map.insert("layer".to_string(), layer_val.clone());
            }

            serde_json::Value::Object(map)
        })
        .collect();

    let result = serde_json::json!({
        "version": dwg_file.version,
        "version_code": dwg_file.version_code,
        "objects": objects_json,
    });

    match serde_json::to_string(&result) {
        Ok(json) => LoadResult {
            success: true,
            data: Some(json),
            message: "DWG imported successfully".to_string(),
        },
        Err(e) => LoadResult {
            success: false,
            data: None,
            message: format!("Failed to serialize DWG data: {}", e),
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
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        SaveResult {
            success: false,
            message: "Not supported on this platform".to_string(),
        }
    }
}

/// Get list of available printers
#[tauri::command]
pub fn get_printers() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        // Use PowerShell to get printer list
        let output = Command::new("powershell")
            .args(["-Command", "Get-Printer | Select-Object -ExpandProperty Name"])
            .output();

        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                stdout
                    .lines()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            }
            Err(_) => vec![]
        }
    }
    #[cfg(target_os = "macos")]
    {
        // Use lpstat to get printer list
        let output = Command::new("lpstat")
            .args(["-p"])
            .output();

        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                stdout
                    .lines()
                    .filter_map(|line| {
                        if line.starts_with("printer ") {
                            Some(line.split_whitespace().nth(1)?.to_string())
                        } else {
                            None
                        }
                    })
                    .collect()
            }
            Err(_) => vec![]
        }
    }
    #[cfg(target_os = "linux")]
    {
        // Use lpstat to get printer list
        let output = Command::new("lpstat")
            .args(["-p"])
            .output();

        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                stdout
                    .lines()
                    .filter_map(|line| {
                        if line.starts_with("printer ") {
                            Some(line.split_whitespace().nth(1)?.to_string())
                        } else {
                            None
                        }
                    })
                    .collect()
            }
            Err(_) => vec![]
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        vec![]
    }
}

/// Print a PDF file to a specific printer
#[tauri::command]
pub fn print_file(path: String, printer: Option<String>) -> SaveResult {
    #[cfg(target_os = "windows")]
    {
        // Use PowerShell to print PDF to specific printer
        let ps_command = if let Some(ref printer_name) = printer {
            format!(
                "Start-Process -FilePath '{}' -Verb PrintTo -ArgumentList '\"{}\"'",
                path.replace("'", "''"),
                printer_name.replace("'", "''")
            )
        } else {
            // Print to default printer
            format!(
                "Start-Process -FilePath '{}' -Verb Print",
                path.replace("'", "''")
            )
        };

        match Command::new("powershell")
            .args(["-Command", &ps_command])
            .output()
        {
            Ok(output) => {
                if output.status.success() {
                    SaveResult {
                        success: true,
                        message: format!("Print job sent to {}", printer.unwrap_or_else(|| "default printer".to_string())),
                    }
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    SaveResult {
                        success: false,
                        message: format!("Print failed: {}", stderr),
                    }
                }
            }
            Err(e) => SaveResult {
                success: false,
                message: format!("Failed to print: {}", e),
            },
        }
    }
    #[cfg(target_os = "macos")]
    {
        // Use lpr command
        let mut cmd = Command::new("lpr");
        if let Some(ref printer_name) = printer {
            cmd.args(["-P", printer_name]);
        }
        cmd.arg(&path);

        match cmd.output() {
            Ok(output) => {
                if output.status.success() {
                    SaveResult {
                        success: true,
                        message: format!("Print job sent to {}", printer.unwrap_or_else(|| "default printer".to_string())),
                    }
                } else {
                    SaveResult {
                        success: false,
                        message: "Print failed".to_string(),
                    }
                }
            }
            Err(e) => SaveResult {
                success: false,
                message: format!("Failed to print: {}", e),
            },
        }
    }
    #[cfg(target_os = "linux")]
    {
        // Use lpr command
        let mut cmd = Command::new("lpr");
        if let Some(ref printer_name) = printer {
            cmd.args(["-P", printer_name]);
        }
        cmd.arg(&path);

        match cmd.output() {
            Ok(output) => {
                if output.status.success() {
                    SaveResult {
                        success: true,
                        message: format!("Print job sent to {}", printer.unwrap_or_else(|| "default printer".to_string())),
                    }
                } else {
                    SaveResult {
                        success: false,
                        message: "Print failed".to_string(),
                    }
                }
            }
            Err(e) => SaveResult {
                success: false,
                message: format!("Failed to print: {}", e),
            },
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        SaveResult {
            success: false,
            message: "Printing is not supported on this platform".to_string(),
        }
    }
}

/// Open printer properties/preferences dialog
#[tauri::command]
pub fn open_printer_properties(printer: String) -> SaveResult {
    #[cfg(target_os = "windows")]
    {
        // Use rundll32 to open printer properties dialog
        // Users can click "Preferences" button inside to change paper size, orientation, etc.
        match Command::new("rundll32")
            .args(["printui.dll,PrintUIEntry", "/e", "/n", &printer])
            .spawn()
        {
            Ok(_) => SaveResult {
                success: true,
                message: format!("Opened properties for {}", printer),
            },
            Err(e) => SaveResult {
                success: false,
                message: format!("Failed to open printer properties: {}", e),
            },
        }
    }
    #[cfg(target_os = "macos")]
    {
        // Open System Preferences > Printers & Scanners
        match Command::new("open")
            .args(["-a", "System Preferences", "/System/Library/PreferencePanes/PrintAndScan.prefPane"])
            .spawn()
        {
            Ok(_) => SaveResult {
                success: true,
                message: "Opened Printers & Scanners preferences".to_string(),
            },
            Err(e) => SaveResult {
                success: false,
                message: format!("Failed to open printer settings: {}", e),
            },
        }
    }
    #[cfg(target_os = "linux")]
    {
        // Try to open system-config-printer or GNOME settings
        let result = Command::new("system-config-printer").spawn();
        match result {
            Ok(_) => SaveResult {
                success: true,
                message: "Opened printer settings".to_string(),
            },
            Err(_) => {
                // Fallback to GNOME settings
                match Command::new("gnome-control-center")
                    .arg("printers")
                    .spawn()
                {
                    Ok(_) => SaveResult {
                        success: true,
                        message: "Opened printer settings".to_string(),
                    },
                    Err(e) => SaveResult {
                        success: false,
                        message: format!("Failed to open printer settings: {}", e),
                    },
                }
            }
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        SaveResult {
            success: false,
            message: "Not supported on this platform".to_string(),
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
