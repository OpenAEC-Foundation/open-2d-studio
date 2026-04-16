# Canvas Runtime Performance Optimalisatie

> Datum: 2026-04-15  
> Scope: Rendering pipeline snelheidsverbeteringen zonder architectuurwijziging  
> Verwachte verbetering: 3-5× sneller canvas rendering

---

## Samenvatting

Acht gerichte optimalisaties in de canvas rendering pipeline die samen de framerate substantieel verbeteren. Geen nieuwe abstracties, geen nieuwe bestanden (behalve eventueel een cache-helper), geen wijziging in de state architectuur of component structuur.

---

## 1. Dirty-flag verfijning

**Bestand:** `src/components/canvas/Canvas.tsx` (regel ~760)

**Probleem:** `useAppStore.subscribe(() => { dirty = true })` triggert een volledige canvas re-render bij elke state-mutatie — inclusief UI dialogen, snap toggles, log entries en tool-switches die het canvas niet beïnvloeden.

**Oplossing:** Vervang de blinde subscribe door een selector-gebaseerde dirty check. Sla een snapshot op van rendering-relevante state referenties en vergelijk met `===`:

```typescript
let prevSnapshot = takeRenderSnapshot(useAppStore.getState());

const unsub = useAppStore.subscribe(() => {
  const next = takeRenderSnapshot(useAppStore.getState());
  if (!shallowEqual(prevSnapshot, next)) {
    prevSnapshot = next;
    dirty = true;
  }
});
```

**Rendering-relevante velden:**
- `shapes`, `parametricShapes` (referentie)
- `viewport` (offsetX, offsetY, zoom)
- `selectedShapeIds`, `hoveredShapeId`, `preSelectedShapeIds`
- `drawingPreview`, `selectionBox`
- `currentSnapPoint`, `currentTrackingLines`, `trackingPoint`
- `activeDrawingId`, `editorMode`
- `whiteBackground`, `gridVisible`, `gridSize`, `axesVisible`
- `layers` (referentie)
- `drawingBoundary`, `boundarySelected`, `boundaryDragging`
- `drawings` (referentie, voor scale)

**Alles overgeslagen:** UI dialog state, tool settings, IFC panel, log entries, snap configuration, hatch slice UI state, clipboard, projectInfo, unit settings, extension state.

**Vergelijking:** Shallow `===` per veld. Viewport apart: `v.offsetX === prev.offsetX && v.offsetY === prev.offsetY && v.zoom === prev.zoom`.

---

## 2. Hatch draw call batching

**Bestand:** `src/engine/renderer/core/ShapeRenderer.ts`

**Probleem:** `drawLineFamilySimple()`, `drawCustomPatternLines()` en de zigzag insulation renderer doen per lijn een apart `ctx.beginPath()` → `moveTo` → `lineTo` → `ctx.stroke()`. Een crosshatch met 40 lijnen = 80+ stroke calls. Elke `stroke()` flusht de GPU pipeline.

**Oplossing per methode:**

### drawLineFamilySimple (~3293-3323)
- Eén `ctx.beginPath()` vóór de lijn-loop
- Alle `moveTo`/`lineTo` calls in de loop
- Eén `ctx.stroke()` na de loop

### drawCustomPatternLines (~3526-3585)
- Per `LineFamily`: één `ctx.beginPath()`, alle lijnen, één `ctx.stroke()`
- strokeStyle en lineWidth per family instellen vóór beginPath

### drawInsulationZigzag (~3332-3446)
- Bovenste zigzag: één `ctx.beginPath()`, alle segmenten, één `ctx.stroke()`
- Onderste zigzag: idem
- Contour outline: al één stroke (geen wijziging nodig)

**Verwachte winst:** 50-200 stroke calls → 1-3 per hatch shape.

---

## 3. RenderCache re-activeren voor pan

**Bestanden:** `src/engine/renderer/RenderCache.ts`, `src/components/canvas/Canvas.tsx`

**Probleem:** RenderCache is uitgeschakeld. Bij elke pan worden alle shapes opnieuw getekend. De eerdere implementatie faalde omdat selectie/hover overlays niet apart getekend werden na een cache-blit.

**Oplossing:** Cache gebruiken uitsluitend voor pan-only frames. Overlays altijd vers tekenen bovenop de cached image.

### Flow per frame:

```
if (alleen pan veranderd && cache geldig) {
  1. renderCache.drawCached(ctx, viewport)  // blit verschoven image
  2. teken overlays vers:
     - snap indicator
     - tracking lines  
     - 2D cursor
     - selection box
     - selection handles (herberekend voor nieuwe viewport)
} else {
  1. volledige render (shapes, grid, boundary, alles)
  2. renderCache.capture(canvas, viewport, cacheKey)
}
```

### Cache geldigheid:
- **Geldig bij:** alleen `viewport.offsetX` of `viewport.offsetY` veranderd
- **Ongeldig bij:** zoom, shapes referentie, selectedShapeIds referentie, whiteBackground, layers, gridVisible/gridSize, drawingBoundary, hoveredShapeId, editorMode

### cacheKey:
Samengesteld uit referentie-checks:
```typescript
const cacheKey = `${shapes === prevShapes}_${selectedIds === prevSelected}_${zoom}_${whiteBackground}`;
```

### Uitschakelbaar:
Een `const PAN_CACHE_ENABLED = true;` flag bovenaan Canvas.tsx voor snelle toggle als artifacts optreden.

---

## 4. Set hergebruik per frame

**Bestand:** `src/engine/renderer/modes/DrawingRenderer.ts`

**Probleem:** Elke frame alloceert 3 nieuwe `Set<string>` objecten (~314, 391, 404) die na de frame weggegooid worden. Bij 60 FPS = 180 Sets/seconde → GC pressure.

**Oplossing:** Class-level Sets als private fields:

```typescript
private _selectedSet = new Set<string>();
private _visibleIds = new Set<string>();
private _lodPassIds = new Set<string>();
```

Begin van `render()`: `.clear()` aanroepen, dan vullen. Geen allocatie, geen GC.

De `backgroundShapes` array kan ook hergebruikt worden als class field met `.length = 0` reset.

---

## 5. Hatch LOD-drempel verhogen

**Bestand:** `src/engine/renderer/core/ShapeRenderer.ts` (~2907)

**Probleem:** `HATCH_LOD_PX = 8` is te klein. Bij 8 screen pixels is geen enkel patroon leesbaar, maar we tekenen nog steeds 200+ lijnen.

**Oplossing:** Verhogen naar `HATCH_LOD_PX = 20`.

Onder 20px schermgrootte:
- Pattern lijnen overgeslagen
- `backgroundColor` fill blijft behouden (kleur zichtbaar)
- Boundary outline blijft behouden
- Visueel: shape is een gekleurde outline, wat op die schaal precies overeenkomt met wat de gebruiker ziet

---

## 6. Progressive budget tuning

**Bestand:** `src/engine/renderer/modes/DrawingRenderer.ts` (~102, 461)

**Wijzigingen:**

| Parameter | Oud | Nieuw | Reden |
|-----------|-----|-------|-------|
| `SHAPE_RENDER_BUDGET_MS` | 12 | 14 | 2.6ms marge voor overlays + compositing |
| Check interval | elke 8 shapes (`bgIdx & 7`) | elke 16 shapes (`bgIdx & 15`) | Halveert `performance.now()` calls |

**Verwachte winst:** ~15-20% meer shapes per frame. Viewport vult merkbaar sneller bij grote tekeningen.

---

## 7. Path2D caching voor hatch boundaries

**Bestand:** `src/engine/renderer/core/ShapeRenderer.ts`

**Probleem:** `drawHatch()` bouwt de boundary path 3-5× per shape op via `buildOuterPath()` en `buildPath()`. Inclusief bulge-naar-arc berekeningen per segment.

**Oplossing:** Per hatch shape twee `Path2D` objecten cachen op de `ShapeRenderer` class:

```typescript
private _pathCache = new Map<string, {
  shapesRef: Shape[] | null;  // voor invalidatie
  outer: Path2D;
  full: Path2D;
}>();
```

### Opbouw:
```typescript
const outer = new Path2D();
// ... moveTo/lineTo/arc calls op outer ...

const full = new Path2D(outer);  // kloon outer
// ... inner loops toevoegen aan full ...
```

### Gebruik in drawHatch:
```typescript
ctx.fill(cachedFull, 'evenodd');      // background fill
ctx.clip(cachedFull);                  // pattern clip
ctx.stroke(cachedOuter);              // boundary stroke
```

### Invalidatie:
- Bij `render()` entry: als `shapes` referentie veranderd is, hele cache clearen
- Max 500 entries (overflow: clear all)
- Simpel en robuust — geen per-shape versie-tracking nodig

---

## 8. Pattern line pre-berekening

**Bestand:** `src/engine/renderer/core/ShapeRenderer.ts`

**Probleem:** `drawLineFamilySimple()` berekent elke frame: diagonal, halfDiag, numLines, en per lijn sin/cos rotatie. Voor 3 families × 20 lijnen = 60× trig per hatch per frame.

**Oplossing:** Cache van berekende lijncoördinaten per shape:

```typescript
private _lineCache = new Map<string, {
  shapesRef: Shape[] | null;
  families: Array<{
    color: string;
    lineWidth: number;
    lines: Float64Array;  // [x1,y1,x2,y2, x1,y1,x2,y2, ...]
  }>;
}>();
```

### Flow:
1. Cache key = `shapeId`
2. **Cache hit:** loop over families → `beginPath()` → batch moveTo/lineTo van Float64Array → `stroke()`
3. **Cache miss:** berekenen (bestaande logica), opslaan, tekenen

### Gecombineerd met optimalisatie 2 (batching):
Cache hit + batching = maximale snelheid: één `beginPath()` + directe array loop + één `stroke()` per family. Geen trig, geen allocatie.

### Invalidatie:
Zelfde als sectie 7 — shapes referentie wijziging → clear all.

### Geheugen:
~1KB per hatch (20 lijnen × 4 doubles × 8 bytes = 640 bytes + overhead). 500 hatches = 500KB. Verwaarloosbaar.

---

## Implementatievolgorde

1. **Set hergebruik** (5 min, nul risico, onmiddellijk effect)
2. **Hatch LOD-drempel** (1 min, nul risico)
3. **Progressive budget tuning** (1 min, nul risico)
4. **Dirty-flag verfijning** (30 min, laag risico, groot effect)
5. **Hatch batching** (45 min, nul risico, groot effect)
6. **Path2D caching** (30 min, laag risico)
7. **Pattern line pre-berekening** (45 min, laag risico)
8. **RenderCache pan** (60 min, medium risico, feature flag)

**Totaal geschatte tijd:** ~3.5 uur

---

## Wat NIET verandert

- Geen nieuwe bestanden (behalve eventueel een `PathCache.ts` helper)
- Geen wijziging in state architectuur (Zustand/Immer)
- Geen wijziging in component structuur (React)
- Geen wijziging in de QuadTree of progressive rendering strategie
- Geen wijziging in het rendering pipeline (DrawingRenderer → ShapeRenderer flow)
- Geen nieuwe dependencies

---

## Meetstrategie

Bestaande `FrameBudget` class meet al FPS in de StatusBar. Na elke optimalisatie:
1. Open een tekening met 500+ shapes waarvan 20+ hatches
2. Pan/zoom en noteer FPS
3. Vergelijk met baseline (huidige FPS)

Doel: van ~20-30 FPS naar stabiele 55-60 FPS bij 500+ shapes met hatches.
