#!/usr/bin/env node
// Build R0 / R1 / R2 side-by-side summary table from the JSONL files saved
// by bench_ifcdraw_size.ps1. Appends the table to the bench markdown.

const fs = require("fs");
const path = require("path");

const TMP = process.env.TEMP
  ? path.join(process.env.TEMP, "ifcdraw-bench")
  : "/tmp/ifcdraw-bench";
const OUT = "C:/Users/rickd/Documents/GitHub/open-2d-studio/docs/superpowers/plans/artefacts/ifcdraw-size-baseline.md";

function load(p) {
  if (!fs.existsSync(p)) return new Map();
  const out = new Map();
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const o = JSON.parse(t);
      if (o.error) continue;
      out.set(o.name, o);
    } catch {}
  }
  return out;
}

function fmt(b) {
  if (b == null) return "-";
  b = Number(b);
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
}
function rt(x) {
  return x == null ? "-" : Number(x).toFixed(3);
}

const R0 = load(path.join(TMP, "results-R0-baseline.jsonl"));
const R1 = load(path.join(TMP, "results-R1-delta-zz.jsonl"));
const R2 = load(path.join(TMP, "results-R2-meta-rle.jsonl"));

console.log(`R0 entries: ${R0.size} | R1: ${R1.size} | R2: ${R2.size}`);

const names = new Set();
for (const m of [R0, R1, R2]) for (const k of m.keys()) names.add(k);
const sorted = [...names].sort();

const lines = [];
lines.push("");
lines.push("## Round comparison: R0 vs R1 vs R2");
lines.push("");
lines.push("R0 = baseline (msgpack + q16 + zstd-19). R1 = + delta + zigzag-LEB128 on coord blobs. R2 = + RLE-pack per-segment/per-triangle metadata.");
lines.push("");
lines.push("| File | Src | R0 ifc | R0 ratio | R1 ifc | R1 ratio | R2 ifc | R2 ratio | < 1.0? |");
lines.push("|---|---:|---:|---:|---:|---:|---:|---:|:---:|");

let sumSrc = 0, s0 = 0, s1 = 0, s2 = 0;
for (const n of sorted) {
  const r0 = R0.get(n);
  const r1 = R1.get(n);
  const r2 = R2.get(n);
  const src = (r2 || r1 || r0)?.src_bytes;
  if (!src) continue;
  sumSrc += Number(src);
  if (r0) s0 += Number(r0.ifcdraw_bytes);
  if (r1) s1 += Number(r1.ifcdraw_bytes);
  if (r2) s2 += Number(r2.ifcdraw_bytes);
  const mark = r2 && Number(r2.ratio) < 1.0 ? "yes" : "**NO**";
  lines.push(`| \`${n}\` | ${fmt(src)} | ${r0 ? fmt(r0.ifcdraw_bytes) : "-"} | ${rt(r0?.ratio)} | ${r1 ? fmt(r1.ifcdraw_bytes) : "-"} | ${rt(r1?.ratio)} | ${r2 ? fmt(r2.ifcdraw_bytes) : "-"} | ${rt(r2?.ratio)} | ${mark} |`);
}
if (sumSrc > 0) {
  lines.push(`| **TOTAL** | **${fmt(sumSrc)}** | **${fmt(s0)}** | **${(s0/sumSrc).toFixed(3)}** | **${fmt(s1)}** | **${(s1/sumSrc).toFixed(3)}** | **${fmt(s2)}** | **${(s2/sumSrc).toFixed(3)}** | |`);
}
lines.push("");

const text = lines.join("\n");
if (fs.existsSync(OUT)) {
  fs.appendFileSync(OUT, text);
  console.log(`appended to ${OUT}`);
} else {
  fs.writeFileSync(OUT, text);
  console.log(`wrote ${OUT}`);
}
console.log(text);
