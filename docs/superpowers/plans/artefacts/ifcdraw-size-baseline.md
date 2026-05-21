# IFCDraw size baseline vs. source DWG/DXF

Measurements emitted by `scripts/bench_ifcdraw_size.ps1`.
`ratio = ifcdraw_bytes / src_bytes`; values < 1.0 mean we beat the source DWG.

## Round: R0-baseline

Baseline: msgpack + q16 quantisation + zstd level 19 (no extra packing). Files larger than 5 MB excluded for fast Phase 1 iteration.

Generated: 2026-05-21 22:18:55

| File | Src | IFCDraw | Ratio | < 1.0? | Segs | Tris | Layers | Parse ms | Save ms |
|---|---:|---:|---:|:---:|---:|---:|---:|---:|---:|
| `20250602 Ontwerp Landekensdijk 4.dwg` | 1,0 MB | 492,4 KB | 0,470 | yes | 278.557 | 223.417 | 43 | 951 | 557 |
| `20251110_2024.14-001 Nieuwe toestand121224 (1).dwg` | 1,3 MB | 15,4 KB | 0,012 | yes | 2.932.097 | 11.052 | 80 | 1485 | 122 |
| `20251110_2024.14-001 Nieuwe toestand121224.dwg` | 1,3 MB | 15,4 KB | 0,012 | yes | 2.932.097 | 11.052 | 80 | 1513 | 125 |
| `2627_3BM_CP-21_DWG_16-02-2026.dwg` | 679,6 KB | 12,9 MB | 19,469 | **NO** | 6.178.090 | 5.866.755 | 28 | 5025 | 8604 |
| `2705_model Funderingsherstel - Constructie - Sheet - CP-21 - Constructietekening.dwg` | 233,4 KB | 1,4 MB | 6,031 | **NO** | 433.798 | 385.583 | 21 | 453 | 996 |
| `2705_model Funderingsherstel - Constructie - Sheet - CP-21 - Constructietekening.dxf` | 1,4 MB | 1,5 MB | 1,045 | **NO** | 489.085 | 417.479 | 17 | 361 | 1084 |
| `pair.dwg` | 1,1 MB | 2,3 MB | 2,114 | **NO** | 857.307 | 613.616 | 38 | 2053 | 1834 |
| `prefab-beton-C35_45-ligger-combinatievloer-VBI-2D.dwg` | 23,5 KB | 221 B | 0,009 | yes | 0 | 0 | 1 | 27 | 18 |
| `Tekenwerk Controle 01Overzicht 2 - Tekenwerk Controle 01.dwg` | 1,1 MB | 318,9 KB | 0,295 | yes | 88.855 | 60.119 | 2 | 1050 | 199 |
| `TO-01 Kadastrale situatie.dwg` | 157,0 KB | 720,7 KB | 4,591 | **NO** | 105.304 | 101.368 | 17 | 200 | 252 |
| `TO-02 Gevelaanzichten.dwg` | 981,8 KB | 509,3 KB | 0,519 | yes | 920.170 | 859.264 | 56 | 10051 | 723 |
| `TO-03 Plattegrond begane grond.dwg` | 0 B | error: no-json-exit= | - | - | - | - | - | - | - |
| `TO-04 Plattegrond eerste en tweede verdieping.dwg` | 0 B | error: no-json-exit= | - | - | - | - | - | - | - |
| `TO-05 Dakoverzicht.dwg` | 208,8 KB | 171,9 KB | 0,823 | yes | 31.998 | 29.441 | 28 | 276 | 97 |
| `TO-06 Doorsneden.dwg` | 600,6 KB | 695,1 KB | 1,157 | **NO** | 563.007 | 529.566 | 76 | 3467 | 657 |
| `TO-07.1 Principe details 01-11.dwg` | 375,2 KB | 1,9 MB | 5,241 | **NO** | 383.605 | 333.982 | 12 | 455 | 930 |
| `TO-07.2 Principe details 12-24.dwg` | 1.004,4 KB | 1,8 MB | 1,872 | **NO** | 3.854.691 | 2.273.437 | 12 | 7142 | 5584 |
| `TO-07.3 Principe details 25-31.dwg` | 410,1 KB | 1,3 MB | 3,283 | **NO** | 1.315.490 | 1.012.091 | 11 | 1803 | 1502 |
| `TO-07.4 Principe details 32-41.dwg` | 759,3 KB | 995,8 KB | 1,312 | **NO** | 195.843 | 153.037 | 5 | 579 | 427 |
| `waaldijk_herwijnen.dwg` | 565,4 KB | 1,2 MB | 2,216 | **NO** | 2.579.126 | 267.940 | 94 | 8372 | 889 |
| **TOTAL** | **13,0 MB** | **28,2 MB** | **2,163** | | | | | | |


