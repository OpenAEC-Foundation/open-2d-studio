# Parametric Component System — Design Specification

**Date:** 2026-04-03
**Status:** Draft
**Author:** Rick + Claude
**Depends on:** Parametric Constraint Engine (2026-04-02)

## 1. Overview

Open 2D Studio krijgt een universeel parametrisch component systeem, gebouwd als AEC Extension. Alle AEC objecten (kolommen, wanden, vloeren, balken, wapening, palen, etc.) zijn parametrische componenten. Het systeem bouwt voort op de constraint engine en gebruikt IfcX als native datastructuur.

### Scope

**Fase 1 (dit document):** Parametric Component systeem met editor, arrays, nesting, library panel, meerdere representaties, en IFC profile mapping. Gebouwd als AEC Extension.

**Fase 2 (later):** Migratie bestaande AEC objecten (WallShape, ColumnShape, etc.) naar ComponentDefinitions.

**Fase 3 (later):** Volledige IfcX import/export met parametrische definities.

### Design Principes

- Elk AEC object IS een parametrisch component — geen apart systeem
- IfcX is de native datastructuur — alle intelligentie zit in het IfcX bestand
- IFC4 export is een "dump" — parametrische logica vertaald naar statische geometrie
- IFC profile definitions worden correct gemapped (IfcIShapeProfileDef, etc.)
- Onbeperkte nesting met shared/non-shared instances
- Performance: flattened render cache, geen runtime nesting traversal
- Meerdere representaties per component (plan, section, elevation, 3D)

## 2. Data Model

### 2.1 ComponentDefinition

De "family" of "type" — de parametrische template.

```typescript
interface ComponentDefinition {
  id: string;
  name: string;                          // "HEA300 Kolom", "Ø12 Wapeningsstaaf"
  description?: string;
  category: ComponentCategory;
  tags?: string[];

  // ── Parameters & Constraints ─────────────────────
  parameters: Parameter[];               // uit constraint engine
  constraintGraph: ShapeConstraintGraph;  // formules, dependencies

  // ── Geometry ─────────────────────────────────────
  representations: ComponentRepresentation[];  // meerdere views
  referenceLines: ReferenceGeometry[];         // constructie-hulp (niet gerenderd)

  // ── Nesting & Arrays ─────────────────────────────
  nestedComponents: NestedComponentRef[];
  arrays: ComponentArray[];

  // ── IFC Mapping ──────────────────────────────────
  ifcClass?: string;                     // "IfcColumn", "IfcBeam", "IfcSlab", etc.
  ifcProfileDef?: IFCProfileDefMapping;  // voor profielen: IfcIShapeProfileDef etc.
  ifcPropertySets?: IFCPropertySetDef[]; // custom property sets

  // ── Insertion ────────────────────────────────────
  insertionPoint: { xParamId: string; yParamId: string };

  // ── Metadata ─────────────────────────────────────
  version: string;
  createdAt: string;
  modifiedAt: string;
  author?: string;
  metadata?: Record<string, unknown>;
}

type ComponentCategory =
  | 'structural-steel'
  | 'structural-concrete'
  | 'structural-timber'
  | 'reinforcement'
  | 'foundation'
  | 'architectural'
  | 'MEP'
  | 'detail'
  | 'annotation'
  | 'custom';
```

### 2.2 ComponentRepresentation

Meerdere visuele representaties per component, net als IFC's representation contexts.

```typescript
interface ComponentRepresentation {
  id: string;
  context: RepresentationContext;
  geometry: ComponentGeometryElement[];  // de shapes in deze view
  isDefault: boolean;
}

type RepresentationContext =
  | 'plan'         // bovenaanzicht
  | 'section'      // doorsnede
  | 'elevation'    // vooraanzicht
  | 'detail'       // detailtekening
  | '3d';          // toekomstig

interface ComponentGeometryElement {
  id: string;
  type: 'line' | 'polyline' | 'arc' | 'circle' | 'rectangle'
      | 'ellipse' | 'hatch' | 'text' | 'dimension';
  // Geometrie-punten verwijzen naar parameters
  geometry: ParametricGeometryDef;
  style: ShapeStyle;
  // Visibility control
  visibleParamId?: string;             // boolean parameter → Yes/No toggle
}
```

### 2.3 ParametricGeometryDef

Geometrie waarvan punten/afmetingen gekoppeld zijn aan parameters.

```typescript
type ParametricGeometryDef =
  | ParametricLineDef
  | ParametricPolylineDef
  | ParametricArcDef
  | ParametricCircleDef
  | ParametricRectangleDef
  | ParametricHatchDef
  | ParametricTextDef
  | ParametricDimensionDef;

interface ParametricLineDef {
  kind: 'line';
  startX: string;   // paramId
  startY: string;
  endX: string;
  endY: string;
}

interface ParametricPolylineDef {
  kind: 'polyline';
  vertices: Array<{ xParamId: string; yParamId: string }>;
  closed: boolean;
}

interface ParametricArcDef {
  kind: 'arc';
  centerX: string;
  centerY: string;
  radius: string;    // paramId
  startAngle: string;
  endAngle: string;
}

interface ParametricCircleDef {
  kind: 'circle';
  centerX: string;
  centerY: string;
  radius: string;
}

interface ParametricRectangleDef {
  kind: 'rectangle';
  x: string;
  y: string;
  width: string;
  height: string;
  rotation?: string;
}

interface ParametricHatchDef {
  kind: 'hatch';
  boundaryElementIds: string[];  // verwijst naar andere geometry elements
  pattern: string;               // hatch pattern naam
  scale?: string;                // paramId
  angle?: string;                // paramId
}

interface ParametricTextDef {
  kind: 'text';
  x: string;
  y: string;
  template: string;              // "Ø{diameter} L={length}" — parameter interpolatie
  height?: string;               // paramId voor teksthoogte
  rotation?: string;
}

interface ParametricDimensionDef {
  kind: 'dimension';
  startElementId: string;        // geometry element ID
  endElementId: string;
  paramId: string;               // welke parameter deze dimension toont/stuurt
  offset: number;                // afstand van de lijn
  style: 'linear' | 'angular' | 'radial';
}
```

### 2.4 Nesting

```typescript
interface NestedComponentRef {
  id: string;
  definitionId: string;           // welke ComponentDefinition
  shared: boolean;                // true = wijziging in definitie wijzigt alle
  instanceName?: string;          // optioneel: naam voor cross-ref (@naam.param)

  // Positie als parameters
  positionX: string;              // paramId
  positionY: string;              // paramId
  rotation?: string;              // paramId
  scale?: string;                 // paramId

  // Parameter overrides: param naam → formule of waarde
  parameterOverrides: Record<string, string>;

  // Visibility
  visibleParamId?: string;        // boolean parameter → Yes/No toggle
}
```

**Shared vs Non-Shared:**
- `shared: true` — het geneste component verwijst naar de originele ComponentDefinition. Wijzig de definitie → alle shared instances updaten mee.
- `shared: false` — een onafhankelijke kopie van de definitie wordt gemaakt. Wijzigingen in de kopie beïnvloeden andere instances niet.

**Cycle detection:** Bij nesting wordt gecontroleerd of een component zichzelf (direct of indirect) nest. Dit gebruikt dezelfde DFS cycle detection als de constraint graph.

### 2.5 Arrays

```typescript
interface ComponentArray {
  id: string;
  type: 'linear' | 'radial';

  // Wat wordt ge-arrayd
  sourceType: 'element' | 'nested-component';
  sourceId: string;               // geometry element ID of nested component ID

  // Aantal (kan 0 zijn!)
  countParamId: string;           // integer parameter, min=0

  // Lineair
  spacingX?: string;              // paramId — afstand per stap in X
  spacingY?: string;              // paramId — afstand per stap in Y

  // Radiaal
  centerX?: string;               // paramId — draaipunt
  centerY?: string;               // paramId
  radius?: string;                // paramId
  totalAngle?: string;            // paramId — totale hoek (360 = volle cirkel)

  // Visibility
  visibleParamId?: string;        // boolean parameter → hele array aan/uit
}
```

**Array count = 0:** De array bevat geen elementen. Dit is nuttig voor conditionele geometrie — bijv. "als `hasStiffeners == true` dan `stiffenerCount = 4`, anders `stiffenerCount = 0`".

### 2.6 ComponentInstance

Geplaatst in een tekening. Extends de bestaande BaseShape.

```typescript
interface ComponentInstanceShape extends BaseShape {
  type: 'component-instance';
  definitionId: string;
  parameterValues: Record<string, number | boolean | string>;
  representationContext: RepresentationContext;  // welke view tonen

  // Cached flattened geometry voor rendering
  flattenedGeometry?: FlattenedComponentGeometry;
  flattenedAt?: number;  // timestamp voor cache invalidatie
}

interface FlattenedComponentGeometry {
  shapes: Shape[];           // reguliere shapes, klaar om te renderen
  bounds: BoundingBox;
}
```

### 2.7 ReferenceGeometry

Constructielijnen die alleen zichtbaar zijn in de Component Editor, niet in instances.

```typescript
interface ReferenceGeometry {
  id: string;
  type: 'line' | 'point' | 'circle';
  geometry: ParametricGeometryDef;
  label?: string;
  // Reference geometry is altijd zichtbaar in editor, nooit in instances
}
```

## 3. IFC Mapping

### 3.1 IFC Profile Definitions

Standaard IFC profieltypen worden correct gemapped. Elk profiel is een ComponentDefinition met de juiste `ifcProfileDef`.

```typescript
interface IFCProfileDefMapping {
  profileType: IFCProfileType;
  parameterMapping: Record<string, string>;  // IFC param naam → component paramId
}

type IFCProfileType =
  | 'IfcRectangleProfileDef'
  | 'IfcCircleProfileDef'
  | 'IfcIShapeProfileDef'
  | 'IfcLShapeProfileDef'
  | 'IfcTShapeProfileDef'
  | 'IfcUShapeProfileDef'
  | 'IfcCShapeProfileDef'
  | 'IfcZShapeProfileDef'
  | 'IfcRectangleHollowProfileDef'
  | 'IfcCircleHollowProfileDef'
  | 'IfcEllipseProfileDef'
  | 'IfcTrapeziumProfileDef'
  | 'IfcArbitraryClosedProfileDef'
  | 'IfcArbitraryOpenProfileDef'
  | 'IfcAsymmetricIShapeProfileDef';
```

**Voorbeeld: HEA300 als ComponentDefinition:**
```
ifcClass: "IfcColumn"
ifcProfileDef: {
  profileType: "IfcIShapeProfileDef",
  parameterMapping: {
    "OverallDepth": "height",        // → 290mm
    "OverallWidth": "flangeWidth",   // → 300mm
    "WebThickness": "webThickness",  // → 8.5mm
    "FlangeThickness": "flangeThick",// → 14mm
    "FilletRadius": "filletRadius"   // → 27mm
  }
}
```

### 3.2 IFC PropertySets

Custom properties worden als IFC PropertySets geëxporteerd:

```typescript
interface IFCPropertySetDef {
  name: string;                           // "Pset_ColumnCommon"
  properties: IFCPropertyMapping[];
}

interface IFCPropertyMapping {
  ifcName: string;                        // "LoadBearing"
  paramId: string;                        // component parameter ID
  ifcType: 'IfcBoolean' | 'IfcReal' | 'IfcInteger' | 'IfcLabel' | 'IfcLengthMeasure';
}
```

### 3.3 IfcX vs IFC4 Export

| Aspect | IfcX (native) | IFC4 (export) |
|---|---|---|
| Parametrische definities | Volledig opgeslagen | Verloren — statische waarden |
| Formules | Opgeslagen als strings | Niet ondersteund |
| Constraint graph | Opgeslagen | Niet ondersteund |
| Arrays | Parametrisch (count/spacing) | Uitgeflattend naar losse instances |
| Nesting | Structureel behouden | IfcRelAggregates/IfcRelNests |
| Profile definitions | Native IfcX types | Standaard IFC4 profile defs |
| Multiple representations | Native | IfcShapeRepresentation per context |
| Visibility parameters | Opgeslagen | Geëvalueerd → zichtbaar of weggelaten |

## 4. Component Editor Mode

### 4.1 Activering

- **Dubbelklik** op een ComponentInstance → open editor voor die definitie
- **Rechtsklik → "Edit Component"** op een ComponentInstance
- **"New Component" knop** in de Component Library panel

### 4.2 Visuele staat

- Rest van het canvas **grijst uit** (semi-transparante overlay)
- Alleen de component-geometrie is bewerkbaar
- **Referentielijnen** worden zichtbaar (gestippeld, lichtblauw)
- **Parameter panel** toont component-parameters
- **Dimensies** zijn interactief — klik om parameterwaarde te wijzigen

### 4.3 Beschikbare tools in editor

Alle reguliere tekenttools + extra:
- Lijnen, polylines, arcs, cirkels, rechthoeken, ellipsen
- Arceringen (koppelbaar aan boundaries)
- Tekst (met `{parameter}` interpolatie)
- Dimensies (koppelbaar aan parameters)
- Referentielijnen (constructie-hulp)
- Array tool (lineair/radiaal)
- Nest Component tool (component-in-component plaatsen)
- **Geen** walls/slabs/beams — die zijn zelf componenten

### 4.4 Sluiten

- **Escape** of **"Close Editor"** knop
- Alle instances van deze definitie worden bijgewerkt
- Flattened geometry cache wordt geïnvalideerd

## 5. Component Library Panel

### 5.1 Locatie

Sub-tab in het Properties panel, naast de bestaande tabs.

### 5.2 Inhoud

- **Categorieën** met inklapbare secties (Structural Steel, Concrete, Reinforcement, etc.)
- **Zoekbalk** bovenaan
- **Per component:** naam, klein icoontje/preview, parameterlijst
- **"New Component"** knop bovenaan
- **Import/Export** knoppen

### 5.3 Plaatsing

1. Gebruiker klikt op component in library
2. Component "hangt" aan de cursor (preview)
3. Klik op canvas om te plaatsen
4. Parameters aanpassen in Properties panel na plaatsing

### 5.4 Import/Export

- **Export:** rechtsklik op component → "Export as .ifcx"
- **Import:** "Import Component" knop → bestandsdialoog → `.ifcx` bestand selecteren
- Geïmporteerde componenten worden toegevoegd aan het project

## 6. Rendering & Performance

### 6.1 Flattened Geometry Cache

Elke ComponentInstance bewaart een `flattenedGeometry` cache:

1. **Bij eerste render of cache-invalidatie:**
   - Evalueer alle parameters via constraint solver
   - Resolve nesting recursief (met cycle detection)
   - Flatten arrays (evalueer count, genereer instances)
   - Evalueer visibility parameters (skip niet-zichtbare elementen)
   - Genereer reguliere Shape objecten (Line, Polyline, Arc, etc.)
   - Sla op als `flattenedGeometry`

2. **Bij volgende renders:** gebruik cache direct

3. **Cache invalidatie:** wanneer:
   - Een parameter van de instance wijzigt
   - De ComponentDefinition wordt gewijzigd (via editor)
   - Een shared nested component definitie wijzigt

### 6.2 Performance Targets

| Scenario | Target |
|---|---|
| Instance renderen (gecached) | < 0.1ms (net als reguliere shapes) |
| Cache rebuilden (eenvoudig component, 10 elementen) | < 1ms |
| Cache rebuilden (complex, 100 elementen, 3 nesting levels) | < 10ms |
| 1000 instances op canvas | Geen merkbare vertraging |

## 7. AEC Extension Integratie

### 7.1 Extension Structuur

Het component systeem wordt geregistreerd via de bestaande extension API:

```typescript
// AEC Extension onLoad:
api.ui.addRibbonButton({
  tab: 'AEC',
  group: 'Components',
  label: 'New Component',
  onClick: () => enterComponentCreationMode(),
});

api.ui.addRibbonButton({
  tab: 'AEC',
  group: 'Components',
  label: 'Component Library',
  onClick: () => toggleComponentLibraryPanel(),
});

api.commands.register({
  command: 'component',
  action: 'create',
  description: 'Create a new parametric component',
  handler: () => enterComponentCreationMode(),
});

api.commands.register({
  command: 'component',
  action: 'edit',
  description: 'Edit selected component definition',
  handler: () => enterComponentEditMode(),
});
```

### 7.2 Nieuwe bestanden (geschat)

| Bestand | Doel |
|---|---|
| `src/types/component.ts` | ComponentDefinition, ComponentInstance, etc. |
| `src/engine/component/ComponentEngine.ts` | Core: flatten, cache, nesting resolution |
| `src/engine/component/ComponentArrayResolver.ts` | Array uitvouwen (lineair/radiaal) |
| `src/engine/component/ComponentNestingResolver.ts` | Nesting resolution met cycle detection |
| `src/engine/component/ComponentFlattener.ts` | Parameters evalueren → Shape[] genereren |
| `src/engine/component/ComponentSerializer.ts` | IfcX serialisatie/deserialisatie |
| `src/engine/component/IFCProfileMapper.ts` | IFC profile def mapping |
| `src/state/slices/componentSlice.ts` | Zustand state voor definitions, instances, editor |
| `src/components/panels/ComponentLibraryPanel.tsx` | Library sub-tab in Properties |
| `src/components/panels/ComponentEditorOverlay.tsx` | Editor mode UI (toolbar, dimming) |
| `src/engine/renderer/modes/ComponentEditorRenderer.ts` | Renderer voor edit mode |
| `src/engine/renderer/core/ComponentInstanceRenderer.ts` | Instance renderer (cached) |
| `src/services/component/componentFileService.ts` | Import/export .ifcx bestanden |
| `src/services/component/builtInComponents.ts` | Voorgedefinieerde IFC profielen |

### 7.3 Bestaande bestanden die wijzigen

| Bestand | Wijziging |
|---|---|
| `src/types/geometry.ts` | `'component-instance'` toevoegen aan ShapeType |
| `src/engine/renderer/core/ShapeRenderer.ts` | ComponentInstance rendering dispatchen |
| `src/state/slices/modelSlice.ts` | Component instances opslaan als shapes |
| `src/hooks/canvas/useCanvasEvents.ts` | Dubbelklik → component edit mode |
| `src/engine/registry/*` | Registraties voor component shape type |

## 8. Built-in IFC Profile Components

Bij installatie van de AEC Extension worden deze ComponentDefinitions automatisch beschikbaar:

| IFC Profile Type | Component Name | Key Parameters |
|---|---|---|
| `IfcRectangleProfileDef` | Rectangle | width, height |
| `IfcCircleProfileDef` | Circle | radius |
| `IfcIShapeProfileDef` | I-Beam | height, flangeWidth, webThickness, flangeThickness, filletRadius |
| `IfcAsymmetricIShapeProfileDef` | Asymmetric I | + topFlangeWidth, topFlangeThickness |
| `IfcLShapeProfileDef` | Angle | depth, width, thickness, filletRadius |
| `IfcTShapeProfileDef` | Tee | depth, flangeWidth, webThickness, flangeThickness |
| `IfcUShapeProfileDef` | Channel | depth, flangeWidth, webThickness, flangeThickness |
| `IfcCShapeProfileDef` | C-Shape | depth, width, wallThickness, girth |
| `IfcZShapeProfileDef` | Z-Shape | depth, flangeWidth, webThickness, flangeThickness |
| `IfcRectangleHollowProfileDef` | HSS Rect | width, height, wallThickness |
| `IfcCircleHollowProfileDef` | HSS Round | radius, wallThickness |
| `IfcEllipseProfileDef` | Ellipse | semiAxis1, semiAxis2 |
| `IfcTrapeziumProfileDef` | Trapezium | bottomWidth, topWidth, height, offset |

Elk profiel heeft de juiste IFC parameter namen en standaard presets (HEA, HEB, IPE, UNP, etc.).

## 9. Toekomstige Fases

### Fase 2: Migratie bestaande AEC objecten

- WallShape → ComponentDefinition met `ifcClass: "IfcWall"`
- ColumnShape → ComponentDefinition met `ifcClass: "IfcColumn"` + profile def
- BeamShape → ComponentDefinition met `ifcClass: "IfcBeam"` + profile def
- SlabShape → ComponentDefinition met `ifcClass: "IfcSlab"`
- PileShape → ComponentDefinition met `ifcClass: "IfcPile"` + symboolrepresentaties

### Fase 3: IfcX Import/Export

- ComponentDefinition ↔ IfcX TypeObject roundtrip
- Parametrische formules opgeslagen in IfcX property sets
- Constraint graph serialisatie in IfcX
- Import herkent parametrische definities en herstelt formules
