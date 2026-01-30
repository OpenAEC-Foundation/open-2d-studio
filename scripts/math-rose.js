/**
 * Mathematical Rose Drawing — paste into the browser console (window.cad)
 *
 * Draws a Maurer Rose (n=6, d=71) rendered as line segments,
 * a smooth rose curve overlay, concentric accent circles,
 * and radial axis lines — all using individual cad.entities.add() calls.
 */
(() => {
  const api = window.cad;
  if (!api) { console.error('cad API not available'); return; }

  const cx = 500, cy = 500;   // center
  const R = 400;               // outer radius

  // ── Color palette ──
  const gold    = '#d4a843';
  const cyan    = '#00bcd4';
  const magenta = '#e040a0';
  const dim     = '#334455';
  const white   = '#cccccc';

  // ── Helper: polar rose  r = R * sin(n * θ) ──
  const n = 6;   // petals parameter
  const d = 71;  // Maurer parameter

  function roseR(thetaDeg) {
    return R * Math.sin((n * thetaDeg * Math.PI) / 180);
  }
  function pol(r, thetaDeg) {
    const rad = (thetaDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  // ────────────────────────────────────────────────
  // 1. Radial axis lines (every 15°)
  // ────────────────────────────────────────────────
  for (let a = 0; a < 360; a += 15) {
    const outer = pol(R * 1.08, a);
    api.entities.add('line', {
      start: { x: cx, y: cy },
      end: outer,
      style: { strokeColor: dim, strokeWidth: 0.3, lineStyle: 'dotted' },
    });
  }

  // ────────────────────────────────────────────────
  // 2. Concentric reference circles
  // ────────────────────────────────────────────────
  for (let frac = 0.25; frac <= 1.0; frac += 0.25) {
    api.entities.add('circle', {
      center: { x: cx, y: cy },
      radius: R * frac,
      style: { strokeColor: dim, strokeWidth: 0.3, lineStyle: 'dashed' },
    });
  }

  // ────────────────────────────────────────────────
  // 3. Maurer Rose — straight-line segments (the spiky star)
  // ────────────────────────────────────────────────
  for (let k = 0; k < 360; k++) {
    const t1 = k * d;
    const t2 = (k + 1) * d;
    const r1 = roseR(t1);
    const r2 = roseR(t2);
    const p1 = pol(r1, t1);
    const p2 = pol(r2, t2);
    api.entities.add('line', {
      start: p1,
      end: p2,
      style: { strokeColor: cyan, strokeWidth: 0.5, lineStyle: 'solid' },
    });
  }

  // ────────────────────────────────────────────────
  // 4. Smooth rose curve overlay (polyline segments)
  //    r = R * sin(6θ), θ from 0 → 360°
  // ────────────────────────────────────────────────
  const step = 0.5; // half-degree for smoothness
  for (let deg = 0; deg < 360; deg += step) {
    const r1 = roseR(deg);
    const r2 = roseR(deg + step);
    const p1 = pol(r1, deg);
    const p2 = pol(r2, deg + step);
    api.entities.add('line', {
      start: p1,
      end: p2,
      style: { strokeColor: magenta, strokeWidth: 1.2, lineStyle: 'solid' },
    });
  }

  // ────────────────────────────────────────────────
  // 5. Decorative outer ring (thick gold circle)
  // ────────────────────────────────────────────────
  api.entities.add('circle', {
    center: { x: cx, y: cy },
    radius: R * 1.05,
    style: { strokeColor: gold, strokeWidth: 2, lineStyle: 'solid' },
  });
  api.entities.add('circle', {
    center: { x: cx, y: cy },
    radius: R * 1.08,
    style: { strokeColor: gold, strokeWidth: 0.5, lineStyle: 'solid' },
  });

  // ────────────────────────────────────────────────
  // 6. Small circles at petal tips (12 petals for n=6)
  // ────────────────────────────────────────────────
  for (let i = 0; i < 12; i++) {
    const angle = (i * 30) + 15; // midpoints between axes
    const tipR = Math.abs(roseR(angle));
    if (tipR > R * 0.8) {
      const tip = pol(tipR, angle);
      api.entities.add('circle', {
        center: tip,
        radius: 6,
        style: { strokeColor: gold, strokeWidth: 1.5, lineStyle: 'solid' },
      });
    }
  }

  // ────────────────────────────────────────────────
  // 7. Center accent
  // ────────────────────────────────────────────────
  api.entities.add('circle', {
    center: { x: cx, y: cy },
    radius: 8,
    style: { strokeColor: white, strokeWidth: 2, lineStyle: 'solid' },
  });
  api.entities.add('circle', {
    center: { x: cx, y: cy },
    radius: 3,
    style: { strokeColor: gold, strokeWidth: 2, lineStyle: 'solid' },
  });

  // ────────────────────────────────────────────────
  // 8. Title text
  // ────────────────────────────────────────────────
  api.entities.add('text', {
    position: { x: cx, y: cy + R * 1.18 },
    text: 'Maurer Rose  n=6  d=71',
    fontSize: 18,
    fontFamily: 'Consolas',
    alignment: 'center',
    verticalAlignment: 'top',
    color: gold,
  });

  console.log('✓ Maurer Rose drawing complete');

  // Zoom to fit
  api.viewport?.zoomToFit?.();
})();
