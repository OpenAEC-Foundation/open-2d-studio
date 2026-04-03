# Parametric Constraint Engine — Design Specification

**Date:** 2026-04-02
**Status:** Draft
**Author:** Rick + Claude

## 1. Overview

Open 2D Studio krijgt een parametrisch constraint systeem vergelijkbaar met FreeCAD en Revit. Objecten bestaan uit edges en vertices waaraan parameters gekoppeld zijn. Parameters kunnen formules bevatten die verwijzen naar lokale, globale, en cross-object parameters. Een Directed Acyclic Graph (DAG) bepaalt de solve-volgorde.

### Scope

**Fase 1 (dit document):** Constraint graph engine met formule-evaluator, properties panel UI, visuele constraints op canvas, migratie bestaande profieltypen.

**Fase 2 (later):** Node-based visuele editor als frontend over dezelfde engine.

**Fase 3 (later):** IFC export van parametrische definities als custom IFC objecten.

### Design Principes

- De constraint graph (DAG) is de kern — alles draait om nodes en edges
- De DAG is zo ontworpen dat een visuele node editor er later zonder rewrite overheen kan
- Bestaande ParametricShape types worden gemigreerd, niet vervangen
- Incrementeel solven — alleen dirty nodes herberekenen
- Formule-taal is uitgebreid maar geen volledige scripting-taal

## 2. Data Model

### 2.1 Parameter

```typescript
interface Parameter {
  id: string;
  name: string;                // "flangeWidth", "height"
  value: number | boolean | string; // huidige berekende waarde (type volgt 'type' veld)
  formula?: string;            // bijv. "height * 0.4"
  unit: ParameterUnit;         // "mm", "m", "in", "deg", "ratio", "none"
  min?: number;                // validatie ondergrens
  max?: number;                // validatie bovengrens
  group?: string;              // UI groepering: "Flens", "Lijf", "Berekend"
  isReadOnly?: boolean;        // computed parameters (area, Ix, etc.)
  type: 'number' | 'integer' | 'boolean' | 'string';
}

type ParameterUnit = 'mm' | 'm' | 'in' | 'ft' | 'deg' | 'rad' | 'ratio' | 'none'
  | 'mm2' | 'mm3' | 'mm4' | 'kg' | 'kN' | 'MPa';
```

### 2.2 ConstraintNode

```typescript
interface ConstraintNode {
  parameterId: string;         // welke parameter deze node representeert
  ownerId: string;             // shape ID die deze parameter bezit
  dependencies: string[];      // parameter IDs waarvan deze node afhangt
  formula?: string;            // expressie om waarde te berekenen
  isDirty: boolean;            // moet herberekend worden
  error?: ConstraintError;     // fout bij laatste evaluatie
}

interface ConstraintError {
  type: 'syntax' | 'reference' | 'cycle' | 'range' | 'type';
  message: string;
  details?: string;            // bijv. cycle pad: "A -> B -> C -> A"
}
```

### 2.3 ConstraintGraph

```typescript
interface ConstraintGraph {
  nodes: Map<string, ConstraintNode>;
  solveOrder: string[];                    // topologische sort cache
  globalParameters: Map<string, Parameter>;// project-brede parameters
  isDirty: boolean;                        // solve-order moet herberekend
}
```

### 2.4 Parametric Geometry (Edges + Vertices)

```typescript
interface ParametricVertex {
  id: string;
  xParamId: string;            // parameter ID voor x-positie
  yParamId: string;            // parameter ID voor y-positie
}

interface ParametricEdge {
  id: string;
  startVertexId: string;
  endVertexId: string;
  type: 'line' | 'arc';
  lengthParamId?: string;      // parameter ID voor lengte constraint
  angleParamId?: string;       // parameter ID voor hoek constraint
  bulge?: number;              // arc bulge (voor arc type)
}

interface ShapeConstraintGraph {
  parameters: Parameter[];
  vertices: ParametricVertex[];
  edges: ParametricEdge[];
  constraintGraph: ConstraintGraph;
}
```

### 2.5 Cross-Object Referenties

Formules kunnen verwijzen naar parameters van andere objecten via `@`-syntax:

| Syntax | Betekenis |
|---|---|
| `height` | Lokale parameter van hetzelfde object |
| `@HEA300.width` | Parameter `width` van object genaamd "HEA300" |
| `@global.verdiepingshoogte` | Globale project-parameter |

De formule-parser vertaalt `@`-referenties naar volledige parameter IDs in de constraint graph. Object-namen moeten uniek zijn binnen het project.

## 3. Formule Engine

### 3.1 Types

| Type | Voorbeelden | Gebruik |
|---|---|---|
| `number` | `300`, `3.14`, `1e-3` | Afmetingen, verhoudingen |
| `integer` | via `floor()`, `ceil()`, `round()` | Aantallen, indices |
| `boolean` | `true`, `false`, `height > 200` | Condities |
| `string` | `"HEA300"` | Labels (niet in berekeningen) |

### 3.2 Operatoren

| Categorie | Operatoren |
|---|---|
| Arithmetiek | `+` `-` `*` `/` `%` `**` |
| Vergelijking | `==` `!=` `<` `>` `<=` `>=` |
| Logisch | `&&` `\|\|` `!` |

### 3.3 Functies

**Trigonometrie** (input in graden):
```
sin(x)  cos(x)  tan(x)
asin(x)  acos(x)  atan(x)  atan2(y, x)
```

**Wiskunde:**
```
sqrt(x)  pow(x, n)  exp(x)  ln(x)  log10(x)
abs(x)  sign(x)
```

**Afronding & bereik:**
```
round(x)  round(x, decimals)
floor(x)  ceil(x)
min(a, b, ...)  max(a, b, ...)
clamp(x, min, max)
lerp(a, b, t)
map(x, inMin, inMax, outMin, outMax)
```

**Conditioneel:**
```
if(conditie, dan, anders)
select(index, waarde0, waarde1, ...)
```

### 3.4 Constanten

```
PI = 3.14159265358979
TAU = 6.28318530717959
E = 2.71828182845905
SQRT2 = 1.41421356237310
```

### 3.5 Unit Herkenning

Formules kunnen eenheden bevatten. Intern wordt alles opgeslagen in mm en graden.

| Invoer | Intern (mm) |
|---|---|
| `150mm` | `150` |
| `0.15m` | `150` |
| `6in` | `152.4` |
| `2ft` | `609.6` |
| `45deg` | `45` |
| `0.785rad` | `44.97` |

Conversie gebeurt bij parsing. Uitvoer toont de unit die bij de parameter hoort.

### 3.6 Formule Voorbeelden

```
flangeWidth = height * 0.5
webThickness = max(8, height / 40)
flangeThickness = webThickness * 1.5
cornerRadius = if(height > 200, 12, 8)
area = 2 * flangeWidth * flangeThickness + (height - 2 * flangeThickness) * webThickness
beamOffset = @Kolom1.width / 2
stramienAfstand = @global.gridMaat - 2 * @global.randAfstand
hoek = atan2(dy, dx)
afrondingRadius = clamp(thickness * 0.3, 3, 15)
```

## 4. Constraint Solver

### 4.1 Solve Cyclus

1. **Parameter wijzigt** — gebruiker edit of formule-update
2. **Dirty marking** — markeer gewijzigde node + alle downstream nodes als dirty
3. **Cycle detection** — bij formule-wijziging: DFS check op cyclus
4. **Topologische sort** — alleen dirty nodes, in afhankelijkheidsvolgorde (cache solve-order)
5. **Evaluate** — per node: parse formule, resolve referenties, bereken waarde
6. **Validate** — check min/max, type, unit
7. **Geometry rebuild** — herbereken vertices en edges voor gewijzigde shapes
8. **Render trigger** — alleen gewijzigde shapes opnieuw tekenen

### 4.2 Dirty Tracking

- Bij waarde-wijziging: markeer node + downstream als dirty, gebruik gecachte solve-order
- Bij structuur-wijziging (formule toevoegen/verwijderen): invalidate solve-order cache, herbereken topologische sort.
- Geometry rebuild alleen voor shapes waarvan vertex-parameters daadwerkelijk van waarde veranderden.

### 4.3 Cycle Detection

Bij elke formule-wijziging:
1. Bouw tijdelijke graph met de nieuwe edge
2. Run DFS cycle detection
3. Bij cirkel: **weiger de wijziging**, toon foutmelding met het pad (bijv. `A -> B -> C -> A`)
4. Bij succes: commit de nieuwe edge, invalidate solve-order cache

### 4.4 Error Handling

| Situatie | Actie |
|---|---|
| Circulaire dependency | Weiger formule, toon pad |
| Ongeldige syntax | Markeer parameter als error, toon melding in UI |
| Out of range (min/max) | Clamp waarde, toon waarschuwing |
| Ontbrekende referentie (`@Deleted.param`) | Markeer als error, bewaar formule-tekst |
| Type mismatch | Markeer als error, toon verwacht vs werkelijk type |

### 4.5 Performance Targets

| Scenario | Target |
|---|---|
| < 500 nodes (typisch project) | < 1ms solve |
| < 5000 nodes (groot project) | < 16ms solve (1 frame) |
| Solve-order berekening | Gecached, alleen bij structuurwijziging |
| Geometry rebuild | Alleen voor shapes met gewijzigde vertices |

## 5. Migratie Bestaande ParametricShape Types

### 5.1 Strategie: Extend, Don't Replace

De bestaande `ParametricShape` interface krijgt een nieuw optioneel veld:

```typescript
interface ParametricShape {
  // ... alle bestaande velden blijven ongewijzigd
  constraintGraph?: ShapeConstraintGraph;  // nieuw, optioneel
}
```

- Shapes zonder `constraintGraph`: werken exact zoals nu (backwards compatible)
- Shapes met `constraintGraph`: gebruiken de nieuwe constraint solver

### 5.2 Auto-migratie van Profile Templates

Elk bestaand profieltype (36+ types) krijgt een default constraint graph gegenereerd uit de huidige `profileTemplates`:

1. Bestaande `ParameterDefinition` entries → vrije `Parameter` nodes (geen formule)
2. Bestaande `geometryGenerator` logica → vertex/edge parameters met formules
3. Min/max/default waarden → overgenomen in `Parameter.min/max/value`
4. Profile presets (HEA300, IPE200) → startwaarden voor parameters

### 5.3 Wat Verandert Niet

- Profile presets blijven werken als startwaarden
- ParametricRenderer gebruikt nog steeds polyline outlines (GeneratedGeometry)
- Type libraries (wall types, beam types) worden constraint graph templates
- Rendering pipeline is ongewijzigd

## 6. UI — Properties Panel

### 6.1 Parameter Weergave

Bij selectie van een parametrisch object toont het properties panel een dynamische parameterlijst:

- **Vrije parameter** — gewoon getal invullen, geen icoon
- **Formule-parameter** `[🔗]` — toont formule links, computed waarde rechts
- **Readonly/computed** `[🔒]` — grijs, niet bewerkbaar
- **Error** — rode rand + tooltip met foutmelding

Parameters zijn gegroepeerd per `group` veld (bijv. "Flens", "Lijf", "Berekend").

### 6.2 Formule Editor (Inline)

Klik op het 🔗 icoon of typ `=` als eerste karakter om de formule-editor te activeren:

- **Autocomplete bij `@`** — toont beschikbare objecten in het project
- **Autocomplete bij `.`** — toont parameters van het geselecteerde object
- **Functie-autocomplete** — `sin(`, `max(`, `if(` etc.
- **Syntax highlighting** in het invoerveld
- **Real-time validatie** — rode rand bij fouten, groene rand bij geldig
- **Dependency indicator** — toont "Gebruikt: height, @Kolom1.width" onder het veld

### 6.3 Parameter Toevoegen

Onderaan de parameterlijst: `[+ Parameter toevoegen]` knop. Opent inline formulier:
- Naam (uniek binnen object)
- Type (number/integer/boolean)
- Unit
- Optioneel: formule
- Optioneel: min/max

### 6.4 Error States in UI

| Kleur | Betekenis |
|---|---|
| Rode rand | Ongeldige formule of ontbrekende referentie |
| Oranje rand | Circulaire dependency poging (met pad-uitleg in tooltip) |
| Grijze waarde | Referentie naar verwijderd object |

## 7. Canvas — Visuele Constraint Editor

### 7.1 Visualisatie bij Selectie

Wanneer een parametrisch object geselecteerd is, toont het canvas extra overlays:

- **Vertices** — blauwe dots, draggable voor vrije parameters
- **Edge dimensies** — parameternaam + waarde langs elke edge
- **Constraint-lijnen** — gestippelde lijnen bij gekoppelde parameters
- **Hoek-indicators** — bij edges met een angle parameter

### 7.2 Visueel Constraints Toevoegen

| Actie | Resultaat |
|---|---|
| Klik op edge | Context menu: "Stel lengte in als parameter" / "Koppel aan parameter" |
| Klik op vertex | Context menu: "Constraint X-positie" / "Constraint Y-positie" |
| Klik op hoek | "Stel hoek in als parameter" |
| Drag vertex (vrij) | Update onderliggende parameter waarde |
| Drag vertex (constrained) | Toon "locked" indicator, geen wijziging |

### 7.3 Kleurcodering

| Kleur | Betekenis |
|---|---|
| Blauw | Vrije parameter (bewerkbaar, draggable) |
| Groen | Constrained door formule (computed) |
| Rood | Error/conflict |
| Grijs | Locked/readonly |

## 8. Toekomstige Fases

### Fase 2: Node-Based Visuele Editor

De constraint graph (DAG) die in fase 1 gebouwd wordt IS de datastructuur voor een node editor. Fase 2 voegt een visuele canvas toe:

- Elke ConstraintNode wordt een visuele node
- Dependencies worden visuele links
- Node types: Input, Math, Geometry, Reference, Output
- Node groups voor herbruikbare componenten
- Drag & drop interface met zoom/pan

De engine hoeft niet herschreven te worden — alleen een visuele frontend.

### Fase 3: IFC Export

Parametrische definities opslaan als IFC objecten:
- `IfcPropertySet` voor parameters en formules
- Custom property sets voor constraint graph structuur
- Roundtrip: IFC import herkent parametrische definities

## 9. Architectuur Integratie

### Nieuwe bestanden (geschat)

| Bestand | Doel |
|---|---|
| `src/types/constraints.ts` | Type definities voor Parameter, ConstraintNode, ConstraintGraph |
| `src/engine/constraints/ConstraintGraph.ts` | Graph datastructuur, cycle detection, topologische sort |
| `src/engine/constraints/ConstraintSolver.ts` | Dirty tracking, solve cyclus, geometry rebuild trigger |
| `src/engine/constraints/FormulaParser.ts` | Expressie parser met unit herkenning |
| `src/engine/constraints/FormulaEvaluator.ts` | Expressie evaluator met functie-bibliotheek |
| `src/engine/constraints/ReferenceResolver.ts` | Cross-object referentie resolutie (@Naam.param) |
| `src/state/slices/constraintSlice.ts` | Zustand state voor constraint graph + globale parameters |
| `src/components/panels/ParameterPanel.tsx` | Properties panel met formule-editor |
| `src/components/panels/FormulaInput.tsx` | Inline formule-editor met autocomplete |
| `src/engine/renderer/layers/ConstraintLayer.ts` | Canvas overlay voor visuele constraints |
| `src/services/parametric/constraintMigration.ts` | Auto-migratie van bestaande profile templates |

### Bestaande bestanden die wijzigen

| Bestand | Wijziging |
|---|---|
| `src/types/parametric.ts` | `constraintGraph?: ShapeConstraintGraph` toevoegen |
| `src/state/slices/parametricSlice.ts` | Integratie met constraint solver |
| `src/engine/renderer/core/ParametricRenderer.ts` | Constraint overlay rendering |
| `src/services/parametric/geometryGenerators.ts` | Optioneel constraint-based generation |
| `src/services/parametric/profileTemplates.ts` | Migration helpers |

### Afhankelijkheden

Geen nieuwe npm packages nodig. De formule-parser en constraint solver worden custom gebouwd — dit vermijdt externe dependencies voor een kern-systeem en geeft volledige controle over syntax en gedrag.
