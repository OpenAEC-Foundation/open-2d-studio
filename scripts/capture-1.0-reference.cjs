// Capture reference screenshots from the live 1.0 web UI.
// Saves to docs/superpowers/plans/artefacts/ref-1.0-*.png
// Usage: node scripts/capture-1.0-reference.js [round]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const round = process.argv[2] || '01';
  const outDir = path.resolve(__dirname, '..', 'docs', 'superpowers', 'plans', 'artefacts');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  console.log('Navigating to https://open-2d-studio.open-aec.com/ ...');
  await page.goto('https://open-2d-studio.open-aec.com/', { waitUntil: 'networkidle', timeout: 60000 });
  // Give the React app + WASM modules a moment to settle.
  await page.waitForTimeout(4000);

  // Try to dismiss any startup dialogs by pressing Escape.
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);

  // Full viewport screenshot.
  const fullPath = path.join(outDir, `ref-1.0-full.png`);
  await page.screenshot({ path: fullPath, fullPage: false });
  console.log('Saved', fullPath);

  // Element-targeted captures using selectors derived from React source.
  // TitleBar, Ribbon, FileTabBar, StatusBar all have stable test ids or class hooks.
  async function captureElement(selector, name) {
    try {
      const el = await page.$(selector);
      if (!el) {
        console.warn(`  selector not found: ${selector}`);
        return;
      }
      const box = await el.boundingBox();
      if (!box) return;
      const p = path.join(outDir, `ref-1.0-${name}.png`);
      await page.screenshot({ path: p, clip: box });
      console.log(`  ${name}: ${Math.round(box.width)}x${Math.round(box.height)} @ (${Math.round(box.x)},${Math.round(box.y)})`);
    } catch (e) {
      console.warn(`  failed ${name}:`, e.message);
    }
  }

  // Element-by-element captures. Selectors based on React component DOM.
  await captureElement('[data-testid="title-bar"], header.title-bar, .titlebar', 'titlebar');
  await captureElement('[data-testid="ribbon"], .ribbon, [class*="Ribbon_ribbon"]', 'ribbon');
  await captureElement('[data-testid="file-tab-bar"], .file-tab-bar', 'tabbar');
  await captureElement('[data-testid="status-bar"], .status-bar, footer', 'statusbar');

  // Region-based fallback captures (in case selectors miss).
  const regions = [
    { name: 'region-titlebar', clip: { x: 0, y: 0, width: 1920, height: 50 } },
    { name: 'region-ribbon',   clip: { x: 0, y: 32, width: 1920, height: 130 } },
    { name: 'region-tabbar',   clip: { x: 0, y: 162, width: 1920, height: 35 } },
    { name: 'region-statusbar',clip: { x: 0, y: 1200 - 24, width: 1920, height: 24 } },
    { name: 'region-top160',   clip: { x: 0, y: 0, width: 1920, height: 160 } },
  ];
  for (const r of regions) {
    const p = path.join(outDir, `ref-1.0-${r.name}.png`);
    await page.screenshot({ path: p, clip: r.clip });
    console.log(`  region ${r.name}: ${r.clip.width}x${r.clip.height}`);
  }

  // Also dump some computed styles to a json for spec extraction.
  const computed = await page.evaluate(() => {
    function pick(sel) {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        sel,
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        bg: cs.backgroundColor, color: cs.color, border: cs.border,
        font: cs.font, padding: cs.padding, gap: cs.gap,
        height: cs.height, width: cs.width,
      };
    }
    const root = document.body;
    const rootCs = getComputedStyle(root);
    return {
      themeAttr: root.getAttribute('data-theme'),
      bodyBg: rootCs.backgroundColor,
      bodyColor: rootCs.color,
      bodyFont: rootCs.font,
      titlebar: pick('[data-testid="title-bar"], header.title-bar, .titlebar, header'),
      ribbon: pick('[data-testid="ribbon"], .ribbon, [class*="Ribbon_ribbon"]'),
      ribbonTabs: pick('[data-testid="ribbon-tabs"], .ribbon-tabs'),
      tabbar: pick('[data-testid="file-tab-bar"], .file-tab-bar'),
      statusbar: pick('[data-testid="status-bar"], .status-bar, footer'),
    };
  });
  fs.writeFileSync(path.join(outDir, `ref-1.0-computed.json`), JSON.stringify(computed, null, 2));
  console.log('Saved ref-1.0-computed.json');

  await browser.close();
  console.log('Done.');
})().catch(e => { console.error(e); process.exit(1); });
