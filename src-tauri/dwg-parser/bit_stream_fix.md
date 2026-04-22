# DWG R2010+ Entity Bit-Stream Alignment Fix

## Root Cause

Two bugs in `parser.rs` caused entity BD/3BD fields to read garbage instead of correct coordinates:

### Bug 1: RL bitsize read for R2010+ entities (32-bit misalignment)

`parse_single_object_r2000()` read an RL (raw 32-bit long) "bitsize" field after the OT (object type) for R2010+ entities. This field does NOT exist in R2010+ — it was removed from the format. The MC `handle_stream_size_bits` field (read earlier) replaces it entirely.

**Fix:** Changed `read_bitsize` to `false` for R2010+ (was `is_entity`). Updated string-stream endbit calculation to use `handle_stream_size_bits` for both entities and non-entities in R2010+.

### Bug 2: `nolinks` flag read for R2010+ entities (1-bit misalignment)

`parse_entity_common()` unconditionally read a `nolinks` (B) flag from the data stream. In R2010+, this flag is not present — entity handle linking is determined by the handle stream layout, not a data-stream flag.

**Fix:** Skipped `nolinks` read when `self.version >= DwgVersion::R2010`.

## Verification

### arc_2010.dwg (ground truth from DXF: center=75,50,0 radius=25 start=0° end=180°)

| Field | Before fix | After fix | Expected |
|-------|-----------|-----------|----------|
| center | (tiny_denorm, 0, 0) | (75, 50, 0) | (75, 50, 0) |
| radius | 0 | 25 | 25 |
| start_angle | — | 0 | 0 |
| end_angle | — | π | π |
| entity_common bits | 150 | 37 | 37 |

### Production files

| File | Sane coords before | Sane coords after |
|------|-------------------|-------------------|
| arc_2010.dwg | 0 | 1 (100%) |
| circle_2010.dwg | 0 | 1 (100%) |
| line_2010.dwg | 0 | 1 (100%) |
| pair.dwg | 160 | 324 (2x) |
| test65.dwg | ~50 | 71 |

## Files changed

- `src-tauri/dwg-parser/parser.rs`
  - `parse_single_object_r2000()`: removed RL bitsize for R2010+, updated string-stream endbit
  - `parse_entity_common()`: skipped `nolinks` flag for R2010+
