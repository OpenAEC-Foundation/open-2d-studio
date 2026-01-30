/**
 * Maurer Rose (n=6, d=71) — via HTTP API
 *
 * Usage:
 *   node api-commands/maurer-rose.js
 *
 * Requires the app running with API on http://127.0.0.1:49100
 * Draws 1,125 shapes individually (no batch/transaction).
 */

const API = 'http://127.0.0.1:49100/eval';

const script = `
const cx = 500, cy = 500, R = 400, n = 6, d = 71;
const gold = "#d4a843", cyan = "#00bcd4", mag = "#e040a0", dim = "#334455", wh = "#cccccc";

const rR = (dg) => R * Math.sin(n * dg * Math.PI / 180);
const pol = (r, dg) => {
  const rd = dg * Math.PI / 180;
  return { x: cx + r * Math.cos(rd), y: cy + r * Math.sin(rd) };
};

let count = 0;
const t0 = performance.now();

// 1. Radial axis lines (every 15 deg)
for (let a = 0; a < 360; a += 15) {
  const o = pol(R * 1.08, a);
  cad.entities.add("line", {
    start: { x: cx, y: cy }, end: o,
    style: { strokeColor: dim, strokeWidth: 0.3, lineStyle: "dotted" }
  });
  count++;
}

// 2. Concentric reference circles
for (let f = 0.25; f <= 1.0; f += 0.25) {
  cad.entities.add("circle", {
    center: { x: cx, y: cy }, radius: R * f,
    style: { strokeColor: dim, strokeWidth: 0.3, lineStyle: "dashed" }
  });
  count++;
}

// 3. Maurer Rose — straight-line star pattern (360 segments)
for (let k = 0; k < 360; k++) {
  const p1 = pol(rR(k * d), k * d);
  const p2 = pol(rR((k + 1) * d), (k + 1) * d);
  cad.entities.add("line", {
    start: p1, end: p2,
    style: { strokeColor: cyan, strokeWidth: 0.5, lineStyle: "solid" }
  });
  count++;
}

// 4. Smooth rose curve overlay (720 segments at 0.5 deg steps)
const step = 0.5;
for (let dg = 0; dg < 360; dg += step) {
  const p1 = pol(rR(dg), dg);
  const p2 = pol(rR(dg + step), dg + step);
  cad.entities.add("line", {
    start: p1, end: p2,
    style: { strokeColor: mag, strokeWidth: 1.2, lineStyle: "solid" }
  });
  count++;
}

// 5. Decorative outer rings
cad.entities.add("circle", { center: { x: cx, y: cy }, radius: R * 1.05, style: { strokeColor: gold, strokeWidth: 2, lineStyle: "solid" } });
cad.entities.add("circle", { center: { x: cx, y: cy }, radius: R * 1.08, style: { strokeColor: gold, strokeWidth: 0.5, lineStyle: "solid" } });
cad.entities.add("circle", { center: { x: cx, y: cy }, radius: 8, style: { strokeColor: wh, strokeWidth: 2, lineStyle: "solid" } });
cad.entities.add("circle", { center: { x: cx, y: cy }, radius: 3, style: { strokeColor: gold, strokeWidth: 2, lineStyle: "solid" } });
count += 4;

// 6. Small circles at petal tips
for (let i = 0; i < 12; i++) {
  const angle = i * 30 + 15;
  const tipR = Math.abs(rR(angle));
  if (tipR > R * 0.8) {
    const tip = pol(tipR, angle);
    cad.entities.add("circle", { center: tip, radius: 6, style: { strokeColor: gold, strokeWidth: 1.5, lineStyle: "solid" } });
    count++;
  }
}

// 7. Title text
cad.entities.add("text", {
  position: { x: cx, y: cy + R * 1.18 },
  text: "Maurer Rose  n=6  d=71",
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
    let result = json.result;
    if (typeof result === 'string') {
      try { result = JSON.parse(result); } catch {}
    }
    if (typeof result === 'string') {
      try { result = JSON.parse(result); } catch {}
    }
    console.log(`Maurer Rose drawn: ${result.shapes} shapes in ${result.ms} ms (${result.perShape} ms/shape)`);
  } else {
    console.error('Error:', json.error);
  }
}

main();
