#!/usr/bin/env bash
# Corpus scan: run headless-render on each DWG with profile flag, dump per-file log.
# Usage: bash scripts/corpus_scan.sh [out_dir]
set -u

CORPUS="C:/Users/rickd/Desktop/dwg_samples/test"
BIN="./kernel/target/release/headless-render.exe"
OUT="${1:-/tmp/corpus_scan}"
mkdir -p "$OUT"

echo "scan starting: corpus=$CORPUS  bin=$BIN  out=$OUT"
i=0
# Sort by size ascending so smallest are first (errors easier to triage)
while IFS= read -r path; do
  i=$((i+1))
  name=$(basename "$path")
  safe=$(echo "$name" | tr ' /' '__' | tr -cd 'A-Za-z0-9._-')
  log="$OUT/${safe}.log"
  png="$OUT/${safe}.png"
  size=$(stat -c%s "$path" 2>/dev/null || stat -f%z "$path" 2>/dev/null || echo 0)
  echo "[$i] $name  ($size bytes)"
  start=$(date +%s%N)
  O2D_LOAD_PROFILE=1 timeout 180 "$BIN" "$path" "$png" >"$log" 2>&1
  rc=$?
  end=$(date +%s%N)
  ms=$(( (end - start) / 1000000 ))
  echo "    rc=$rc  wall=${ms}ms  log=$log"
  echo "$size|$rc|$ms|$name" >> "$OUT/_summary.tsv"
done < <(find "$CORPUS" -maxdepth 1 -type f -name '*.dwg' -printf '%s %p\n' | sort -n | cut -d' ' -f2-)

echo "scan complete -> $OUT"
