# Spike Task 6 — Go/No-Go Beslisdocument

> **Parent plan:** `2026-04-16-spike-native-kernel.md`
> **Goal:** Consolideren van alle 5 prototype resultaten tot één expliciete go/no-go beslissing.

**Tijdsbudget:** 0.5 dag (week 2 dag 5)

## Wat dit oplevert

Een beslisdocument dat voor elk van de 5 prototypes:
- Exit criterion → daadwerkelijk resultaat vergelijkt
- Succes / Twijfel / Kill status toekent
- Motivatie voor de finale go/no-go aanbeveling aan de opdrachtgever geeft

## Beslisregel (uit master plan)

**GO:** 4 van 5 prototypes op SUCCES, geen enkele op KILL.
**NO-GO:** 1 of meer prototypes op KILL, of 3+ op TWIJFEL.
**HERBEOORDELEN:** 3 SUCCES + 2 TWIJFEL → herbeoordelen met opdrachtgever.

---

## Task 6.0: Consolideer SPIKE-RESULTS.md

- [ ] **Step 6.0.1: Open huidige SPIKE-RESULTS.md en controleer alle 5 statuses ingevuld**

Run: `cat spike/SPIKE-RESULTS.md`
Expected: alle 5 prototypes hebben een status `[x] SUCCES` / `[x] TWIJFEL` / `[x] KILL`.
Als er nog open items zijn — terug naar de betreffende Task.

- [ ] **Step 6.0.2: Schrijf go/no-go sectie**

Append to `spike/SPIKE-RESULTS.md`:

```markdown
---

# Go/No-Go Beslissing

## Scorecard

| # | Prototype | Verwacht | Daadwerkelijk | Status |
|---|-----------|----------|---------------|--------|
| 1 | ECS + Command | 5-cmd roundtrip werkt | [pass/fail] | [SUCCES/TWIJFEL/KILL] |
| 2 | GPU Benchmark | 100k @ ≥60 fps Iris Xe | [metric] | [SUCCES/TWIJFEL/KILL] |
| 3 | egui Ribbon | 5/5 UX checks | [x/5] | [SUCCES/TWIJFEL/KILL] |
| 4 | Precisie | sub-µm @ 1000 km | [metric] | [SUCCES/TWIJFEL/KILL] |
| 5 | wry Webview | mean < 50 ms | [metric] | [SUCCES/TWIJFEL/KILL] |

## Verdict: [GO / NO-GO / HERBEOORDELEN]

### Motivatie

- [bullet] Waarom deze status volgt uit de scorecard
- [bullet] Welk prototype de zwakste plek toonde
- [bullet] Of er technische risico's blijven ondanks succes

### Volgende stap

**Bij GO:**
- Spec-addendum schrijven (1 week) met MUST DO items uit parliament-synthesis
- Implementation plan voor Fase 1 (Fundament) schrijven
- Commerciële feature-pariteit in parallelspoor (IFC-import maand 1-2) starten

**Bij NO-GO:**
- Geen Rust-kernel herbouw
- Terugval op Route C (bugs fixen in huidige TS kernel)
- Herziening strategische visie na 3 maanden

**Bij HERBEOORDELEN:**
- Gesprek met opdrachtgever: welke twijfels zijn acceptabel
- Eventueel 1-week spike-extensie voor specifieke twijfelpunten
```

- [ ] **Step 6.0.3: Commit verdict**

```bash
cd spike
git add SPIKE-RESULTS.md
git commit -m "spike(06): go/no-go verdict — [GO|NO-GO|HERBEOORDELEN]

Consolidated all 5 prototype results, applied decision rule,
documented motivation and next steps."
```

---

## Task 6.1: Samenvattingsdocument voor opdrachtgever

- [ ] **Step 6.1.1: Create executive summary**

Create `spike/SPIKE-SUMMARY.md`:

```markdown
# Spike Samenvatting — Native Rust Kernel

**Duur:** 2 weken
**Resultaat:** [GO / NO-GO / HERBEOORDELEN]

## Kern bevindingen

### 1. ECS + Command pattern
[Status] — [1-zin samenvatting]

### 2. GPU Performance (100k shapes)
[Status] — [1-zin samenvatting + FPS getal]

### 3. egui + dockable panels
[Status] — [1-zin samenvatting]

### 4. Precisie op 1000 km
[Status] — [1-zin samenvatting + error metric]

### 5. wry webview round-trip
[Status] — [1-zin samenvatting + latency metric]

## Overall aanbeveling

[Tekst — 2-3 paragrafen waarin je de verdict motiveert in
niet-technische termen voor een beslisnemer]

## Als GO: wat gaan we bouwen de komende 6 maanden

- Spec-addendum (1 week) — robuustheidssectie, crate-versies, MSRV
- Fase 1 implementatie (4 weken) — fundament
- Parallel: IFC4X3 import in huidige TS kernel (6 weken)
- Tekenaar's bugs in huidige TS kernel fixen (4 weken)

## Als NO-GO: wat gaan we bouwen de komende 6 maanden

- Focus op Tekenaar's bug-lijst (4 weken)
- IFC4X3 import in huidige TS kernel (6 weken)
- Revit-roundtrip via IFC (6 weken)
- Cloud-sync light (6 weken)

## Parallel spoor ongeacht de uitslag

- Commerciële features uit het parlement-verkoper-advies
- Bug-fix trackje voor Tekenaar's concrete pijnpunten

## Risico's die nog leven

- [bullet] Risico's ondanks de spike-resultaten
```

- [ ] **Step 6.1.2: Review met opdrachtgever**

Agenda-item plannen: 1 uur meeting met:
- SPIKE-RESULTS.md op scherm (details per prototype)
- SPIKE-SUMMARY.md als leidraad
- Live demo van elk prototype (elk ~5 min)

Beslispunten:
1. Akkoord met verdict?
2. Indien GO: akkoord met 6-maanden roadmap?
3. Indien NO-GO: akkoord met Route C follow-up?
4. Indien HERBEOORDELEN: welke spike uitbreiding?

- [ ] **Step 6.1.3: Commit summary**

```bash
cd spike
git add SPIKE-SUMMARY.md
git commit -m "spike(06): executive summary voor opdrachtgever

Non-technical overview of spike findings and recommendation."
```

---

## Task 6.2: Finale cleanup en archiveren

- [ ] **Step 6.2.1: Tag het commit punt**

Run:
```bash
cd spike
git tag -a spike-complete -m "Spike phase complete — verdict: [GO/NO-GO]"
git push origin spike-complete 2>/dev/null || echo "(local tag, push later)"
```

- [ ] **Step 6.2.2: Update parent plan**

Edit `docs/superpowers/plans/2026-04-16-spike-native-kernel.md` — voeg Status sectie toe bovenaan:

```markdown
## Status: VOLTOOID

Einddatum: YYYY-MM-DD
Verdict: [GO / NO-GO / HERBEOORDELEN]
Details: `spike/SPIKE-RESULTS.md` en `spike/SPIKE-SUMMARY.md`
```

- [ ] **Step 6.2.3: Commit**

```bash
git add docs/superpowers/plans/2026-04-16-spike-native-kernel.md
git commit -m "docs: mark spike phase complete with verdict"
```

---

## Self-Review Task 6

1. **Coverage:** consolidatie, scorecard, executive summary, tagging, parent plan update. Alle artefacten voor de go/no-go meeting.
2. **Placeholders:** [pass/fail], [metric], [SUCCES/TWIJFEL/KILL] zijn placeholders die tijdens uitvoering ingevuld worden — dat is de hele functie van dit document. Acceptabel.
3. **Type consistency:** scorecard matches de 5 prototypes uit master plan.
4. **Scope:** 3 sub-tasks, ~4 uur. Past in 0.5 dag.

---

## Samenvatting: compleet spike plan

| Task | Focus | Tijd | Exit criterion |
|------|-------|------|----------------|
| 0 | Workspace setup | 30 min | `cargo check` clean |
| 1 | ECS + Command | 0.5 dag | 2 integration tests pass |
| 2 | GPU benchmark | 1.5 dag | 9 meetpunten op 3 hardware |
| 3 | egui Ribbon | 1 dag | 5/5 UX checks |
| 4 | Precisie | 1 dag | 12 test cases pass |
| 5 | wry webview | 1 dag | < 50 ms mean latency |
| 6 | Go/no-go | 0.5 dag | Verdict + meeting met opdrachtgever |

**Totaal:** 6-7 werkdagen voor één developer. Met buffer voor debugging en documentatie: **10 werkdagen (2 weken)**. Matches de geplande spike-duur.
