#!/usr/bin/env bash
# compare_all.sh — render every paired (file.dwg, file.dxf) under the test
# corpus, pixel-diff the two PNGs, and emit a Markdown table summarising the
# visual match percentage per file.
#
# Output: $REPORT (defaults to the path the user requested on Desktop).
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HEADLESS="${HEADLESS:-$SCRIPT_DIR/target/release/headless-render}"
DIFF="${DIFF:-$SCRIPT_DIR/target/release/pix-diff}"
REPORT="${REPORT:-/c/Users/rickd/Desktop/dwg_samples/squad/screenshot_diff.md}"
TMP_DIR="${TMP_DIR:-/tmp/pix_diff}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-1024}"

mkdir -p "$TMP_DIR"

# Resolve binaries (try debug if release isn't built).
if [ ! -x "$HEADLESS" ] && [ ! -x "${HEADLESS}.exe" ]; then
    HEADLESS="$SCRIPT_DIR/target/debug/headless-render"
fi
if [ ! -x "$DIFF" ] && [ ! -x "${DIFF}.exe" ]; then
    DIFF="$SCRIPT_DIR/target/debug/pix-diff"
fi

# Files to compare: each entry is the path WITHOUT extension; both .dwg and .dxf
# must exist beside it.
PAIRS=(
    "/c/Users/rickd/Desktop/dwg_samples/arc_2010"
    "/c/Users/rickd/Desktop/dwg_samples/circle_2010"
    "/c/Users/rickd/Desktop/dwg_samples/line_2010"
    "/c/Users/rickd/Desktop/dwg_samples/libredwg-testdata/test/test-data/example_2010"
)

# AcadSharp sample uses paired (.dwg + _ascii.dxf); handle inline below.
ACADSHARP_DIR="/c/Users/rickd/Desktop/dwg_samples/acadsharp/samples"

{
    echo "# Screenshot diff report"
    echo
    echo "_Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) — render ${WIDTH}x${HEIGHT}, ±2 px / ±10 channel tolerance._"
    echo
    echo "| File | DWG segs | DXF segs | match% |"
    echo "|------|----------|----------|--------|"
} > "$REPORT"

run_pair() {
    local label="$1" dwg="$2" dxf="$3"
    if [ ! -f "$dwg" ] || [ ! -f "$dxf" ]; then
        echo "| $label | MISSING | MISSING | n/a |" >> "$REPORT"
        echo "[skip] $label — missing dwg or dxf"
        return
    fi
    local dwg_png="$TMP_DIR/$(basename "$label")_dwg.png"
    local dxf_png="$TMP_DIR/$(basename "$label")_dxf.png"

    echo "[render] $label .dwg"
    local dwg_log
    dwg_log="$("$HEADLESS" "$dwg" "$dwg_png" "--width=$WIDTH" "--height=$HEIGHT" 2>&1)"
    local dwg_segs
    dwg_segs="$(echo "$dwg_log" | grep -oE '[0-9]+ segments' | head -1 | awk '{print $1}')"
    echo "$dwg_log"

    echo "[render] $label .dxf"
    local dxf_log
    dxf_log="$("$HEADLESS" "$dxf" "$dxf_png" "--width=$WIDTH" "--height=$HEIGHT" 2>&1)"
    local dxf_segs
    dxf_segs="$(echo "$dxf_log" | grep -oE '[0-9]+ segments' | head -1 | awk '{print $1}')"
    echo "$dxf_log"

    if [ ! -f "$dwg_png" ] || [ ! -f "$dxf_png" ]; then
        echo "| $label | ${dwg_segs:-?} | ${dxf_segs:-?} | RENDER FAIL |" >> "$REPORT"
        return
    fi

    local pct_line
    pct_line="$("$DIFF" "$dxf_png" "$dwg_png" 2>/dev/null)"
    local pct
    pct="$(echo "$pct_line" | grep -oE '[0-9]+\.[0-9]+%' | head -1)"
    echo "$label: ${pct:-?}"
    echo "| $label | ${dwg_segs:-?} | ${dxf_segs:-?} | ${pct:-fail} |" >> "$REPORT"
}

for base in "${PAIRS[@]}"; do
    label="$(basename "$base")"
    run_pair "$label" "$base.dwg" "$base.dxf"
done

# AcadSharp sample (sample_AC1024)
run_pair "sample_AC1024" \
    "$ACADSHARP_DIR/sample_AC1024.dwg" \
    "$ACADSHARP_DIR/sample_AC1024_ascii.dxf"

echo
echo "Report written to $REPORT"
