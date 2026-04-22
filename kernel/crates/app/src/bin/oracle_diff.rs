// oracle_diff — entity-by-entity field comparison between DXF ground truth
// and our pure-Rust DWG parser output. Match entities by handle, diff known
// fields, aggregate mismatches into pattern buckets for targeted fixes.
//
// Usage:
//   cargo run --bin oracle-diff -- <base_path_no_extension>...
//   cargo run --bin oracle-diff -- --all [--report <path>]
//
// The ODA spec is only a secondary reference — the DXF file is the oracle.

use dxf::entities::{Entity, EntityType};
use dxf::Drawing as DxfDrawing;
use std::collections::{BTreeMap, HashMap};
use std::env;
use std::fmt::Write as FmtWrite;
use std::fs;
use std::path::Path;

// ---------------------------------------------------------------------------
// Diff model
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct Mismatch {
    file: String,
    handle: u64,
    etype: String,
    field: String,
    dxf: String,
    dwg: String,
    kind: MismatchKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
enum MismatchKind {
    /// Both sides have values but they differ numerically / textually.
    Value,
    /// DWG side is zero where DXF side is non-zero — parser never populated it.
    DwgZero,
    /// DWG field is missing entirely.
    DwgMissing,
    /// DXF side is missing but DWG side has it (unexpected).
    DxfMissing,
}

impl MismatchKind {
    fn label(self) -> &'static str {
        match self {
            Self::Value => "VALUE",
            Self::DwgZero => "DWG=0",
            Self::DwgMissing => "DWG=∅",
            Self::DxfMissing => "DXF=∅",
        }
    }
}

const EPS_POS: f64 = 1e-6;
const EPS_ANG: f64 = 1e-4; // degrees or radians, small
const EPS_SCALAR: f64 = 1e-6;

fn is_zero_val(s: &str) -> bool {
    s == "0" || s == "0.0" || s == "0.000000" || s == "(0.0, 0.0)" || s == "(0.0, 0.0, 0.0)"
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = env::args().skip(1).collect();
    let mut report_path: Option<String> = None;
    let mut all = false;
    let mut bases: Vec<String> = Vec::new();
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--all" => all = true,
            "--report" => {
                if let Some(p) = it.next() {
                    report_path = Some(p.clone());
                }
            }
            other => bases.push(
                other
                    .trim_end_matches(".dwg")
                    .trim_end_matches(".DWG")
                    .trim_end_matches(".dxf")
                    .trim_end_matches(".DXF")
                    .to_string(),
            ),
        }
    }
    if all {
        bases = all_paired_bases();
    }
    if bases.is_empty() {
        eprintln!("usage: oracle-diff <base_path_no_ext>... | --all [--report path]");
        std::process::exit(1);
    }
    if report_path.is_none() && all {
        report_path = Some(r"C:\Users\rickd\Desktop\dwg_samples\squad\oracle_diff.md".to_string());
    }

    let mut all_mismatches: Vec<Mismatch> = Vec::new();
    let mut per_file_stats: Vec<(String, usize, usize, usize)> = Vec::new(); // file, matched, mismatches, only_dxf
    for base in &bases {
        match diff_one(base) {
            Ok((mut ms, matched, only_dxf)) => {
                let label = Path::new(base)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| base.clone());
                print_per_file(&label, &ms, matched, only_dxf);
                per_file_stats.push((label, matched, ms.len(), only_dxf));
                all_mismatches.append(&mut ms);
            }
            Err(e) => eprintln!("[SKIP] {}: {:?}", base, e),
        }
    }

    print_aggregate(&all_mismatches);

    if let Some(path) = report_path {
        let md = render_markdown(&bases, &per_file_stats, &all_mismatches);
        if let Some(dir) = Path::new(&path).parent() {
            let _ = fs::create_dir_all(dir);
        }
        fs::write(&path, md)?;
        println!("\n[wrote] {}", path);
    }

    Ok(())
}

fn all_paired_bases() -> Vec<String> {
    let candidates = [
        r"C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data\example_2000",
        r"C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data\example_2004",
        r"C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data\example_2007",
        r"C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data\example_2010",
        r"C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data\example_2013",
        r"C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data\example_2018",
        r"C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data\example_r13",
        r"C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data\example_r14",
        r"C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data\sample_2000",
        r"C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data\sample_2018",
        r"C:\Users\rickd\Desktop\dwg_samples\arc_2010",
        r"C:\Users\rickd\Desktop\dwg_samples\circle_2010",
        r"C:\Users\rickd\Desktop\dwg_samples\line_2010",
    ];
    candidates
        .iter()
        .filter(|b| {
            Path::new(&format!("{}.dwg", b)).exists() && Path::new(&format!("{}.dxf", b)).exists()
        })
        .map(|s| s.to_string())
        .collect()
}

// ---------------------------------------------------------------------------
// Per-file diff
// ---------------------------------------------------------------------------

fn diff_one(base: &str) -> anyhow::Result<(Vec<Mismatch>, usize, usize)> {
    let dxf_path = format!("{}.dxf", base);
    let dwg_path = format!("{}.dwg", base);

    let dxf_map = load_dxf_by_handle(&dxf_path)?;
    let dwg_map = load_dwg_by_handle(&dwg_path)?;

    let mut mismatches = Vec::new();
    let mut matched = 0usize;
    let mut only_dxf = 0usize;

    let file_label = Path::new(base)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| base.to_string());

    for (handle, dxf_ent) in &dxf_map {
        let Some(dwg_ent) = dwg_map.get(handle) else {
            only_dxf += 1;
            continue;
        };
        matched += 1;
        let mut local =
            compare_entity(*handle, dxf_ent, dwg_ent, &file_label);
        mismatches.append(&mut local);
    }

    Ok((mismatches, matched, only_dxf))
}

// ---------------------------------------------------------------------------
// DXF loader: entity per handle (walk model + blocks)
// ---------------------------------------------------------------------------

fn load_dxf_by_handle(path: &str) -> anyhow::Result<HashMap<u64, Entity>> {
    let drawing = std::panic::catch_unwind(|| DxfDrawing::load_file(path))
        .map_err(|_| anyhow::anyhow!("dxf crate panicked"))?
        .map_err(|e| anyhow::anyhow!("{:?}", e))?;
    let mut map = HashMap::new();
    for e in drawing.entities() {
        let h = e.common.handle.0;
        if h != 0 {
            map.insert(h, e.clone());
        }
    }
    for b in drawing.blocks() {
        for e in &b.entities {
            let h = e.common.handle.0;
            if h != 0 {
                map.insert(h, e.clone());
            }
        }
    }
    Ok(map)
}

// ---------------------------------------------------------------------------
// DWG loader
// ---------------------------------------------------------------------------

fn load_dwg_by_handle(path: &str) -> anyhow::Result<HashMap<u64, dwg_parser::DwgObject>> {
    use dwg_parser::DwgParser;
    let bytes = fs::read(path)?;
    let mut parser = DwgParser::new();
    let file = parser
        .parse(&bytes)
        .map_err(|e| anyhow::anyhow!("DWG parse failed: {:?}", e))?;
    let mut map = HashMap::new();
    for obj in &file.objects {
        if obj.is_entity {
            map.insert(obj.handle as u64, obj.clone());
        }
    }
    Ok(map)
}

// ---------------------------------------------------------------------------
// Per-entity comparison
// ---------------------------------------------------------------------------

fn compare_entity(
    handle: u64,
    dxf: &Entity,
    dwg: &dwg_parser::DwgObject,
    file: &str,
) -> Vec<Mismatch> {
    let mut out = Vec::new();
    let dwg_type = dwg.type_name.as_str();
    let d = &dwg.data;

    let mut push_val = |field: &str, dxf_s: String, dwg_s: String, v: &mut Vec<Mismatch>| {
        let kind = if dwg_s == "∅" {
            MismatchKind::DwgMissing
        } else if is_zero_val(&dwg_s) && !is_zero_val(&dxf_s) {
            MismatchKind::DwgZero
        } else {
            MismatchKind::Value
        };
        v.push(Mismatch {
            file: file.to_string(),
            handle,
            etype: dwg_type.to_string(),
            field: field.to_string(),
            dxf: dxf_s,
            dwg: dwg_s,
            kind,
        });
    };

    match (&dxf.specific, dwg_type) {
        (EntityType::Line(l), "LINE") => {
            cmp_point3(
                "start",
                (l.p1.x, l.p1.y, l.p1.z),
                d.get("start"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
            cmp_point3(
                "end",
                (l.p2.x, l.p2.y, l.p2.z),
                d.get("end"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
        }
        (EntityType::Circle(c), "CIRCLE") => {
            cmp_point3(
                "center",
                (c.center.x, c.center.y, c.center.z),
                d.get("center"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
            cmp_scalar("radius", c.radius, d.get("radius"), &mut out, handle, dwg_type, file);
        }
        (EntityType::Arc(a), "ARC") => {
            cmp_point3(
                "center",
                (a.center.x, a.center.y, a.center.z),
                d.get("center"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
            cmp_scalar("radius", a.radius, d.get("radius"), &mut out, handle, dwg_type, file);
            // DXF stores degrees, DWG stores radians. Normalize both to radians.
            let dxf_start_rad = a.start_angle.to_radians();
            let dxf_end_rad = a.end_angle.to_radians();
            cmp_scalar_tol(
                "startAngle(rad)",
                dxf_start_rad,
                d.get("startAngle"),
                EPS_ANG,
                &mut out,
                handle,
                dwg_type,
                file,
            );
            cmp_scalar_tol(
                "endAngle(rad)",
                dxf_end_rad,
                d.get("endAngle"),
                EPS_ANG,
                &mut out,
                handle,
                dwg_type,
                file,
            );
        }
        (EntityType::ModelPoint(p), "POINT") => {
            cmp_point3(
                "position",
                (p.location.x, p.location.y, p.location.z),
                d.get("position"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
        }
        (EntityType::Ellipse(e), "ELLIPSE") => {
            cmp_point3(
                "center",
                (e.center.x, e.center.y, e.center.z),
                d.get("center"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
            cmp_point3(
                "majorAxis",
                (e.major_axis.x, e.major_axis.y, e.major_axis.z),
                d.get("majorAxis"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
            cmp_scalar(
                "axisRatio",
                e.minor_axis_ratio,
                d.get("axisRatio"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
            cmp_scalar_tol(
                "startParam",
                e.start_parameter,
                d.get("startAngle"),
                EPS_ANG,
                &mut out,
                handle,
                dwg_type,
                file,
            );
            cmp_scalar_tol(
                "endParam",
                e.end_parameter,
                d.get("endAngle"),
                EPS_ANG,
                &mut out,
                handle,
                dwg_type,
                file,
            );
        }
        (EntityType::Text(t), "TEXT") => {
            cmp_point3(
                "insertion",
                (t.location.x, t.location.y, t.location.z),
                d.get("insertionPoint"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
            cmp_scalar("height", t.text_height, d.get("height"), &mut out, handle, dwg_type, file);
            cmp_scalar_tol(
                "rotation(rad)",
                t.rotation.to_radians(),
                d.get("rotation"),
                EPS_ANG,
                &mut out,
                handle,
                dwg_type,
                file,
            );
            cmp_text("text", &t.value, d.get("text"), &mut out, handle, dwg_type, file);
        }
        (EntityType::MText(m), "MTEXT") => {
            cmp_point3(
                "insertion",
                (m.insertion_point.x, m.insertion_point.y, m.insertion_point.z),
                d.get("insertionPoint"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
            cmp_scalar(
                "height",
                m.initial_text_height,
                d.get("height"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
            let dxf_attach = m.attachment_point as i32 as i64;
            cmp_int("attachment", dxf_attach, d.get("attachment"), &mut out, handle, dwg_type, file);
            cmp_text("text", &m.text, d.get("text"), &mut out, handle, dwg_type, file);
        }
        (EntityType::Insert(i), "INSERT") => {
            cmp_point3(
                "insertion",
                (i.location.x, i.location.y, i.location.z),
                d.get("insertionPoint"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
            cmp_scalar("scaleX", i.x_scale_factor, d.get("scaleX"), &mut out, handle, dwg_type, file);
            cmp_scalar("scaleY", i.y_scale_factor, d.get("scaleY"), &mut out, handle, dwg_type, file);
            cmp_scalar("scaleZ", i.z_scale_factor, d.get("scaleZ"), &mut out, handle, dwg_type, file);
            cmp_scalar_tol(
                "rotation(rad)",
                i.rotation.to_radians(),
                d.get("rotation"),
                EPS_ANG,
                &mut out,
                handle,
                dwg_type,
                file,
            );
        }
        (EntityType::LwPolyline(p), "LWPOLYLINE") | (EntityType::LwPolyline(p), "POLYLINE_2D") => {
            let dxf_n = p.vertices.len();
            let dwg_n = d
                .get("vertices")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            if dxf_n != dwg_n {
                push_val(
                    "vertex_count",
                    dxf_n.to_string(),
                    dwg_n.to_string(),
                    &mut out,
                );
            } else if let Some(arr) = d.get("vertices").and_then(|v| v.as_array()) {
                for (idx, (dv, wv)) in p.vertices.iter().zip(arr.iter()).enumerate() {
                    let dwx = wv.get("x").and_then(|x| x.as_f64()).unwrap_or(0.0);
                    let dwy = wv.get("y").and_then(|x| x.as_f64()).unwrap_or(0.0);
                    if (dv.x - dwx).abs() > EPS_POS || (dv.y - dwy).abs() > EPS_POS {
                        push_val(
                            &format!("v[{}].xy", idx),
                            format!("({:.4}, {:.4})", dv.x, dv.y),
                            format!("({:.4}, {:.4})", dwx, dwy),
                            &mut out,
                        );
                    }
                }
            }
        }
        (EntityType::Spline(s), "SPLINE") => {
            cmp_int(
                "degree",
                s.degree_of_curve as i64,
                d.get("degree"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
            let dwg_ctrl = d
                .get("controlPoints")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            let dwg_fit = d
                .get("fitPoints")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            let dwg_knots = d
                .get("knots")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            let dxf_ctrl = s.control_points.len();
            let dxf_fit = s.fit_points.len();
            let dxf_knots = s.knot_values.len();
            if dxf_ctrl != dwg_ctrl {
                push_val(
                    "control_point_count",
                    dxf_ctrl.to_string(),
                    dwg_ctrl.to_string(),
                    &mut out,
                );
            }
            if dxf_fit != dwg_fit {
                push_val(
                    "fit_point_count",
                    dxf_fit.to_string(),
                    dwg_fit.to_string(),
                    &mut out,
                );
            }
            if dxf_knots != dwg_knots {
                push_val(
                    "knot_count",
                    dxf_knots.to_string(),
                    dwg_knots.to_string(),
                    &mut out,
                );
            }
        }
        (EntityType::Solid(s), "SOLID") => {
            cmp_point3(
                "point1",
                (s.first_corner.x, s.first_corner.y, s.first_corner.z),
                d.get("point1"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
            cmp_point3(
                "point2",
                (s.second_corner.x, s.second_corner.y, s.second_corner.z),
                d.get("point2"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
            cmp_point3(
                "point3",
                (s.third_corner.x, s.third_corner.y, s.third_corner.z),
                d.get("point3"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
            cmp_point3(
                "point4",
                (s.fourth_corner.x, s.fourth_corner.y, s.fourth_corner.z),
                d.get("point4"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
        }
        (EntityType::Leader(l), "LEADER") => {
            let dxf_n = l.vertices.len();
            let dwg_n = d
                .get("points")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            if dxf_n != dwg_n {
                push_val("point_count", dxf_n.to_string(), dwg_n.to_string(), &mut out);
            }
        }
        // --- Dimension family --- DXF decomposes by subtype into different structs.
        (EntityType::RotatedDimension(rd), dwg_type_name)
            if dwg_type_name == "DIMENSION_LINEAR" || dwg_type_name == "DIMENSION_ALIGNED" =>
        {
            cmp_dim_common(&rd.dimension_base, d, &mut out, handle, dwg_type, file);
            cmp_point3(
                "definition_point(13)",
                (rd.definition_point_2.x, rd.definition_point_2.y, rd.definition_point_2.z),
                d.get("extLine1"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
            cmp_point3(
                "definition_point(14)",
                (rd.definition_point_3.x, rd.definition_point_3.y, rd.definition_point_3.z),
                d.get("extLine2"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
            cmp_point3(
                "insertion_point(10)",
                (
                    rd.dimension_base.definition_point_1.x,
                    rd.dimension_base.definition_point_1.y,
                    rd.dimension_base.definition_point_1.z,
                ),
                d.get("definitionPoint"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
        }
        (EntityType::RadialDimension(rd), "DIMENSION_RADIUS") => {
            cmp_dim_common(&rd.dimension_base, d, &mut out, handle, dwg_type, file);
            cmp_point3(
                "definition_point(15)",
                (rd.definition_point_2.x, rd.definition_point_2.y, rd.definition_point_2.z),
                d.get("definitionPoint"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
            cmp_scalar(
                "leader_length",
                rd.leader_length,
                d.get("leaderLength"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
        }
        (EntityType::DiameterDimension(dd), "DIMENSION_DIAMETER") => {
            cmp_dim_common(&dd.dimension_base, d, &mut out, handle, dwg_type, file);
        }
        (EntityType::AngularThreePointDimension(ad), "DIMENSION_ANG3PT") => {
            cmp_dim_common(&ad.dimension_base, d, &mut out, handle, dwg_type, file);
            cmp_point3(
                "ext_line1(13)",
                (ad.definition_point_2.x, ad.definition_point_2.y, ad.definition_point_2.z),
                d.get("extLine1"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
            cmp_point3(
                "ext_line2(14)",
                (ad.definition_point_3.x, ad.definition_point_3.y, ad.definition_point_3.z),
                d.get("extLine2"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
        }
        (EntityType::OrdinateDimension(od), "DIMENSION_ORDINATE") => {
            cmp_dim_common(&od.dimension_base, d, &mut out, handle, dwg_type, file);
            cmp_point3(
                "feature(13)",
                (od.definition_point_2.x, od.definition_point_2.y, od.definition_point_2.z),
                d.get("featureLocation"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
            cmp_point3(
                "leader(14)",
                (od.definition_point_3.x, od.definition_point_3.y, od.definition_point_3.z),
                d.get("leaderEndpoint"),
                &mut out,
                handle,
                dwg_type,
                file,
            );
        }
        // Type-mismatched pairs → worth flagging individually.
        _ => {
            let dxf_tag = format!("{:?}", std::mem::discriminant(&dxf.specific));
            out.push(Mismatch {
                file: file.to_string(),
                handle,
                etype: format!("{} vs {}", dwg_type, dxf_tag),
                field: "TYPE_MISMATCH".into(),
                dxf: dxf_tag,
                dwg: dwg_type.to_string(),
                kind: MismatchKind::Value,
            });
        }
    }

    out
}

fn cmp_dim_common(
    base: &dxf::entities::DimensionBase,
    d: &HashMap<String, serde_json::Value>,
    out: &mut Vec<Mismatch>,
    handle: u64,
    etype: &str,
    file: &str,
) {
    // DXF 11 = textMidpoint, DXF 10 = definition_point_1 (kept as "definitionPoint" on some,
    // "extLine1"/"extLine2"/"definitionPoint" differ per subtype — compared inline).
    cmp_point3(
        "text_mid(11)",
        (base.text_mid_point.x, base.text_mid_point.y, base.text_mid_point.z),
        d.get("textMidpoint"),
        out,
        handle,
        etype,
        file,
    );
    if !base.text.is_empty() && base.text != "<>" {
        cmp_text("user_text", &base.text, d.get("overrideText"), out, handle, etype, file);
    }
    cmp_scalar_tol(
        "text_rotation(rad)",
        base.text_rotation_angle,
        d.get("textRotation"),
        EPS_ANG,
        out,
        handle,
        etype,
        file,
    );
}

// ---------------------------------------------------------------------------
// Primitive compare helpers — all append to mismatch list if different
// ---------------------------------------------------------------------------

fn cmp_point3(
    field: &str,
    dxf: (f64, f64, f64),
    dwg_val: Option<&serde_json::Value>,
    out: &mut Vec<Mismatch>,
    handle: u64,
    etype: &str,
    file: &str,
) {
    let dwg = dwg_val.and_then(json_to_xyz);
    let mismatch = match dwg {
        None => Some((fmt_xyz(dxf), "∅".to_string(), MismatchKind::DwgMissing)),
        Some(d) => {
            if (d.0 - dxf.0).abs() > EPS_POS
                || (d.1 - dxf.1).abs() > EPS_POS
                || (d.2 - dxf.2).abs() > EPS_POS
            {
                let k = if d.0 == 0.0 && d.1 == 0.0 && d.2 == 0.0 {
                    MismatchKind::DwgZero
                } else {
                    MismatchKind::Value
                };
                Some((fmt_xyz(dxf), fmt_xyz(d), k))
            } else {
                None
            }
        }
    };
    if let Some((dxf_s, dwg_s, kind)) = mismatch {
        out.push(Mismatch {
            file: file.to_string(),
            handle,
            etype: etype.to_string(),
            field: field.to_string(),
            dxf: dxf_s,
            dwg: dwg_s,
            kind,
        });
    }
}

fn cmp_scalar(
    field: &str,
    dxf: f64,
    dwg_val: Option<&serde_json::Value>,
    out: &mut Vec<Mismatch>,
    handle: u64,
    etype: &str,
    file: &str,
) {
    cmp_scalar_tol(field, dxf, dwg_val, EPS_SCALAR, out, handle, etype, file);
}

fn cmp_scalar_tol(
    field: &str,
    dxf: f64,
    dwg_val: Option<&serde_json::Value>,
    tol: f64,
    out: &mut Vec<Mismatch>,
    handle: u64,
    etype: &str,
    file: &str,
) {
    let dwg = dwg_val.and_then(|v| v.as_f64());
    match dwg {
        None => out.push(Mismatch {
            file: file.to_string(),
            handle,
            etype: etype.to_string(),
            field: field.to_string(),
            dxf: format!("{:.6}", dxf),
            dwg: "∅".into(),
            kind: MismatchKind::DwgMissing,
        }),
        Some(w) => {
            if (w - dxf).abs() > tol {
                let k = if w.abs() < 1e-12 && dxf.abs() > tol {
                    MismatchKind::DwgZero
                } else {
                    MismatchKind::Value
                };
                out.push(Mismatch {
                    file: file.to_string(),
                    handle,
                    etype: etype.to_string(),
                    field: field.to_string(),
                    dxf: format!("{:.6}", dxf),
                    dwg: format!("{:.6}", w),
                    kind: k,
                });
            }
        }
    }
}

fn cmp_int(
    field: &str,
    dxf: i64,
    dwg_val: Option<&serde_json::Value>,
    out: &mut Vec<Mismatch>,
    handle: u64,
    etype: &str,
    file: &str,
) {
    let dwg = dwg_val.and_then(|v| v.as_i64()).or_else(|| dwg_val.and_then(|v| v.as_u64().map(|u| u as i64)));
    match dwg {
        None => out.push(Mismatch {
            file: file.to_string(),
            handle,
            etype: etype.to_string(),
            field: field.to_string(),
            dxf: dxf.to_string(),
            dwg: "∅".into(),
            kind: MismatchKind::DwgMissing,
        }),
        Some(w) => {
            if w != dxf {
                out.push(Mismatch {
                    file: file.to_string(),
                    handle,
                    etype: etype.to_string(),
                    field: field.to_string(),
                    dxf: dxf.to_string(),
                    dwg: w.to_string(),
                    kind: if w == 0 {
                        MismatchKind::DwgZero
                    } else {
                        MismatchKind::Value
                    },
                });
            }
        }
    }
}

fn cmp_text(
    field: &str,
    dxf: &str,
    dwg_val: Option<&serde_json::Value>,
    out: &mut Vec<Mismatch>,
    handle: u64,
    etype: &str,
    file: &str,
) {
    let dwg = dwg_val.and_then(|v| v.as_str()).map(|s| s.to_string());
    match dwg {
        None => {
            if !dxf.is_empty() {
                out.push(Mismatch {
                    file: file.to_string(),
                    handle,
                    etype: etype.to_string(),
                    field: field.to_string(),
                    dxf: truncate(dxf, 40),
                    dwg: "∅".into(),
                    kind: MismatchKind::DwgMissing,
                });
            }
        }
        Some(w) => {
            if w != dxf {
                let kind = if w.is_empty() {
                    MismatchKind::DwgZero
                } else {
                    MismatchKind::Value
                };
                out.push(Mismatch {
                    file: file.to_string(),
                    handle,
                    etype: etype.to_string(),
                    field: field.to_string(),
                    dxf: truncate(dxf, 40),
                    dwg: truncate(&w, 40),
                    kind,
                });
            }
        }
    }
}

fn json_to_xyz(v: &serde_json::Value) -> Option<(f64, f64, f64)> {
    let arr = v.as_array()?;
    let x = arr.get(0)?.as_f64()?;
    let y = arr.get(1)?.as_f64()?;
    let z = arr.get(2).and_then(|z| z.as_f64()).unwrap_or(0.0);
    Some((x, y, z))
}

fn fmt_xyz(p: (f64, f64, f64)) -> String {
    format!("({:.4}, {:.4}, {:.4})", p.0, p.1, p.2)
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(n).collect();
        out.push('…');
        out
    }
}

// ---------------------------------------------------------------------------
// Output — console per-file + aggregate
// ---------------------------------------------------------------------------

fn print_per_file(label: &str, ms: &[Mismatch], matched: usize, only_dxf: usize) {
    println!("\n=== {} ===", label);
    println!(
        "matched_by_handle={}  mismatches={}  dxf_only={}",
        matched,
        ms.len(),
        only_dxf
    );
    // Top 15 by type+field.
    let mut bucket: BTreeMap<(String, String, MismatchKind), usize> = BTreeMap::new();
    for m in ms {
        *bucket
            .entry((m.etype.clone(), m.field.clone(), m.kind))
            .or_insert(0) += 1;
    }
    let mut sorted: Vec<_> = bucket.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));
    for ((et, f, k), c) in sorted.iter().take(15) {
        println!("  {:<22} {:<24} [{}] {} x", et, f, k.label(), c);
    }
    // Show 5 representative lines (diverse field).
    let mut seen = std::collections::HashSet::new();
    let mut shown = 0;
    for m in ms {
        let key = (m.etype.clone(), m.field.clone(), m.kind);
        if seen.insert(key) {
            println!(
                "    h=0x{:X} {} {} DXF={} DWG={}",
                m.handle, m.etype, m.field, m.dxf, m.dwg
            );
            shown += 1;
            if shown >= 5 {
                break;
            }
        }
    }
}

fn print_aggregate(ms: &[Mismatch]) {
    println!("\n\n============ AGGREGATE PATTERNS ============");
    let mut bucket: HashMap<(String, String, MismatchKind), usize> = HashMap::new();
    for m in ms {
        *bucket
            .entry((m.etype.clone(), m.field.clone(), m.kind))
            .or_insert(0) += 1;
    }
    let mut sorted: Vec<_> = bucket.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));
    println!(
        "{:<28} {:<30} {:<8} {:>6}",
        "ENTITY", "FIELD", "KIND", "COUNT"
    );
    println!("{}", "-".repeat(84));
    for ((et, f, k), c) in sorted.iter().take(30) {
        println!("{:<28} {:<30} {:<8} {:>6}", et, f, k.label(), c);
    }
    println!("\nTotal mismatches: {}", ms.len());
}

// ---------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------

fn render_markdown(
    bases: &[String],
    stats: &[(String, usize, usize, usize)],
    ms: &[Mismatch],
) -> String {
    let mut out = String::new();
    writeln!(out, "# oracle_diff — DWG parser vs DXF ground-truth").unwrap();
    writeln!(out).unwrap();
    writeln!(out, "Files compared: {}", bases.len()).unwrap();
    writeln!(out, "Total mismatches: {}", ms.len()).unwrap();
    writeln!(out).unwrap();

    writeln!(out, "## Per-file summary").unwrap();
    writeln!(out).unwrap();
    writeln!(out, "| File | matched | mismatches | dxf_only |").unwrap();
    writeln!(out, "|------|--------:|-----------:|---------:|").unwrap();
    for (label, matched, miss, only_dxf) in stats {
        writeln!(out, "| {} | {} | {} | {} |", label, matched, miss, only_dxf).unwrap();
    }
    writeln!(out).unwrap();

    writeln!(out, "## Aggregate mismatch patterns").unwrap();
    writeln!(out).unwrap();
    writeln!(out, "Kinds: `DWG=0` = parser read zero where DXF has a value (most likely bit-alignment / field-skip bug); `DWG=∅` = DWG parser never wrote the field; `VALUE` = non-zero but wrong.").unwrap();
    writeln!(out).unwrap();

    let mut bucket: HashMap<(String, String, MismatchKind), usize> = HashMap::new();
    for m in ms {
        *bucket
            .entry((m.etype.clone(), m.field.clone(), m.kind))
            .or_insert(0) += 1;
    }
    let mut sorted: Vec<_> = bucket.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));
    writeln!(out, "| entity | field | kind | count |").unwrap();
    writeln!(out, "|--------|-------|------|------:|").unwrap();
    for ((et, f, k), c) in sorted.iter().take(60) {
        writeln!(out, "| {} | {} | {} | {} |", et, f, k.label(), c).unwrap();
    }
    writeln!(out).unwrap();

    writeln!(out, "## Sample mismatches (first 50)").unwrap();
    writeln!(out).unwrap();
    writeln!(out, "| file | handle | type | field | DXF | DWG |").unwrap();
    writeln!(out, "|------|--------|------|-------|-----|-----|").unwrap();
    for m in ms.iter().take(50) {
        writeln!(
            out,
            "| {} | 0x{:X} | {} | {} | `{}` | `{}` |",
            m.file, m.handle, m.etype, m.field, m.dxf, m.dwg
        )
        .unwrap();
    }

    out
}
