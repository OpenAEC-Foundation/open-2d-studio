# Night-shift coordinator report — 2026-05-05/06

Branch: `merge-1.0-2.0`
Corpus: `C:\Users\rickd\Desktop\dwg_samples\test\` (20 files)
Renders: `docs/superpowers/plans/artefacts/corpus-renders/` (15 PNGs)

## Initial corpus health (start of shift)

- **11 of 20 PNG renders existed** (1024×1024).
- 5 baseline-known failures (timeouts/panic): TO-03, TO-04, Kerk, eyk_livingstone, 2023-189.
- The other agent's `dwg-corpus-baseline.md` had identified: 592× INSERT extreme-coord, 152× LINE extreme-coord, GPU panic on Kerk.

## Visual defects observed (initial pass — 11 PNGs)

| Defect bucket | Affected files | Severity |
|---|---|---|
| Drawing dwarfed by extreme coords; tiny content cluster in big viewport | 8/11 | 🔴 highest leverage |
| Glyph crowding / text legibility (1024px on A0 sheet = ~2px tall text) | 5/11 | 🟡 resolution-bound |
| Nearly-empty (single 5px speck) | 3/11 | 🔴 |

## Fixes landed this shift

### Round 1 — `1a7cfbb` — `fix(scene_io): lower p90-filter trigger 1e6→1e5`

**Root cause:** `PATHOLOGICAL_PROBE` constant gated the percentile cluster-filter behind a 1e6-coord trigger, so files with surviving outliers in the 1e5–1e6 range (Dutch civil/cadastral) never engaged the filter and were rendered at full bbox span. ODA-cited per AcDbInsert §20.4.42 / AcDbDimension §20.4.51.

**Visual delta (verified by re-render):**
- TO-05 Dakoverzicht: 5-pixel speck → fully readable plan with grid labels (A-Q rows, 1-19 cols), dimensions, title block.
- TO-02 Gevelaanzichten: bbox tightened from 513921 → 499657 max; dropped 2356 outlier segments.
- TO-01 Kadastrale: dropped 4369 outliers (top sources: INSERT instances of "Standard grid marker" family).
- waaldijk_herwijnen: bbox preserved (genuine wide spread); titleblock still visible.

**Files unchanged:** TO-07.1/.4 (already compact, filter SKIPPED — no |coord|>1e5).

### Round 2 — `19f60ee` — `fix(headless_render): elevate wgpu buffer limits`

**Root cause:** Default `wgpu::Limits::max_buffer_size = 256 MB` crashed on multi-million-segment DWGs. Mirror of GUI fix `dbf900d`.

**Visual delta:** Did not verify directly — Kerk parser still timed out at 300s (parse-perf bug, separate). The fix is preventive for any future render that gets past the parser bottleneck.

## Re-render sweep (after Rounds 1+2)

8 files re-rendered at 2048×2048 (binary default). Results visible in:
- `corpus-renders/TO-05 Dakoverzicht.png` — DRAMATIC win (full plan visible)
- `corpus-renders/TO-01 Kadastrale situatie.png` — content cluster now occupies real viewport area
- `corpus-renders/TO-02 Gevelaanzichten.png` — building elevations visible with red/yellow lines
- `corpus-renders/waaldijk_herwijnen.png` — title strip + cadastral plan inset visible
- `corpus-renders/20251110_Nieuwe-toestand*.png` — STILL nearly empty (real bbox is 1M×528K from genuine geo content; needs cluster-density approach not pure-coord cap)

## Defects still standing

1. **Kerk render timeout** — parser too slow on 6.8 MB R2018 file (154s parse + render budget). Parser-perf optimization needed (see follow-up #2 in baseline doc).
2. **TO-03 / TO-04 / 2023-189 / eyk** — same parser-perf class (1.8–43 MB R2018).
3. **Nieuwe-toestand 121224 (×2)** — bbox correctly fits genuine 1M×528K civil-data spread but the scale crushes building cluster to ~5px. Needs object-density-weighted cluster detection (out of scope for night-shift).
4. **R2018 "Standard grid marker" block bit-misalignment** — 50× drop pattern observed across 16/20 corpus files, all with same block-name family. Per follow-up #1 in baseline doc — needs ODA §20.4.40/§20.4.85 bit-walk against reference DXF.
5. **R2007+ DIMSTYLE ~148-bit drift** — pre-existing, separate finding.

## Commits landed (chronological)

| SHA | Subject |
|---|---|
| `1a7cfbb` | fix(scene_io): lower p90-filter trigger 1e6→1e5 to engage on sparse civil drawings |
| `19f60ee` | fix(headless_render): elevate wgpu buffer limits to render large DWGs |

(Plus other agent's docs commit `ca35717` documenting the same Round 1 deltas in `dwg-corpus-baseline.md`.)

## Final corpus health

- 15 of 20 PNGs rendered (vs. 11 at shift start; +4 from re-render of newly succeeding files).
- 5 still failing — all known parse-perf timeouts (Kerk, TO-03, TO-04, eyk, 2023-189).
- Of the 15 rendered: ~10 now show usable visual content (vs. ~5 at shift start, where most were a 5-pixel speck on black).

## Recommended next-session priorities

1. **Parser perf optimization on R2018 files** — would unlock 4 of the 5 currently-timing-out renders (TO-03, TO-04, eyk, 2023-189). Per baseline target #3.
2. **R2018 "Standard grid marker" block decode** — ODA §20.4.40/§20.4.85 bit-walk vs DXF reference. Would fix the residual extreme-coord LINE/INSERT entities corpus-wide. Per baseline target #1.
3. **Object-density-weighted cluster detection for camera fit** — would fix Nieuwe-toestand-class drawings without dropping legitimate spread.
4. **Re-render at higher native resolution** for sheet-sized files (A0/A1 input → 4096×4096 minimum for legible text).
5. **Direct ODA-spec investigation of the INSERT extreme-coord pattern** affecting 16/20 corpus files (per baseline highest-leverage target #1).

## Budget consumption

- Rounds completed: 2 (of 6 budgeted)
- Atomic commits: 2 (of 25 budgeted)
- Time: ~1.5 hours active (of 8 budgeted)

Stopped early because:
- The two highest-leverage corpus-wide fixes were exhausted in 2 rounds.
- Remaining defects (parser perf, specific-block decode bug, density clustering) all require deeper ODA investigation that exceeds the night-shift loop's "iterate-fast" remit and would risk the rabbit-hole stopping rule.
- Better to leave headroom for next session than thrash on diminishing returns.
