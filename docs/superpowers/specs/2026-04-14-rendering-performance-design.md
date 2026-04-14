# Rendering Kernel Performance Optimalisatie — Design Specification

**Date:** 2026-04-14
**Status:** Draft
**Author:** Rick + Claude

## 1. Overview

De rendering kernel van Open 2D Studio wordt geoptimaliseerd om 40MB DWG-bestanden met grote coördinaten (1000km extent) te ondersteunen bij 120fps. De optimalisaties zijn incrementeel en backwards compatible — elke stap is onafhankelijk deploybaar zonder bestaande functionaliteit te breken.

### Doelen

- 100k+ shapes op het canvas zonder merkbare vertraging
- 1000km coördinaat-extent zonder jitter of precisieverlies
- 120fps op moderne hardware
- Pan/zoom blijft vloeiend bij grote tekeningen
- Alle bestaande tools, selectie, snap, export etc. blijven identiek werken

### Design Principes

- Incrementeel: elke stap is een losstaande verbetering
- Backwards compatible: geen API-wijzigingen, geen gedragsverandering
- Meetbaar: elke stap wordt gevalideerd met performance benchmarks
- Geen externe dependencies: puur interne optimalisaties

## 2. Huidige Bottlenecks

| Probleem | Impact | Locatie |
|---|---|---|
| Geen viewport culling | ALLE shapes 5× geïtereerd per frame | `DrawingRenderer.ts:287-339` |
| Multi-pass O(N×5) rendering | 500k iteraties bij 100k shapes | `DrawingRenderer.ts:287-339` |
| Float32 precisieverlies | Jitter bij grote coördinaten | `BaseRenderer.ts:57-62` |
| Geen LOD | Microscopische shapes gerenderd | `ShapeRenderer.ts` |
| RAF max 60Hz | Kapt af op 60fps | `Canvas.tsx:688-850` |
| Geen render cache | Statische shapes elke frame opnieuw | Geen offscreen buffer |

## 3. Optimalisatie Stappen

### 3.1 Viewport Culling via QuadTree

**Doel:** Alleen shapes renderen die zichtbaar zijn in het huidige viewport.

**Implementatie:**
1. Voeg `queryBounds(bbox: BoundingBox): QuadTreeEntry[]` toe aan `QuadTree.ts`
2. In `DrawingRenderer.render()`:
   - Bereken zichtbare wereldcoördinaten uit viewport (offsetX, offsetY, zoom, canvas grootte)
   - Query de QuadTree met de zichtbare bounds
   - Filter `shapes` array tot alleen zichtbare shapes
   - Geef de gefilterde lijst door aan de render passes

**Bestanden:**
- Modify: `src/engine/spatial/QuadTree.ts` — voeg `queryBounds()` toe
- Modify: `src/engine/renderer/modes/DrawingRenderer.ts` — viewport culling voor render loop
- Modify: `src/components/canvas/Canvas.tsx` — QuadTree doorgeven aan renderer

**Geschatte impact:** 50-70% sneller bij ingezoomde weergave.

**Backwards compatible:** Ja — shapes buiten beeld werden nooit zichtbaar getekend.

### 3.2 Level of Detail (LOD) Culling

**Doel:** Bij ver uitgezoomd, shapes skippen die kleiner zijn dan een paar pixels op scherm.

**Implementatie:**
1. Per shape: bereken screen-size = `max(boundsWidth, boundsHeight) × zoom`
2. Als `screenSize < minPixelThreshold` → skip rendering
3. Thresholds:
   - Shapes (lijnen, polylines): skip als < 2px op scherm
   - Tekst: skip als berekende teksthoogte < 3px
   - Arceringen: skip als gevuld gebied < 4px²
   - Punten: altijd renderen (ze zijn al klein)
4. Threshold configureerbaar via settings (default: 2px)

**Bestanden:**
- Modify: `src/engine/renderer/modes/DrawingRenderer.ts` — LOD check in render loop
- Modify: `src/engine/spatial/QuadTree.ts` — bounds beschikbaar in QuadTreeEntry

**Geschatte impact:** 80-90% reductie bij volledig uitgezoomde weergave op grote tekeningen.

**Backwards compatible:** Ja — shapes verschijnen weer bij inzoomen.

### 3.3 Single-Pass Rendering

**Doel:** De 5 aparte for-loops samenvoegen tot 1 loop.

**Implementatie:**
1. Definieer render-prioriteit per shape type:
   - 0: image underlays
   - 1: slabs
   - 2: AEC shapes (walls, beams, columns, etc.)
   - 3: 2D shapes (lines, polylines, circles, etc.)
   - 4: text
   - 5: gridlines
2. Sorteer shapes eenmaal op prioriteit (stabiele sort → behoud volgorde binnen categorie)
3. Cache de gesorteerde volgorde; invalidate bij shape add/remove/type change
4. Eén for-loop door de gesorteerde + gecullde lijst

**Bestanden:**
- Modify: `src/engine/renderer/modes/DrawingRenderer.ts` — vervang 5 loops door 1
- Create: `src/engine/renderer/RenderSorter.ts` — sorteer + cache logica

**Geschatte impact:** 10-15% sneller door betere cache-locality en minder iteraties.

### 3.4 Camera Matrix voor Grote Coördinaten

**Doel:** Float32 precisieverlies voorkomen bij coördinaten > 10⁶.

**Probleem:** Canvas 2D gebruikt intern 32-bit floats voor transformaties. Bij RD-coördinaten (bijv. x=155000, y=463000) en zoom-levels resulteert dit in subpixel jitter.

**Implementatie:**
1. Bereken een `cameraCenter: Point` = centrum van het viewport in wereldcoördinaten
2. In de render loop: trek `cameraCenter` af van alle shape-coördinaten VOORDAT ze naar de Canvas context gaan
3. De Canvas `ctx.translate()` gebruikt alleen de kleine offset (viewport positie relatief t.o.v. camera)
4. Bij pan: update `cameraCenter`, niet de canvas translate
5. Shape-coördinaten in de store blijven ongewijzigd (grote waarden) — alleen de rendering past aan

**Formule:**
```
screenX = (worldX - cameraCenter.x) × zoom + canvasWidth/2
screenY = (worldY - cameraCenter.y) × zoom + canvasHeight/2
```

**Bestanden:**
- Modify: `src/engine/renderer/core/BaseRenderer.ts` — camera matrix logica
- Modify: `src/engine/renderer/modes/DrawingRenderer.ts` — camera center berekening
- Modify: `src/engine/renderer/core/ShapeRenderer.ts` — coördinaten offset

**Geschatte impact:** Correctheid — elimineert jitter bij grote coördinaten.

### 3.5 Render Throttling & Frame Budgeting

**Doel:** Vloeiende interactie bij complexe tekeningen, target 120fps.

**Implementatie:**
1. Meet frame-time per render cyclus
2. Als frame > 8ms (120fps budget):
   - Splits shapes in batches
   - Render eerste batch (voorgrond + geselecteerde shapes) dit frame
   - Render achtergrond-batches in volgende frames
3. Progressive rendering:
   - Prioriteit 1: geselecteerde shapes + cursor + snap indicators
   - Prioriteit 2: shapes in het centrum van het viewport
   - Prioriteit 3: shapes aan de randen
4. Op 120Hz displays: RAF levert automatisch 120fps als frames < 8ms
5. Dirty-flag optimalisatie: als niets veranderd is → skip render volledig

**Bestanden:**
- Modify: `src/components/canvas/Canvas.tsx` — frame budgeting in RAF loop
- Create: `src/engine/renderer/FrameBudget.ts` — frame timing + batch management

**Geschatte impact:** Vloeiende 120fps interactie zelfs bij complexe scenes.

### 3.6 OffscreenCanvas Render Cache

**Doel:** Pan/zoom O(1) maken door statische shapes te cachen.

**Implementatie:**
1. Onderscheid statische shapes (niet geselecteerd, niet in edit) en dynamische (selectie, preview, cursor, snap)
2. Render alle statische shapes naar een OffscreenCanvas buffer (groter dan viewport: 2× in elke richting)
3. Bij pan: verschuif de buffer, render alleen nieuw zichtbare randen ("tile scrolling")
4. Bij zoom: invalidate de hele buffer, herrender
5. Bij shape-wijziging: invalidate alleen de betreffende regio van de buffer
6. Compositing: teken buffer op hoofdcanvas, daarna dynamische shapes eroverheen

**Bestanden:**
- Create: `src/engine/renderer/RenderCache.ts` — OffscreenCanvas buffer management
- Modify: `src/engine/renderer/modes/DrawingRenderer.ts` — cache integratie
- Modify: `src/components/canvas/Canvas.tsx` — compositing

**Geschatte impact:** Pan wordt O(1) i.p.v. O(N). Enorme verbetering voor grote tekeningen.

## 4. Implementatie Volgorde

| Stap | Prioriteit | Impact | Complexiteit | Risico |
|---|---|---|---|---|
| 3.1 Viewport Culling | Hoogst | 50-70% | Laag | Nul |
| 3.2 LOD Culling | Hoog | 80-90% (uitgezoomd) | Laag | Nul |
| 3.3 Single-Pass | Medium | 10-15% | Laag | Nul |
| 3.4 Camera Matrix | Hoog | Correctheid | Medium | Laag |
| 3.5 Frame Budgeting | Medium | Vloeiendheid | Medium | Laag |
| 3.6 Render Cache | Hoog | O(1) pan | Hoog | Medium |

Elke stap wordt gevalideerd met een performance benchmark voordat de volgende begint.

## 5. Performance Benchmarks

Na elke stap meten we:

| Metric | Target | Meetmethode |
|---|---|---|
| Frame time (1k shapes) | < 2ms | `performance.now()` in render loop |
| Frame time (10k shapes) | < 4ms | idem |
| Frame time (100k shapes) | < 8ms | idem |
| Pan/zoom FPS (100k shapes) | ≥ 120fps | Frame counter |
| Zoom jitter (RD coördinaten) | 0px | Visuele inspectie bij extreme zoom |
| Memory usage (100k shapes) | < 500MB | DevTools heap snapshot |
| QuadTree build time (100k) | < 50ms | `performance.now()` |
| DWG import time (40MB) | < 10s | Timer |

## 6. Bestanden Overzicht

### Nieuwe bestanden

| Bestand | Doel |
|---|---|
| `src/engine/renderer/RenderSorter.ts` | Shape sorteer + cache per render-prioriteit |
| `src/engine/renderer/FrameBudget.ts` | Frame timing + batch management |
| `src/engine/renderer/RenderCache.ts` | OffscreenCanvas buffer + tile scrolling |

### Gewijzigde bestanden

| Bestand | Wijziging |
|---|---|
| `src/engine/spatial/QuadTree.ts` | `queryBounds()` methode, bounds in entries |
| `src/engine/renderer/modes/DrawingRenderer.ts` | Viewport culling, LOD, single-pass, cache integratie |
| `src/engine/renderer/core/BaseRenderer.ts` | Camera matrix |
| `src/engine/renderer/core/ShapeRenderer.ts` | Coördinaten offset voor camera |
| `src/components/canvas/Canvas.tsx` | Frame budgeting, QuadTree doorgeven, compositing |
