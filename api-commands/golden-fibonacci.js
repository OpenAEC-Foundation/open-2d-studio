/**
 * Golden Fibonacci Spiral — via HTTP API
 *
 * Draws a Fibonacci spiral with golden-ratio rectangles,
 * a sunflower seed phyllotaxis pattern, and radial golden arcs.
 *
 * Usage:
 *   node api-commands/golden-fibonacci.js
 *
 * Requires the app running with API on http://127.0.0.1:49100
 */

const API = 'http://127.0.0.1:49100/eval';

const script = `
const cx = 500, cy = 500;
const t0 = performance.now();
let count = 0;

const gold   = "#d4a843";
const amber  = "#ff9800";
const green  = "#4caf50";
const teal   = "#00bcd4";
const rose   = "#e91e63";
const dim    = "#2a3a4a";
const wh     = "#999999";

const PHI = (1 + Math.sqrt(5)) / 2; // 1.618...
const GA  = 2 * Math.PI / (PHI * PHI); // golden angle ~137.5 deg

// ────────────────────────────────────────────────
// 1. Sunflower Phyllotaxis — 500 seed dots
// ────────────────────────────────────────────────
const maxSeeds = 500;
const maxR = 420;
for (let i = 1; i <= maxSeeds; i++) {
  const angle = i * GA;
  const r = maxR * Math.sqrt(i / maxSeeds);
  const x = cx + r * Math.cos(angle);
  const y = cy + r * Math.sin(angle);
  // Color varies by spiral arm
  const arm = i % 3;
  const col = arm === 0 ? teal : arm === 1 ? green : amber;
  const sz = 1.5 + 2.5 * (i / maxSeeds); // bigger toward outside
  cad.entities.add("circle", {
    center: { x, y }, radius: sz,
    style: { strokeColor: col, strokeWidth: 0.6, lineStyle: "solid" }
  });
  count++;
}

// ────────────────────────────────────────────────
// 2. Fibonacci spiral (quarter-arc segments)
//    Each arc has radius = fibonacci number, scaled
// ────────────────────────────────────────────────
const fibs = [1,1,2,3,5,8,13,21,34,55,89,144];
const scale = 2.8;
let sx = cx, sy = cy;
let dir = 0; // 0=right, 1=up, 2=left, 3=down

for (let f = 0; f < fibs.length; f++) {
  const r = fibs[f] * scale;
  // Arc center offset depends on direction
  const startAngle = (dir + 2) * Math.PI / 2;
  const endAngle   = (dir + 3) * Math.PI / 2;

  // Draw arc as line segments (40 segments per quarter)
  const segs = 40;
  for (let i = 0; i < segs; i++) {
    const a1 = startAngle + (endAngle - startAngle) * (i / segs);
    const a2 = startAngle + (endAngle - startAngle) * ((i + 1) / segs);
    cad.entities.add("line", {
      start: { x: sx + r * Math.cos(a1), y: sy + r * Math.sin(a1) },
      end:   { x: sx + r * Math.cos(a2), y: sy + r * Math.sin(a2) },
      style: { strokeColor: rose, strokeWidth: 1.8, lineStyle: "solid" }
    });
    count++;
  }

  // Move to next corner
  switch (dir % 4) {
    case 0: sx += r; sy -= r; break;
    case 1: sx += r; sy += r; break;
    case 2: sx -= r; sy += r; break;
    case 3: sx -= r; sy -= r; break;
  }
  dir++;
}

// ────────────────────────────────────────────────
// 3. Golden rectangles (nested)
// ────────────────────────────────────────────────
let rx = cx, ry = cy;
let rdir = 0;
for (let f = 0; f < Math.min(fibs.length, 10); f++) {
  const side = fibs[f] * scale;
  // Draw rectangle outline as 4 lines
  let x0 = rx, y0 = ry, w = side, h = side;

  // Adjust based on accumulated position (simplified — just draw squares at spiral positions)
  const fade = 0.15 + 0.6 * (f / 10);
  const alpha = Math.round(fade * 255).toString(16).padStart(2, '0');
  const col = gold + alpha;

  // We draw the square centered at the arc center
  // (simplified: concentric squares scaled by golden ratio)
  const sz = side;
  cad.entities.add("rectangle", {
    position: { x: cx - sz, y: cy - sz },
    width: sz * 2, height: sz * 2, rotation: f * 5,
    style: { strokeColor: gold, strokeWidth: 0.4, lineStyle: "dashed" }
  });
  count++;
}

// ────────────────────────────────────────────────
// 4. Radial golden-angle rays
// ────────────────────────────────────────────────
for (let i = 0; i < 34; i++) {
  const angle = i * GA;
  const inner = 30;
  const outer = maxR + 20;
  cad.entities.add("line", {
    start: { x: cx + inner * Math.cos(angle), y: cy + inner * Math.sin(angle) },
    end:   { x: cx + outer * Math.cos(angle), y: cy + outer * Math.sin(angle) },
    style: { strokeColor: dim, strokeWidth: 0.25, lineStyle: "dotted" }
  });
  count++;
}

// ────────────────────────────────────────────────
// 5. Concentric Fibonacci-radius circles
// ────────────────────────────────────────────────
for (let f = 4; f < fibs.length; f++) {
  cad.entities.add("circle", {
    center: { x: cx, y: cy }, radius: fibs[f] * scale,
    style: { strokeColor: dim, strokeWidth: 0.3, lineStyle: "dashed" }
  });
  count++;
}

// ────────────────────────────────────────────────
// 6. Outer frame
// ────────────────────────────────────────────────
cad.entities.add("circle", { center: { x: cx, y: cy }, radius: maxR + 15, style: { strokeColor: gold, strokeWidth: 1.5, lineStyle: "solid" } });
cad.entities.add("circle", { center: { x: cx, y: cy }, radius: maxR + 20, style: { strokeColor: gold, strokeWidth: 0.5, lineStyle: "solid" } });
count += 2;

// ────────────────────────────────────────────────
// 7. Center ornament — golden ratio symbol
// ────────────────────────────────────────────────
cad.entities.add("circle", { center: { x: cx, y: cy }, radius: 10, style: { strokeColor: wh, strokeWidth: 2, lineStyle: "solid" } });
cad.entities.add("circle", { center: { x: cx, y: cy }, radius: 4, style: { strokeColor: gold, strokeWidth: 2, lineStyle: "solid" } });
count += 2;

// ────────────────────────────────────────────────
// 8. PHI value markers at key radii
// ────────────────────────────────────────────────
const markers = [89, 144, 233];
for (const m of markers) {
  const r = m * scale * 0.5;
  if (r < maxR) {
    cad.entities.add("text", {
      position: { x: cx + r + 8, y: cy - 5 },
      text: String(m),
      fontSize: 10, fontFamily: "Consolas",
      alignment: "left", verticalAlignment: "middle", color: wh
    });
    count++;
  }
}

// ────────────────────────────────────────────────
// 9. Title
// ────────────────────────────────────────────────
cad.entities.add("text", {
  position: { x: cx, y: cy + maxR + 45 },
  text: "Golden Fibonacci Spiral — PHI = 1.6180339...",
  fontSize: 16, fontFamily: "Consolas",
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
    if (typeof result === 'string') { try { result = JSON.parse(result); } catch {} }
    if (typeof result === 'string') { try { result = JSON.parse(result); } catch {} }
    console.log(`Golden Fibonacci drawn: ${result.shapes} shapes in ${result.ms} ms (${result.perShape} ms/shape)`);
  } else {
    console.error('Error:', json.error);
  }
}

main();
