#!/usr/bin/env bash
# Build a markdown table from /tmp/corpus_scan/_summary.tsv + per-file logs
set -u
OUT="${1:-/tmp/corpus_scan}"
SUM="$OUT/_summary.tsv"
TBL="$OUT/_table.md"

{
  echo "| # | File | Size | rc | Wall(s) | Load(s) | Objs | Ents | Segs | Tris | Drops | Bbox-min | Bbox-max | Notes |"
  echo "|---|------|-----:|---:|--------:|--------:|-----:|-----:|-----:|-----:|------:|----------|----------|-------|"
} > "$TBL"

i=0
while IFS='|' read -r size rc ms name; do
  i=$((i+1))
  safe=$(echo "$name" | tr ' /' '__' | tr -cd 'A-Za-z0-9._-')
  log="$OUT/${safe}.log"
  load_s=""; objs=""; ents=""; segs=""; tris=""; drops=""; bbox_min=""; bbox_max=""; notes=""
  if [[ -f "$log" ]]; then
    load_s=$(grep -m1 "^\[load_dwg\] TOTAL:" "$log" | awk '{print $3}' | sed 's/s$//')
    line=$(grep -m1 "count_label:" "$log" | head -1)
    objs=$(echo "$line" | grep -oE 'objs=[0-9]+' | cut -d= -f2)
    ents=$(echo "$line" | grep -oE 'ents=[0-9]+' | cut -d= -f2)
    segs=$(echo "$line" | grep -oE 'segs=[0-9]+' | cut -d= -f2)
    tris=$(echo "$line" | grep -oE 'tri=[0-9]+' | cut -d= -f2)
    drops=$(grep -c "^\[load_dwg\] WARN entity .* DROPPING" "$log")
    bb=$(grep -m1 "bbox=\[" "$log" | sed 's/.*bbox=\[//; s/\].*//')
    bbox_min=$(echo "$bb" | awk -F' \\.\\. ' '{print $1}')
    bbox_max=$(echo "$bb" | awk -F' \\.\\. ' '{print $2}')
    if grep -q "panicked at" "$log"; then notes="${notes}PANIC; "; fi
    if [[ "$rc" == "124" ]]; then notes="${notes}TIMEOUT; "; fi
    boundary=$(grep -c "boundary-loop chain" "$log" 2>/dev/null)
    [[ "$boundary" -gt 0 ]] && notes="${notes}HATCH-chain×$boundary; "
    dimstyle_warn=$(grep -c "DIMSTYLE.*drift\|DIMSTYLE.*fallback" "$log" 2>/dev/null)
    [[ "$dimstyle_warn" -gt 0 ]] && notes="${notes}DIMSTYLE-warn×$dimstyle_warn; "
  fi
  size_kb=$(( size / 1024 ))
  ws_s=$(awk "BEGIN{printf \"%.1f\", $ms/1000}")
  echo "| $i | \`$name\` | ${size_kb}KB | $rc | $ws_s | ${load_s:--} | ${objs:--} | ${ents:--} | ${segs:--} | ${tris:--} | ${drops:--} | ${bbox_min:--} | ${bbox_max:--} | ${notes:-clean} |" >> "$TBL"
done < "$SUM"

cat "$TBL"
