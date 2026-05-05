# DWG Corpus Baseline Scan — 2026-05-05

Corpus: `C:\Users\rickd\Desktop\dwg_samples\test\` (20 files, 22 KB → 43 MB).
Build: `kernel/target/release/headless-render.exe` at branch `merge-1.0-2.0`
(commit before any corpus-driven fix).
Driver: `scripts/corpus_scan.sh` runs `O2D_LOAD_PROFILE=1 headless-render` per file
with a 180 s wall timeout and 2048×2048 PNG output.
Summarizer: `scripts/corpus_summarize.sh`.

## Per-file results (sorted by size ascending)

| # | File | Size | rc | Wall(s) | Load(s) | Objs | Ents | Segs | Tris | Drops | Bbox-min | Bbox-max | Notes |
|---|------|-----:|---:|--------:|--------:|-----:|-----:|-----:|-----:|------:|----------|----------|-------|
| 1 | `prefab-beton-C35_45-ligger-combinatievloer-VBI-2D.dwg` | 23KB | 0 | 0.6 | 0.016 | 102 | 4 | 0 | 0 | 1 | 1.00,0.00 | 1.00,0.00 | clean |
| 2 | `TO-01 Kadastrale situatie.dwg` | 156KB | 0 | 0.7 | 0.166 | 1136 | 1008 | 105304 | 101368 | 4 | -185.00,4.57 | 1472.77,232.74 | clean |
| 3 | `TO-05 Dakoverzicht.dwg` | 208KB | 0 | 0.6 | 0.078 | 2018 | 1490 | 31998 | 29441 | 50 | -13241.48,-28127.52 | 90310.00,100510.02 | clean |
| 4 | `TO-07.1 Principe details 01-11.dwg` | 375KB | 0 | 0.9 | 0.334 | 2473 | 2312 | 383605 | 333982 | 31 | -185.00,-0.50 | 42046.03,3623.86 | clean |
| 5 | `TO-07.3 Principe details 25-31.dwg` | 410KB | 0 | 2.3 | 1.778 | 12300 | 12100 | 1315490 | 1012091 | 10 | -185.00,-0.00 | 39594.48,214105.28 | clean |
| 6 | `waaldijk_herwijnen.dwg` | 565KB | 0 | 16.3 | 13.804 | 10831 | 8055 | 2579126 | 267940 | 10 | 0.00,7017.48 | 744799.83,190897.06 | clean |
| 7 | `TO-06 Doorsneden.dwg` | 600KB | 0 | 3.8 | 2.947 | 18112 | 17191 | 563007 | 529566 | 326 | -185.00,0.00 | 355562.65,44260.92 | clean |
| 8 | `2627_3BM_CP-21_DWG_16-02-2026.dwg` | 679KB | 0 | 7.2 | 5.913 | 13712 | 12969 | 6178090 | 5866755 | 3 | -39549.03,-10034.80 | 99768.53,44269.59 | clean |
| 9 | `TO-07.4 Principe details 32-41.dwg` | 759KB | 0 | 1.1 | 0.551 | 2077 | 1945 | 195843 | 153037 | 7 | -185.00,-0.50 | 7560.26,1775.98 | clean |
| 10 | `TO-02 Gevelaanzichten.dwg` | 981KB | 0 | 31.5 | 30.146 | 24160 | 22323 | 922526 | 859264 | 79 | -185.00,0.00 | 513921.28,42661.85 | clean |
| 11 | `TO-07.2 Principe details 12-24.dwg` | 1004KB | 0 | 10.0 | 9.030 | 20601 | 20368 | 3854691 | 2273437 | 50 | -65536.00,-262144.00 | 131072.00,262144.00 | clean |
| 12 | `20250602 Ontwerp Landekensdijk 4.dwg` | 1048KB | 0 | 2.8 | 2.117 | 19828 | 18772 | 278557 | 223417 | 47 | -24.00,-84938.36 | 706737.69,644052.29 | clean |
| 13 | `Tekenwerk Controle 01Overzicht 2 - Tekenwerk Controle 01.dwg` | 1081KB | 0 | 1.4 | 0.837 | 33820 | 29473 | 88855 | 60119 | 0 | 0.00,0.00 | 230051.18,15479.78 | clean |
| 14 | `20251110_2024.14-001 Nieuwe toestand121224 (1).dwg` | 1323KB | 0 | 2.4 | 1.846 | 22550 | 21440 | 2932097 | 11052 | 6 | -0.00,-528467.25 | 994960.75,7.20 | clean |
| 15 | `20251110_2024.14-001 Nieuwe toestand121224.dwg` | 1323KB | 0 | 2.4 | 1.817 | 22550 | 21440 | 2932097 | 11052 | 6 | -0.00,-528467.25 | 994960.75,7.20 | clean |
| 16 | `TO-04 Plattegrond eerste en tweede verdieping.dwg` | 1878KB | 124 | 180.8 | - | - | - | - | - | 1 | - | - | TIMEOUT |
| 17 | `TO-03 Plattegrond begane grond.dwg` | 2822KB | 124 | 181.1 | - | - | - | - | - | 1 | - | - | TIMEOUT |
| 18 | `Kerk aan de Haven constructeur.dwg` | 6967KB | 101 | 163.8 | 154.896 | 90025 | 74976 | 9005193 | 528330 | 161 | -981303.45,-869381.00 | 992942.58,816627.90 | PANIC (GPU buffer 268 MB cap) |
| 19 | `eyk_livingstone_VOORLOPIG.dwg` | 14022KB | 124 | 180.4 | - | - | - | - | - | 8 | - | - | TIMEOUT |
| 20 | `2023-189 POL_APD_TEK DEF 22-04-25.dwg` | 44317KB | 124 | 180.3 | - | - | - | - | - | 0 | - | - | TIMEOUT |

## Defect bucket summary

| Bucket | Count | Files |
|--------|------:|-------|
| ❌ Crash / panic (GPU validation, buffer > 256 MB) | 1 | Kerk |
| ⚠️ Loaded but >1 % entities dropped by per-entity caps | 6 | TO-06 (1.9 %), TO-05 (3.4 %), TO-07.1 (1.3 %), TO-02 (0.4 %), Kerk (0.2 %), 20250602_Ontwerp (0.3 %) — most of those are 326/161/79 absolute, not high % |
| ⚠️ Loaded with at least one pathological-coord drop | 16 | almost all real-world files |
| ⌛ Timed out at 180 s wall (parser + render) | 4 | TO-04 (1.9 MB), TO-03 (2.8 MB), eyk (14 MB), 2023-189 (43 MB) |
| ✅ Clean — zero entity drops, zero warnings | 1 | Tekenwerk Controle 01 |
| ✅ Loaded clean enough for production | 14 | all sub-1.5 MB except TO-04 |

## Aggregated warning frequencies (~750 lines, R2007/R2018 mixed)

```
592× INSERT  max|coord| > 1e8  (single biggest leakage class — 18/20 files)
152× LINE    max|coord| > 1e8
 25× INSERT  produced > 250 000 segs (recursion / explode-bomb)
 13× POINT   max|coord| > 1e8
  7× MTEXT/font-substitution warnings (cosmetic — embedded DejaVuSans fallback works)
  5× HATCH   max|coord| > 1e8
  5× ARC     max|coord| > 1e8
  3× LWPOLY  max|coord| > 1e8
  3× DIMENSION_ANGNLN  max|coord| > 1e8
  1× ELLIPSE max|coord| > 1e8
  1× DIMENSION_ORDINATE max|coord| > 1e8
  1× wgpu validation panic (GPU side, not parser)
```

## Highest-leverage targets (in order)

1. **`type=INSERT max|coord|=1eN` decode bug (~592 hits, 16 files affected).**
   Magnitudes seen include 1e42, 1e58, 1e161, 1e244, …  These are
   the signature of a misaligned `read_3bd()` for the insertion point.
   Either `parse_insert` is reading at the wrong bit offset, or the
   common-entity-data prefix that precedes it has drifted by a few
   bits on R2007+ files. Fixing this likely also clears most LINE,
   POINT, ARC, ELLIPSE drops that share the prefix.

2. **R2007+ DIMSTYLE BD bit-stream ~148-bit drift** — already noted in
   `SPEC_NOTES.md` open findings. Less frequent (DIMSTYLE only) but
   blocks proper DIMSCALE/DIMTXT/DIMASZ extraction.

3. **Parser perf on 1.8 MB+ R2018 files (TO-03, TO-04, 2023-189).**
   TO-04 spent 77 s in `phase parse:` for 57 013 objects — that's
   1.4 ms/object, dominated by re-decoding rather than IO. Parse
   throughput needs to roughly 5× to fit a 30 s budget on TO-03.

4. **Explode-bomb cap on INSERT recursion (250 k seg cap).** 25 hits
   total, mostly Kerk + eyk. Symptom of either (a) genuinely huge
   block, or (b) cycle in BLOCK_HEADER chain.

5. **Kerk render-side wgpu panic.** Out of scope for the parser, but
   worth a buffer-tier-bump on the GPU consumer side (`scene_io.rs`).

## Workflow per fix

After each commit:
1. `bash scripts/corpus_scan.sh /tmp/corpus_scan_<tag>`
2. `bash scripts/corpus_summarize.sh /tmp/corpus_scan_<tag>`
3. Compare to baseline: warning-counts down, files moved ⚠️→✅.
4. Append a delta row below.

## Delta log

(none yet — baseline only)
