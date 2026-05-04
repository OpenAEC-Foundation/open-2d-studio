// Extract computed styles from key 1.0 chrome elements.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const outDir = path.resolve(__dirname, '..', 'docs', 'superpowers', 'plans', 'artefacts');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto('https://open-2d-studio.open-aec.com/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(4000);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);

  const data = await page.evaluate(() => {
    const dump = (el, depth = 0) => {
      if (!el || depth > 4) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        cls: el.className && typeof el.className === 'string' ? el.className.slice(0, 80) : '',
        id: el.id || '',
        text: (el.textContent || '').slice(0, 40).replace(/\s+/g, ' ').trim(),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        bg: cs.backgroundColor,
        color: cs.color,
        fontSize: cs.fontSize,
        fontFamily: cs.fontFamily.slice(0, 60),
        fontWeight: cs.fontWeight,
        padding: cs.padding,
        margin: cs.margin,
        border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
        borderRadius: cs.borderRadius,
      };
    };
    const out = { rootTheme: document.body.getAttribute('data-theme'), rootCs: dump(document.body) };
    out.children = [];
    // walk top 3 layers
    const collect = (root, depth = 0) => {
      if (!root || depth > 6) return;
      const r = root.getBoundingClientRect();
      if (r.height > 0 && r.height < 200 && r.width > 80) {
        out.children.push({ depth, ...dump(root, depth) });
      }
      for (const c of root.children) collect(c, depth + 1);
    };
    collect(document.body);
    return out;
  });

  const outPath = path.join(outDir, 'ref-1.0-styles.json');
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log('Saved', outPath, '— top items', data.children.length);

  // Print top 20 small chrome elements
  const sorted = data.children
    .filter(c => c && c.rect && c.rect.h <= 100 && c.rect.w >= 200)
    .sort((a, b) => a.rect.y - b.rect.y);
  console.log('\nTop chrome elements (sorted by y):');
  for (const c of sorted.slice(0, 80)) {
    console.log(`  d${c.depth} y=${c.rect.y.toString().padStart(4)} h=${c.rect.h.toString().padStart(3)} bg=${c.bg.padEnd(20)} fs=${c.fontSize.padEnd(5)} ${c.cls.slice(0, 50)} | "${c.text}"`);
  }

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
