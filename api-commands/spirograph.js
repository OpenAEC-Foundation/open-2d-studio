/**
 * Spirograph Hypotrochoid Lattice — via HTTP API
 *
 * Draws 3 layered hypotrochoid curves (like a Spirograph toy)
 * with different gear ratios, plus a Lissajous border frame.
 *
 * Usage:
 *   node api-commands/spirograph.js
 *
 * Requires the app running with API on http://127.0.0.1:49100
 */

const API = 'http://127.0.0.1:49100/eval';

const script = `
const cx = 500, cy = 500;
const t0 = performance.now();
let count = 0;

const teal   = "#00e5cc";
const violet = "#b040e0";
const coral  = "#ff6060";
const sky    = "#4090ff";
const gold   = "#d4a843";
const dim    = "#2a3a4a";
const wh     = "#aaaaaa";

// ── Hypotrochoid: x = (R-r)*cos(t) + d*cos((R-r)/r * t) ──
function hypo(R, r, dd, t) {
  const diff = R - r;
  const ratio = diff / r;
  return {
    x: cx + diff * Math.cos(t) + dd * Math.cos(ratio * t),
    y: cy + diff * Math.sin(t) + dd * Math.sin(ratio * t)
  };
}

// ── 1. Background radial dots ──
for (let a = 0; a < 360; a += 10) {
  const rad = a * Math.PI / 180;
  for (let ring = 150; ring <= 450; ring += 150) {
    cad.entities.add("circle", {
      center: { x: cx + ring * Math.cos(rad), y: cy + ring * Math.sin(rad) }, radius: 1.2,
      style: { strokeColor: dim, strokeWidth: 0.5, lineStyle: "solid" }
    });
    count++;
  }
}

// ── 2. Three hypotrochoid curves (capped segments) ──
const curves = [
  { R: 300, r: 195, d: 195, color: teal,   w: 0.8, loops: 13 },
  { R: 300, r: 111, d: 111, color: violet,  w: 0.7, loops: 37 },
  { R: 300, r:  84, d:  84, color: coral,   w: 0.6, loops:  7 },
];

for (const c of curves) {
  const totalAngle = c.loops * 2 * Math.PI;
  const segments = Math.min(c.loops * 120, 900);
  const dt = totalAngle / segments;
  for (let i = 0; i < segments; i++) {
    const p1 = hypo(c.R, c.r, c.d, i * dt);
    const p2 = hypo(c.R, c.r, c.d, (i + 1) * dt);
    cad.entities.add("line", {
      start: p1, end: p2,
      style: { strokeColor: c.color, strokeWidth: c.w, lineStyle: "solid" }
    });
    count++;
  }
}

// ── 3. Lissajous border frame (3:4 ratio) ──
const Lx = 470, Ly = 470, la = 3, lb = 4, delta = Math.PI / 2;
const lSteps = 720;
for (let i = 0; i < lSteps; i++) {
  const t1 = (i / lSteps) * 2 * Math.PI;
  const t2 = ((i + 1) / lSteps) * 2 * Math.PI;
  cad.entities.add("line", {
    start: { x: cx + Lx * Math.sin(la * t1 + delta), y: cy + Ly * Math.sin(lb * t1) },
    end:   { x: cx + Lx * Math.sin(la * t2 + delta), y: cy + Ly * Math.sin(lb * t2) },
    style: { strokeColor: sky, strokeWidth: 0.4, lineStyle: "solid" }
  });
  count++;
}

// ── 4. Outer ring ──
cad.entities.add("circle", { center: { x: cx, y: cy }, radius: 485, style: { strokeColor: gold, strokeWidth: 1.5, lineStyle: "solid" } });
cad.entities.add("circle", { center: { x: cx, y: cy }, radius: 490, style: { strokeColor: gold, strokeWidth: 0.5, lineStyle: "solid" } });
count += 2;

// ── 5. Center ornament ──
for (let i = 0; i < 6; i++) {
  const a1 = i * 60 * Math.PI / 180;
  const a2 = (i * 60 + 30) * Math.PI / 180;
  cad.entities.add("line", {
    start: { x: cx + 15 * Math.cos(a1), y: cy + 15 * Math.sin(a1) },
    end:   { x: cx + 15 * Math.cos(a1 + Math.PI), y: cy + 15 * Math.sin(a1 + Math.PI) },
    style: { strokeColor: wh, strokeWidth: 0.8, lineStyle: "solid" }
  });
  cad.entities.add("circle", {
    center: { x: cx + 20 * Math.cos(a2), y: cy + 20 * Math.sin(a2) }, radius: 3,
    style: { strokeColor: gold, strokeWidth: 1, lineStyle: "solid" }
  });
  count += 2;
}
cad.entities.add("circle", { center: { x: cx, y: cy }, radius: 5, style: { strokeColor: wh, strokeWidth: 2, lineStyle: "solid" } });
count++;

// ── 6. Title ──
cad.entities.add("text", {
  position: { x: cx, y: cy + 510 },
  text: "Spirograph Hypotrochoid Lattice",
  fontSize: 18, fontFamily: "Consolas",
  alignment: "center", verticalAlignment: "top", color: gold
});
count++;

const ms = performance.now() - t0;
cad.viewport.zoomToFit();
return JSON.stringify({ shapes: count, ms: Math.round(ms * 10) / 10, perShape: Math.round(ms / count * 1000) / 1000 });
`;

async function main() {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script }),
  });
  const json = await res.json();
  if (json.success) {
    // result may be double-quoted string or raw JSON
    let result = json.result;
    if (typeof result === 'string') {
      try { result = JSON.parse(result); } catch {}
    }
    if (typeof result === 'string') {
      try { result = JSON.parse(result); } catch {}
    }
    console.log(`Spirograph drawn: ${result.shapes} shapes in ${result.ms} ms (${result.perShape} ms/shape)`);
  } else {
    console.error('Error:', json.error);
  }
}

main();
