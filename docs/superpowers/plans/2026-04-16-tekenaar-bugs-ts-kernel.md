# Tekenaar Bugs — TypeScript Kernel Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** De 4 concrete pijnpunten die de Tekenaar in het parlement benoemde oplossen in de huidige TypeScript kernel (`master` branch), zodat huidige gebruikers meteen vooruit kunnen terwijl de Rust-kernel-spike loopt.

**Architecture:** Kleine, gerichte fixes in de bestaande TS codebase. Geen refactoring. Elke bug krijgt één task met één commit.

**Tech Stack:** TypeScript 5.7 + Zustand + Immer (bestaand).

**Branch:** `master` (niet `native-kernel-rust` — dit is de shipping branch).

---

## De vier pijnpunten

Uit het parlement, expliciet door de Tekenaar genoemd:

1. **Undo-stack bevat camera-acties** — gebruiker doet ctrl+Z en viewport springt terug terwijl de shape niet verandert
2. **Block-instance copy/paste verliest layer-override** — 40 wapeningsstempels worden zwart ipv rood
3. **Hatch pattern scaling werkt niet consistent tussen 1:50 en 1:100** — patronen worden zwart bij schaal-switch
4. **Snap bij overlappende lijnen** — geen Tab-cycle om tussen kandidaten te wisselen (zoals AutoCAD)

---

## File Structure (te inspecteren/aanpassen)

```
src/
├── state/
│   ├── slices/
│   │   ├── historySlice.ts          # Bug 1: undo stack
│   │   └── viewSlice.ts             # Bug 1: is zoom/pan history?
│   ├── documentStore.ts             # Bug 1: middleware die camera uitsluit
│   └── appStore.ts                  # Bug 2: clipboard actions
├── services/
│   └── drawing/
│       └── clipboardService.ts      # Bug 2: copy/paste voor block-instances
├── engine/
│   ├── renderer/
│   │   └── core/
│   │       └── ShapeRenderer.ts     # Bug 3: hatch pattern scaling
│   └── geometry/
│       └── SnapUtils.ts             # Bug 4: snap candidate cycling
└── hooks/
    └── snap/
        └── useSnapDetection.ts      # Bug 4: Tab key binding
```

---

## Task 1: Undo-stack excludeert camera-acties

**Probleem:** De huidige Immer-patches registreren alle state changes, inclusief viewport updates (pan, zoom). Ctrl+Z springt terug door camera-state.

**Verwachte fix:** Filter camera-gerelateerde paths uit de Immer patches voordat ze naar de history stack gaan.

**Files:**
- Inspecteer: `src/state/slices/historySlice.ts`
- Inspecteer: `src/state/documentStore.ts` (voor Immer enablePatches config)
- Mogelijk wijzigen: één van bovenstaande

- [ ] **Step 1.1: Lokaliseer huidige history-tracking**

Run: `grep -rn "produceWithPatches\|applyPatches\|history" src/state/ | head -30`
Verwacht: bestanden die Immer patches gebruiken voor undo/redo.

- [ ] **Step 1.2: Schrijf failing test**

Create `src/state/slices/__tests__/history-excludes-camera.test.ts`:

```ts
import { useAppStore } from '../../appStore';

describe('history excludes camera actions', () => {
  beforeEach(() => {
    useAppStore.setState((s) => ({
      ...s,
      shapes: [],
      history: { past: [], future: [] },
      viewport: { offsetX: 0, offsetY: 0, zoom: 1, rotation: 0 },
    }));
  });

  it('viewport pan does not push to history', () => {
    const store = useAppStore.getState();
    const histLenBefore = store.history.past.length;
    store.setViewport({ offsetX: 100, offsetY: 50 });
    const histLenAfter = useAppStore.getState().history.past.length;
    expect(histLenAfter).toBe(histLenBefore);
  });

  it('viewport zoom does not push to history', () => {
    const store = useAppStore.getState();
    const histLenBefore = store.history.past.length;
    store.zoomIn();
    const histLenAfter = useAppStore.getState().history.past.length;
    expect(histLenAfter).toBe(histLenBefore);
  });

  it('shape add DOES push to history', () => {
    const store = useAppStore.getState();
    const histLenBefore = store.history.past.length;
    store.addShape({ id: 'test-1', type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 10 }, layerId: 'default', drawingId: 'd1', visible: true, locked: false, style: { strokeColor: '#fff', strokeWidth: 1, lineStyle: 'solid' } } as any);
    const histLenAfter = useAppStore.getState().history.past.length;
    expect(histLenAfter).toBe(histLenBefore + 1);
  });
});
```

- [ ] **Step 1.3: Run test (must fail)**

Run: `npm run test -- history-excludes-camera`
Expected: tests fail because viewport updates currently push to history.

- [ ] **Step 1.4: Implement patch filter**

Edit het bestand dat Immer patches naar history stuurt. Voeg een filter toe die patches waarvan `path[0]` in `['viewport', 'canvasSize', 'mousePosition', 'cursor2D']` zit, NIET opneemt in de history push.

Pseudo-locatie (moet in werkelijkheid exact gezocht worden):

```ts
// In historySlice.ts of documentStore.ts middleware
const CAMERA_PATHS = new Set(['viewport', 'canvasSize', 'mousePosition', 'cursor2D', 'cursor2DVisible']);

function filterCameraPatches(patches: Patch[]): Patch[] {
  return patches.filter((p) => !CAMERA_PATHS.has(String(p.path[0])));
}

// Waar patches nu naar history.past worden gepushed:
const filtered = filterCameraPatches(patches);
if (filtered.length > 0) {
  state.history.past.push({ patches: filtered, inverse: filterCameraPatches(inversePatches) });
  state.history.future = [];
}
```

- [ ] **Step 1.5: Run test (must pass)**

Run: `npm run test -- history-excludes-camera`
Expected: 3 tests pass.

- [ ] **Step 1.6: Manual test**

Start `npm run tauri dev`, open een tekening, doe:
1. Teken 1 lijn → ctrl+Z → lijn verdwijnt ✓
2. Zoom in 5× → pan rond → ctrl+Z → zoom/pan NIET veranderd, lijn blijft weg ✓
3. Teken nog een lijn → ctrl+Z → alleen de 2de lijn weg, viewport ongewijzigd ✓

- [ ] **Step 1.7: Commit**

```bash
git checkout master
git add src/state/slices/__tests__/history-excludes-camera.test.ts src/state/
git commit -m "fix(history): exclude camera actions from undo stack

Viewport pan/zoom/cursor updates no longer appear in ctrl+Z history.
Tekenaar bug #1: undo now only reverses geometry changes.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Block-instance copy/paste preserveert layer-override

**Probleem:** Copy/paste van een block-instance shape verliest eventuele per-instance layer override. 40 wapeningsstempels worden zwart ipv rood.

**Files:**
- Inspecteer: `src/services/drawing/clipboardService.ts`
- Inspecteer: `src/types/geometry.ts` — BlockInstanceShape type
- Mogelijk wijzigen: clipboardService

- [ ] **Step 2.1: Lokaliseer de bug**

Run: `grep -rn "block-instance\|BlockInstance\|copyShapes\|pasteShapes" src/services/drawing/ src/types/ | head -20`

- [ ] **Step 2.2: Schrijf failing test**

Create `src/services/drawing/__tests__/clipboard-block-instance.test.ts`:

```ts
import { useAppStore } from '../../../state/appStore';
import type { BlockInstanceShape } from '../../../types/geometry';

describe('clipboard preserves block-instance layer override', () => {
  it('copies and pastes a block-instance with its layerId', () => {
    const store = useAppStore.getState();
    const original: BlockInstanceShape = {
      id: 'bi-1',
      type: 'block-instance',
      blockDefinitionId: 'def-rebar',
      position: { x: 100, y: 100 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      layerId: 'layer-rebar-red',
      drawingId: 'd1',
      visible: true,
      locked: false,
      style: { strokeColor: '#FF0000', strokeWidth: 1, lineStyle: 'solid' },
    } as any;

    store.addShape(original);
    store.setSelectedShapeIds([original.id]);
    store.copySelectedShapes();
    store.pasteShapes({ x: 200, y: 200 });

    const pasted = useAppStore.getState().shapes.find((s) =>
      s.id !== original.id && s.type === 'block-instance'
    ) as BlockInstanceShape | undefined;

    expect(pasted).toBeDefined();
    expect(pasted!.layerId).toBe('layer-rebar-red');
    expect(pasted!.style.strokeColor).toBe('#FF0000');
  });
});
```

- [ ] **Step 2.3: Run test (must fail)**

Run: `npm run test -- clipboard-block-instance`
Expected: fails because pasted shape has default layerId.

- [ ] **Step 2.4: Fix de bug**

In `clipboardService.ts` (of waar paste gebeurt), zorg dat `layerId` en `style` meekopieerd worden. Vervang:

```ts
// Bug: strip layerId tijdens paste omdat er een default genomen wordt
const pasted = { ...original, id: generateId(), position: newPos };
```

met:

```ts
// Fix: expliciet layerId en style behouden, alleen id en position vernieuwen
const pasted = {
  ...original,
  id: generateId(),
  position: newPos,
  // Behoud layerId en style expliciet (defensief)
  layerId: original.layerId,
  style: { ...original.style },
};
```

- [ ] **Step 2.5: Run test (must pass)**

Run: `npm run test -- clipboard-block-instance`
Expected: test passes.

- [ ] **Step 2.6: Manual test**

Open tekening met 40 wapeningsstempels op een rode laag. Selecteer er 1. Kopieer met ctrl+C. Plak met ctrl+V. Nieuwe instance moet ook rood zijn.

- [ ] **Step 2.7: Commit**

```bash
git add src/services/drawing/
git commit -m "fix(clipboard): preserve layer + style on block-instance paste

Tekenaar bug #2: pasted block-instances retain their original layer
override instead of reverting to default (which rendered black).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Hatch pattern scaling consistent tussen 1:50 en 1:100

**Probleem:** Hatch patronen worden zwart bij omschakelen van 1:50 naar 1:100 omdat de pattern scale niet correct meeschaalt.

**Files:**
- Inspecteer: `src/engine/renderer/core/ShapeRenderer.ts` (drawHatch, renderPatternLayer)
- Inspecteer: hoe `drawingScale` doorgegeven wordt
- Mogelijk wijzigen: pattern line spacing berekening

- [ ] **Step 3.1: Reproduceer de bug**

Stap voor stap in huidige tool:
1. Open tekening met hatch in 1:50 — correct zichtbaar
2. Wijzig drawing scale naar 1:100 — hatch wordt zwart (lijnen te dicht op elkaar)
3. Herzoom naar vullend — blijft zwart

- [ ] **Step 3.2: Lokaliseer scaling code**

Run: `grep -n "patternScale\|drawingScale.*pattern\|hatch.*scale" src/engine/renderer/core/ShapeRenderer.ts`
Output: regelnummers waar pattern scaling plaatsvindt.

- [ ] **Step 3.3: Schrijf failing unit test**

Create `src/engine/renderer/core/__tests__/hatch-scaling.test.ts`:

```ts
import { computeEffectivePatternSpacing } from '../ShapeRenderer';

describe('hatch pattern scaling', () => {
  it('effective spacing at 1:50 is 2x the spacing at 1:100', () => {
    const basePatternSpacing = 500; // mm in world units
    const spacing50 = computeEffectivePatternSpacing(basePatternSpacing, 0.02 /* 1:50 */);
    const spacing100 = computeEffectivePatternSpacing(basePatternSpacing, 0.01 /* 1:100 */);
    expect(spacing50 / spacing100).toBeCloseTo(2.0, 2);
  });

  it('does not collapse to zero for very large scales', () => {
    const spacing = computeEffectivePatternSpacing(500, 1.0 /* 1:1 */);
    expect(spacing).toBeGreaterThan(1.0); // minimum 1mm in world
  });

  it('has a minimum floor for readability', () => {
    const spacing = computeEffectivePatternSpacing(10, 0.001 /* 1:1000 */);
    expect(spacing).toBeGreaterThan(0.001); // clamp to avoid black-out
  });
});
```

- [ ] **Step 3.4: Run test (must fail)**

Run: `npm run test -- hatch-scaling`
Expected: fails because function either doesn't exist or doesn't clamp correctly.

- [ ] **Step 3.5: Extract + implement pure function**

In `ShapeRenderer.ts`, extract en export:

```ts
/**
 * Effective hatch pattern line spacing at given drawing scale.
 * At reference scale (1:100 = 0.01), returns basePatternSpacing unchanged.
 * At larger scales, spacing grows proportionally so dashes stay readable on paper.
 * Clamps to a minimum to avoid black-out at very small drawing scales.
 */
export function computeEffectivePatternSpacing(
  basePatternSpacing: number,
  drawingScale: number,
): number {
  const REFERENCE_SCALE = 0.01; // 1:100
  const MIN_WORLD_SPACING = 0.1; // 0.1 mm world absolute floor
  const scaled = basePatternSpacing * (drawingScale / REFERENCE_SCALE);
  return Math.max(scaled, MIN_WORLD_SPACING);
}
```

Update alle call sites in `ShapeRenderer.ts` die `patternSpacing * someScaleFactor` doen om `computeEffectivePatternSpacing()` te gebruiken.

- [ ] **Step 3.6: Run test (must pass)**

Run: `npm run test -- hatch-scaling`
Expected: 3 tests pass.

- [ ] **Step 3.7: Manual test**

Open tekening met hatch op 1:50. Wissel naar 1:100 via de schaal-selector — hatch blijft nu leesbaar (lijnen herschalen correct). Wissel naar 1:500 — nog steeds leesbaar, niet zwart.

- [ ] **Step 3.8: Commit**

```bash
git add src/engine/renderer/core/
git commit -m "fix(hatch): consistent pattern scaling across drawing scales

Tekenaar bug #3: hatches no longer render black when switching from
1:50 to 1:100. Extracts computeEffectivePatternSpacing() with minimum
clamp to prevent pattern collapse at extreme scales.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Snap Tab-cycle bij overlappende lijnen

**Probleem:** Als er meerdere snap-kandidaten op dezelfde positie zijn, pakt snap altijd de eerste. AutoCAD ondersteunt Tab om door kandidaten te cyclen.

**Files:**
- Inspecteer: `src/engine/geometry/SnapUtils.ts`
- Inspecteer: `src/hooks/snap/useSnapDetection.ts`
- Inspecteer: `src/hooks/keyboard/useKeyboardShortcuts.ts` voor Tab binding

- [ ] **Step 4.1: Lokaliseer snap detection**

Run: `grep -rn "snapPoint\|findSnapCandidates" src/engine/geometry/ src/hooks/snap/ | head -20`

- [ ] **Step 4.2: Schrijf failing test**

Create `src/engine/geometry/__tests__/snap-tab-cycle.test.ts`:

```ts
import { findSnapCandidates, selectCandidateByIndex } from '../SnapUtils';

describe('snap tab cycling', () => {
  it('returns all candidates within tolerance', () => {
    const shapes = [
      { id: 's1', type: 'line', start: {x: 0, y: 0}, end: {x: 100, y: 100} },
      { id: 's2', type: 'line', start: {x: 0, y: 0}, end: {x: 100, y: 0} },
      { id: 's3', type: 'line', start: {x: 50, y: 50}, end: {x: 100, y: 0} },
    ] as any[];
    // Point at (0, 0) is near s1.start and s2.start
    const cands = findSnapCandidates({ x: 0.1, y: 0.1 }, shapes, 5);
    expect(cands.length).toBeGreaterThanOrEqual(2);
  });

  it('selectCandidateByIndex wraps around', () => {
    const cands = [
      { point: { x: 0, y: 0 }, type: 'endpoint', shapeId: 's1' },
      { point: { x: 0, y: 0 }, type: 'endpoint', shapeId: 's2' },
      { point: { x: 0, y: 0 }, type: 'endpoint', shapeId: 's3' },
    ] as any[];
    expect(selectCandidateByIndex(cands, 0).shapeId).toBe('s1');
    expect(selectCandidateByIndex(cands, 1).shapeId).toBe('s2');
    expect(selectCandidateByIndex(cands, 2).shapeId).toBe('s3');
    expect(selectCandidateByIndex(cands, 3).shapeId).toBe('s1'); // wrap
  });
});
```

- [ ] **Step 4.3: Run test (must fail)**

Run: `npm run test -- snap-tab-cycle`
Expected: fails.

- [ ] **Step 4.4: Implement candidate list + selection**

In `SnapUtils.ts`:

```ts
export interface SnapCandidate {
  point: Point;
  type: SnapType;
  shapeId: string;
  distance: number;
}

/**
 * Collect ALL snap candidates within tolerance, sorted by distance.
 * Used for Tab-cycling through overlapping candidates.
 */
export function findSnapCandidates(
  worldPos: Point,
  shapes: Shape[],
  tolerance: number,
): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  for (const shape of shapes) {
    if (!shape.visible || shape.locked) continue;
    const points = getSnapPointsForShape(shape); // existing function
    for (const p of points) {
      const d = Math.hypot(p.point.x - worldPos.x, p.point.y - worldPos.y);
      if (d <= tolerance) {
        out.push({ ...p, shapeId: shape.id, distance: d });
      }
    }
  }
  out.sort((a, b) => a.distance - b.distance);
  return out;
}

/**
 * Select a specific candidate from the list, wrapping around via modulo.
 */
export function selectCandidateByIndex(
  cands: SnapCandidate[],
  index: number,
): SnapCandidate | null {
  if (cands.length === 0) return null;
  return cands[((index % cands.length) + cands.length) % cands.length];
}
```

- [ ] **Step 4.5: Wire up Tab in hook**

In `src/hooks/snap/useSnapDetection.ts`, voeg toe:

```ts
const [candidates, setCandidates] = useState<SnapCandidate[]>([]);
const [cycleIdx, setCycleIdx] = useState(0);

// Bij snap-point berekening:
const cands = findSnapCandidates(worldPos, shapes, tolerance);
setCandidates(cands);
// Gebruik cycleIdx om te selecteren
const chosen = selectCandidateByIndex(cands, cycleIdx);

// Tab handler:
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Tab' && candidates.length > 1) {
      e.preventDefault();
      setCycleIdx((i) => i + 1);
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [candidates.length]);

// Reset cycleIdx zodra muis significant beweegt (nieuwe locatie = nieuwe candidates)
useEffect(() => { setCycleIdx(0); }, [worldPos.x, worldPos.y]);
```

- [ ] **Step 4.6: Run test (must pass)**

Run: `npm run test -- snap-tab-cycle`
Expected: 2 tests pass.

- [ ] **Step 4.7: Manual test**

Open tekening. Teken 3 lijnen die allemaal in (0, 0) beginnen. Tool = line, zweef muis over (0, 0). Zie snap indicator op eerste shape. Druk Tab — snap indicator switcht naar tweede shape. Nog Tab — derde shape. Nog Tab — wrap naar eerste.

- [ ] **Step 4.8: Commit**

```bash
git add src/engine/geometry/ src/hooks/snap/
git commit -m "feat(snap): Tab-cycle through overlapping snap candidates

Tekenaar bug #4: when multiple shapes share a snap point, pressing
Tab now cycles through candidates. Matches AutoCAD behavior.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Zelf-review

1. **Coverage:** 4 tasks voor 4 bugs. Elk heeft test, fix, manual verificatie, commit.
2. **Placeholders:** geen. Alle code-blocks bevatten concrete TypeScript.
3. **Type consistency:** `SnapCandidate`, `BlockInstanceShape`, `computeEffectivePatternSpacing` consistent benoemd.
4. **Scope:** 4 tasks × ~2-3 uur = ~10 uur totaal. Past in 2 dagen.

Note: exacte bestandspaden en regelnummers moeten tijdens uitvoering gevalideerd worden (de codebase is levend). De `inspecteer` steps in elke task zijn explicieet zodat de developer de juiste plek vindt.

---

## Execution

Branch: `master` (shipping). Na alle 4 tasks compleet:

```bash
git checkout master
git pull
# Taken uitvoeren
npm run build  # end-to-end sanity check
npm run test
# Release tag
git tag v0.36.0
# Push
git push origin master --tags
```

De bug-fixes kunnen in een 0.36 release naar klanten terwijl de Rust-kernel spike loopt.
