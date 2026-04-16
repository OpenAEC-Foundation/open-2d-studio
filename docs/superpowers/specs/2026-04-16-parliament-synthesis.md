# Synthese — Parlementair Debat over de Native Rust Kernel

> **Datum:** 2026-04-16
> **Bron:** 7 rollen × 2 rondes = 14 statements (bewaard in `parliament/_all-statements-backup.json`)
> **Rollen:** Luis in de Pels · Purist · Tekenaar · Programmeur · Professor · Verkoper · Ideoloog
> **Onderwerp:** Is het ontwerp in `2026-04-16-native-rust-kernel-design.md` de juiste route?

---

## Overkoepelend oordeel

Het parlement is **unaniem kritisch** op de spec in zijn huidige vorm, maar **verdeeld over de richting**:

- **5 van de 7** erkennen dat de technische ambitie (native Rust + wgpu + ECS) juist is
- **6 van de 7** vinden dat de spec niet implementatie-klaar is
- **4 van de 7** vinden 18-24 weken ongeloofwaardig
- **3 van de 7** (Verkoper, Tekenaar, deels Luis) pleiten tegen radiostilte van een half jaar
- **1 van de 7** (Ideoloog) houdt vast aan de missie ongeacht de kosten

**Meest geciteerde quote:** "Dit is geen ontwerp, dit is een wensenlijst met een Cargo.toml eromheen." (Luis, R1)

---

## De drie consensuspunten

Punten waar **meerdere rollen** elkaar, vanuit verschillende hoek, bij treffen:

### 1. De precisie-analyse is oppervlakkig

**Geuit door:** Luis (R1, R2), Professor (R1, R2), Purist (R1, R2), Programmeur (via implicatie)

**Kern:** De spec berekent alleen **opslagprecisie** (ULP van f64 op 10⁹ mm), niet **numerieke stabiliteit onder compositie** (subtractie, deling, predicates).

**Concreet probleem:** Catastrophic cancellation — twee punten op 1000 km afstand, 0.001 mm uit elkaar, produceren bij subtractie nog maar 2-4 significante cijfers. Orientation tests, line-line intersection, in-circle predicates falen precies daar.

**Wat de spec mist:**
- Shewchuk's adaptive exact predicates (`robust = "1.1"` crate)
- Escape hatch naar exact arithmetic wanneer dynamic filters een teken niet betrouwbaar bepalen
- Per-object local coordinate frames (zoals OpenCascade, Cesium RTC)
- Snap-rounding (Hobby) + exact intersection pre-processing voor tessellation
- Bewijs dat de rebase-invariant correct propageert door lyon, R-tree, en dimensioning

**Consensus-niveau:** HARD. Dit is geen meningsverschil maar een wiskundige omissie.

---

### 2. De 18-24 weken roadmap is ongeloofwaardig

**Geuit door:** Luis (R1), Verkoper (R1), Programmeur (R1), Professor (R2, indirect)

**Concrete kritiek:**
- Fase 2 (3-4 weken) belooft: 100k shapes @ 120 fps + R-tree in f64 + floating origin rebase + viewport cull + LOD. Dat is **6 maanden werk voor 3 senior rendering-engineers**, niet een maand voor één persoon.
- Fase 5 (2-3 weken): "port AEC extension naar Rust" — alsof de parametrische constraint-engine met DAG en cross-object `@`-referenties een weekend-projectje is.
- Risico 10 ("UI rewrite blokkeert productiviteit", Hoog/Hoog): de mitigatie is letterlijk **"parallelle ontwikkeling"**. Dat is geen mitigatie, dat is het risico herformuleren als plan.
- Reviewer-schatting uit onafhankelijke review (voorafgaand aan het parlement): **12-18 maanden** voor echte feature-pariteit.

**Consensus-niveau:** HARD. Geen van de rollen verdedigt de huidige roadmap.

---

### 3. De spec is niet implementatie-klaar

**Geuit door:** Programmeur (R1, R2), Luis (R1), Purist (R1, R2)

**Concrete lacunes:**
- `bevy_ecs::World` is `!Sync` — de spec zegt "Send+Sync, parallel" in het diagram. Dat klopt niet.
- `Box<dyn Command>` trait gebruikt `as_any()`/`downcast_ref()` zonder dat de trait `Any` als supertrait declareert → **compileert niet**.
- Style table gedocumenteerd als "uniform buffer" maar WGSL gebruikt `var<storage, read>` → mismatch met D3D12 64 KB uniform limiet
- Geen async runtime keuze (tokio/smol/pollster) terwijl wry + rfd + libloading + HTTP gemengd zijn
- Geen MSRV pin, geen cross-compile matrix, geen Cargo workspace layout, geen feature flags
- `ifc-rs` crate bestaat niet productie-klaar; de spec doet alsof wel
- QuickJS claim "5-20× sneller dan V8" is precies **omgekeerd** — QuickJS is trager
- `libloading` plugin ABI is instabiel tussen Rust-versies — niet geadresseerd

**Consensus-niveau:** HARD. Deze gaten blokkeren een week-1 start.

---

## De drie verdeeldheden

Punten waar het parlement **fundamenteel verdeeld** is en waar de ontwerper/opdrachtgever moet kiezen:

### A. Formeel bewijs vs. pragmatisme

**Purist + Professor:** eerst bewijs, dan bouwen. TLA+ model voor rebase-invariant, exact arithmetic onder de kernel, formele specificatie van Command-semantiek.

**Programmeur + Verkoper + Tekenaar:** pragmatisme. Ship, meet, verbeter. Bewijs komt uit tests en bug-reports, niet uit Lamport-specs.

**Luis:** allebei gelijk. Zonder bewijs is het speculatie, maar TLA+-in-de-spec is over-engineering.

**Ideoloog:** correctheid dient emancipatie. Een trage open tool verliest; een foute open tool ook.

### B. Radiostilte vs. incrementeel

**Verkoper:** ship drie commerciële features in 6 maanden (IFC-import, Revit-roundtrip, cloud-sync). Kernel-herbouw achter de schermen. Geen radiostilte.

**Ideoloog:** radiostilte is onvermijdelijk. Bouw voor 2046. LibreOffice/Linux/Blender begonnen zonder Q3-targets.

**Tekenaar:** behoud alsjeblieft mijn huidige workflow. Introduceer niks nieuws voor eerst de bestaande bugs fixt zijn.

**Programmeur:** compromis — huidige TS-kernel blijft shipping product, Rust-kernel parallel achter feature flag. Maar **wie onderhoudt twee codebases?** Onbeantwoord.

### C. Backwards-compat JS extensions vs. clean break

**Ideoloog:** durf te breken. QuickJS bridge is een valstrik. Port de 3 extensions, sluit de bridge over 2 jaar.

**Programmeur:** pragmatisch. Behouden totdat nieuwe plugins klaar zijn, anders verliezen we bestaande gebruikers.

**Tekenaar:** onverschillig — "of mijn extension werkt, of hij werkt niet. Als hij niet werkt verlies ik een klant."

**Purist:** een hybride runtime-bridge onder een statisch typed kernel is architecturaal onzuiver.

---

## Stem per rol — positie samengevat

| Rol | Positie | Stem |
|-----|---------|------|
| 🦗 **Luis** | Spec is PowerPoint-architectuur; fix code-gaten vóór goedkeuring | **CONDITIONEEL** (eerst bugs fixen in de spec) |
| ⚖️ **Purist** | Eerst bewijs, dan code. Geen compromissen op correctheid | **TEGEN** (in huidige vorm) |
| ✏️ **Tekenaar** | Fix eerst wat vandaag al stuk is (undo-stack, block instances, snap cycling) | **TEGEN** (prioriteit ligt elders) |
| ⚙️ **Programmeur** | Richting is goed, spec is onvoldoende. Geef me crate-versies en MSRV | **CONDITIONEEL** (na addendum) |
| 🎓 **Professor** | Precisie-fundament moet eerst staan. Robuustheid vóór features | **CONDITIONEEL** (na robuustheidssectie) |
| 💼 **Verkoper** | Nee, absoluut niet. Ship incrementeel | **TEGEN** |
| 🔥 **Ideoloog** | Ja, durf te bouwen voor 2046 | **VOOR** |

**Uitslag:** 1 VOOR, 3 CONDITIONEEL, 3 TEGEN. De spec passeert niet.

---

## Concrete aanpassingen op het design

Wat we **moeten doen** op basis van dit debat, gegroepeerd op prioriteit:

### MUST DO (blokkeert goedkeuring)

1. **Robuustheidssectie toevoegen**
   - Shewchuk adaptive predicates via `robust = "1.1"` crate onder feature flag `exact-predicates`
   - Per-object local coordinate frames als aanvulling op globale floating origin
   - Snap-rounding preprocessing voor tessellation
   - Concreet plan voor degenerate geometry (zelf-snijdende polygons, collineaire punten)

2. **Implementatie-details invullen**
   - Cargo workspace layout (crates: `kernel`, `ecs`, `commands`, `render`, `file_io`, `extensions`, `ecs-types`)
   - MSRV pin in `rust-toolchain.toml`
   - Cross-compile matrix (Win10/11, macOS 12+, Linux glibc 2.28+)
   - Feature flags (exact-predicates, webview, js-extensions, wasm)
   - Async runtime keuze: `pollster` + `smol`, geen tokio in kernel
   - Storage vs uniform buffer voor style table → STORAGE met feature-detect

3. **Code-voorbeelden moeten compileren**
   - `trait Command: Any + Send + 'static` toevoegen
   - `bevy_ecs::World` correct als `!Sync`, expliciet main-thread
   - Instance struct met `#[repr(C)]` + `bytemuck::Pod` derives
   - WGSL struct layout met expliciete padding velden

4. **Roadmap herzien**
   - Opsplitsen in MVP (6 maanden, beperkte feature set) vs Full parity (12-18 maanden)
   - Fase 2 exit criterion realistisch maken (niet "100k @ 120 fps in 4 weken")
   - Kill-criteria toevoegen: wanneer rollen we terug naar TypeScript versie?
   - Spike week (1-2 weken) vóór Fase 1 voor risicovolle prototypes

5. **Scope gap: IFC/Revit/DWG**
   - IFC4X3 **import** moet in MVP, niet pas in phase 6
   - Revit-roundtrip via IFC als MVP feature
   - DWG blijft non-goal — maar zeg dat expliciet in marketing

### SHOULD DO (sterk aanbevolen)

6. **Ontbrekende topics toevoegen**
   - Accessibility (AccessKit integratie voor egui)
   - Internationalization (`cosmic-text` voor CJK/RTL font fallback)
   - HiDPI / per-monitor DPI / fractional scaling
   - Input latency strategy (VSync modes, predictive cursor)
   - Crash recovery (WAL-journal van commands)
   - Testing strategy (visual regression via `insta`, performance benchmarks in CI)
   - Installer/updater (cargo-dist of velopack)
   - Code signing workflow (Windows SmartScreen + Apple notarization = multi-week)

7. **ECS + Command pattern herzien**
   - Expliciet: World = source-of-truth, CommandHistory = log van applied commands
   - Command trait gebruikt `&mut World` via `world.resource_scope()` idiom
   - Sparse GPU buffer writes met coalescing strategy (dirty range merging)
   - Stage 4 GPU expliciet single-threaded met benchmarks om bottleneck uit te sluiten

8. **Parallel ontwikkelstrategie**
   - Concreet plan voor dual-maintenance TS kernel + Rust kernel
   - Feature flag strategy voor gradueel over laten lopen
   - Beslissingsmoment ingepland (bijv. maand 4): go/no-go op basis van prototype-metingen

### COULD DO (nuttig maar optioneel)

9. **TLA+-achtig mini-spec** voor de rebase-invariant (Purist's eis, maar 1 persoon kan dat niet dragen)
10. **"Snelste open source CAD" marketing narratief** expliciet maken of laten vallen
11. **Benchmarks budget** vastleggen (wie meet, waarmee, waar)

---

## De kernvraag aan de opdrachtgever

Op basis van dit debat moeten jij en ik nu kiezen tussen drie routes:

### Route A: **"Ga door maar addendum eerst"**
Herzien de spec met MUST DO punten (schatting: 1 week werk). Dan implementatie-plan schrijven per fase. MVP na ~6 maanden, full parity 12-18 maanden.

**Voorstanders:** Programmeur, Professor, Ideoloog (condi­tioneel)
**Tegenstanders:** Verkoper (commercieel onverantwoord), Tekenaar (eerst bugs)

### Route B: **"Hybride — Rust kernel onder de motorkap, TS kernel blijft shipping"**
Huidige TypeScript tool blijft release-spoor. Rust-kernel wordt parallel gebouwd per module (bijv. eerst rendering layer, dan state, dan geometry). Gebruikers merken pas iets in versie 0.50+.

**Voorstanders:** Verkoper, Programmeur (compromis)
**Risico:** dual-maintenance explodeert snel, niemand heeft die capaciteit

### Route C: **"Stop de kernel-herbouw, fix bestaande bugs"**
De Tekenaar's route. Geen Rust, geen ECS. Eerste 3 maanden: alle bugs uit de huidige tool halen (undo-stack, block instances, snap cycling, hatch scaling). Daarna pas kernel-gesprek.

**Voorstanders:** Tekenaar, Verkoper (deels)
**Tegenstanders:** Ideoloog, Professor, Purist (precisie-plafond blijft)

---

## Mijn synthese-advies

Op basis van alle input adviseer ik **Route A+** — een gemodificeerde versie van Route A:

1. **Spec herzien** met de MUST DO punten (week 1-2)
2. **Spike-fase van 2 weken** vóór Fase 1 om de riskantste prototypes te valideren:
   - Command + bevy_ecs resource_scope dance
   - 100k instance dirty-updates benchmark op echte GPU's
   - egui ribbon prototype met dockable panels
   - f64 + Shewchuk line-intersection test op 1000 km
   - wry + React dialoog round-trip op Windows met WebView2
3. **Go/no-go moment** na spike: als één van de prototypes faalt, overwegen we Route B of C
4. **MVP van 6 maanden met Verkoper's drie features**:
   - IFC4X3 import (maand 1-2, pakbaar vanuit TS kernel zonder Rust-rewrite!)
   - Revit-roundtrip via IFC (maand 3-4)
   - Cloud-sync light (maand 5-6)
5. **Rust-kernel pas in fase 2** (maand 7-18), nadat bovenstaande features al klanten hebben opgeleverd
6. **Tekenaar's concrete bugs** (undo-scope, block instances, hatch scaling, snap cycling) in parallel trackje — lost in huidige TS kernel, binnen komende 4 weken

**Resultaat:**
- ~~6 maanden radiostilte~~ → 3 releases, 3 persberichten
- ~~Q3-targets gemist~~ → IFC-import als dealbreaker-unlock
- ~~18-24 weken overmoed~~ → realistisch 18 maanden voor kernel-swap
- Tekenaar krijgt zijn bugs gefixt
- Ideoloog krijgt zijn visie (uiteindelijk)
- Programmeur krijgt tijd voor een implementation-ready addendum
- Professor krijgt zijn precisie-fundament
- Purist krijgt zijn formele sectie (in de addendum)
- Luis heeft minder te bekritiseren

---

## Bijlage: verwijzingen

- **Originele spec:** `2026-04-16-native-rust-kernel-design.md`
- **Debat-archief:** `parliament/_all-statements-backup.json`
- **Viewer:** `parliament/parliament.html` (zie ook `http://localhost:7777/parliament.html`)
- **Externe review:** de vorige agent-review (7 show-stoppers, 21 concerns)
- **Branch:** `native-kernel-rust`

---

*Dit document sluit niet de discussie; het vat haar samen en formuleert besluitvorming.*
