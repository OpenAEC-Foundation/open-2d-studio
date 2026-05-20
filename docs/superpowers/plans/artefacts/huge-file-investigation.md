# Huge-file open performance — investigation

> Branch: `open-2d-viewer` · Started: 2026-05-20
> Goal: open `test65.dwg` (65 MB R2018) + `stress475.dxf` (476 MB) from the
> viewer's File → Open dialog and see meaningful geometry in < 60 s.

## Test corpus

| File            | Size   | Type             | Magic   | Notes |
|-----------------|--------|------------------|---------|-------|
| `pair.dwg`      | 1.1 MB | regression baseline | AC1024 R2010 | small / fast |
| `pair.dxf`      | 7.4 MB | regression baseline | DXF | small / fast |
| `test65.dwg`    | 65 MB  | stress             | AC1032 R2018 | parser hang |
| `stress37.dxf`  | 37 MB  | stress             | DXF | OK |
| `stress48.dxf`  | 48 MB  | stress             | DXF | OK (mostly empty / 3D) |
| `stress475.dxf` | 476 MB | stress             | DXF | aborts: "input unexpectedly ended" |

## Phase 1 — baseline (headless-render)

`headless-render <file> out.png --width=1024 --height=1024` exits 0 (success)
or non-zero (failure). Phase prints come from `O2D_LOAD_PROFILE=1`
(scene_io) and the `dwg-debug` Cargo feature (parser).

| File            | Status     | Wall time | Peak RAM | Phase that's slow |
|-----------------|------------|-----------|----------|-------------------|
| `pair.dwg`      | OK         | 3.9 s     | ~300 MB  | parse 0.4 s · entity-loop 1.8 s · GPU 1.5 s |
| `pair.dxf`      | (not measured separately — small)        | -        | -        | -                |
| `stress37.dxf`  | OK         | 13 s      | 333 MB   | DXF entity-loop ~10 s |
| `stress48.dxf`  | OK         | 3.3 s     | 461 MB   | mostly "other" entity types, no real LINE/CIRCLE etc. |
| `stress475.dxf` | **FAIL**   | 11.8 s    | 2.77 GB  | `dxf` crate: "input unexpectedly ended before the drawing was completely loaded" |
| `test65.dwg`    | **HANG**   | > 9 min   | 5.6 GB   | DWG `parse_objects_r2000` — **SPLINE entities** |

## Phase 2 — root-cause traces

### test65.dwg DWG parser hang

Added a temporary progress probe in
`src-tauri/dwg-parser/parser.rs::parse_objects_r2000` and ran with
`O2D_DWG_OBJLOOP_PROGRESS=1`. Output:

```
[dwg-progress] parse_objects:   0/725621 (0.0%) elapsed   0.0s
[dwg-progress] parse_objects:  10000/725621 (1.4%) elapsed 0.1s
...
[dwg-progress] parse_objects: 197050/725621 (27.2%) elapsed 18.8s last_type=SPLINE
[dwg-progress] parse_objects: 197055/725621 (27.2%) elapsed 32.2s last_type=SPLINE
[dwg-progress] parse_objects: 197056/725621 (27.2%) elapsed 34.6s last_type=SPLINE
...
[dwg-progress] parse_objects: 197060/725621 (27.2%) elapsed 49.0s last_type=SPLINE
[dwg-progress] parse_objects: 197261/725621 (27.2%) elapsed 104.4s last_type=SPLINE
```

**Throughput drops from 200 k handles/s to one handle every 3 s** the moment
SPLINE entities start. Object byte-spacing in the slow region: **~250
bytes per object**. A real SPLINE with thousands of control points
cannot fit in 250 bytes — these handles must be landing on garbage
data that decodes as a SPLINE with a **bogus, huge `num_knots` /
`num_ctrl`**.

The SPLINE parser (`parser.rs:5883`):

```rust
let num_knots = reader.read_bl()? as usize;
let num_ctrl  = reader.read_bl()? as usize;
...
for _ in 0..num_knots { knots.push(reader.read_bd()?); }
for _ in 0..num_ctrl  { ctrl_pts.push(...); }
```

`read_bl()` returns an `i32`. Cast to `usize` via `as` on a negative
or large value gives a huge u64 → the loop spins for billions of
iterations until the bit-reader eventually hits EOF inside one of the
`read_bd` calls. **Per-spline cost: ~3 seconds wall + many MB heap
churn for the `Vec<f64>` growth.**

The fuzzy-offset retry in `parse_objects_r2000` (`±2,±4,±6,±8`) makes
this worse: every handle that lands on garbage runs `parse_single_object_r2000`
8 extra times before giving up.

### stress475.dxf — dxf crate parse failure

`dxf::Drawing::load_file` aborts with `"input unexpectedly ended before
the drawing was completely loaded"` after 11.8 s and 2.77 GB peak RAM.
This is the `dxf` 0.5 crate buffering the entire file into a giant
`Drawing` struct; either the file is genuinely truncated, or the crate
rejects something benign in the trailer. Either way: no `Scene` is
ever produced, the GUI viewer must show a graceful error rather than
hang.

### stress48.dxf parses but renders mostly empty

431k entities classified as "other" — likely 3D / BREP / region
content that scene_io's tessellator doesn't handle. Not a perf bug,
just a coverage gap; out of scope here.

## Phase 3 — hypotheses

### H1 (CONFIRMED): SPLINE counters are unbounded

When `parse_single_object_r2000` lands on a non-SPLINE byte run that
decodes as object-type 0x24 (SPLINE), its body parser reads
`num_knots` / `num_ctrl` from BL fields and loops without bounding
the count. Garbage values → multi-second hot loops + GB heap allocs.
**Fix:** cap `num_knots`, `num_ctrl`, `num_fit` to a realistic upper
bound (say 1 M each — even a heavily-edited B-spline rarely exceeds
10k control points) and return an empty SPLINE on overflow.

### H2: Other "count → for-loop" patterns share the same vulnerability

A grep for `for _ in 0..` over `parser.rs` will find several more
loop-on-BL constructs (POLYLINE_3D vertex_count, MTEXT char_count,
HATCH boundary_path_count, etc.). Each is a potential DoS vector for
the fuzzy-search path. **Fix:** audit and add per-counter caps in a
follow-up commit; SPLINE is by far the most expensive because it
both loops and allocates `Vec<f64>`.

### H3 (parallel — top-prio per coordinator): rayon over the handle list

After parse_object_map finishes, every handle in `dwg.object_map` can
be decoded independently — `parse_single_object_r2000` is `&self` (no
shared mutable state) and only reads from the immutable `data` slice
and the `class_map`. With H1 fixed (no pathological splines),
parallelising the 725 k-entry loop across 8 cores should give ~4-8×
speedup. Cargo dep: `rayon = "1.10"`.

### H4: stress475.dxf needs graceful error

Replace the `?` propagation in `load_dxf` with a clearer error message
and surface it through `LoadingMsg::Failed` so the GUI's loading
overlay shows it instead of hanging. The 2.77 GB transient alloc
from the `dxf` crate is unavoidable without a custom streaming
parser; a clear "file appears truncated, cannot load" is fine for
now.

### H5: scene_io entity loop progress reporting

Even after the parser is fast, the scene_io entity loop on a real
multi-million-entity DWG will take several seconds. The GUI's
loading overlay (commit 7c15132) is animated by wall-clock but the
"phase" label never updates. **Fix:** post `LoadingMsg::Phase`
updates from inside `load_dwg`/`load_dxf` at major boundaries
(parsed N objects, processed M% of entities, etc.). Deferred —
secondary to the parser hang.

## Phase 4 — fixes (planned, atomic commits)

1. **(this commit)** `docs(huge-file): investigate test65.dwg parser hang`
   — this report, plus the temporary progress probe in
   `parse_objects_r2000` that produced the SPLINE finding. The probe
   stays guarded by `O2D_DWG_OBJLOOP_PROGRESS=1` so it costs nothing
   in production.
2. `fix(dwg-parser): cap SPLINE knot/ctrl/fit counters at 1M`
3. `fix(dwg-parser): cap PL/POLYLINE/MTEXT/HATCH counters at sane bounds`
4. `perf(dwg-parser): parallel parse_objects_r2000 via rayon`
5. `fix(scene_io): graceful DXF parse-failure message for truncated files`
6. `(optional)` `feat(scene_io): post LoadingMsg::Phase updates during entity loop`

Verification target after #2 + #4:

| File         | Before   | Target  |
|--------------|----------|---------|
| `pair.dwg`   | 3.9 s    | ≤ 4 s   (no regression) |
| `test65.dwg` | > 9 min  | < 60 s  |
| `stress475.dxf` | hang (no error) | < 30 s graceful error |
