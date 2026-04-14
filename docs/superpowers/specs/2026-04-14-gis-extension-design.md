# GIS Extension — Design Specification

**Date:** 2026-04-14
**Status:** Draft
**Author:** Rick + Claude

## 1. Overview

Open 2D Studio krijgt een GIS Extension voor het importeren van kadastrale en ruimtelijke data vanuit Nederlandse, Belgische, Spaanse, Britse en globale GIS-bronnen. De extensie biedt een 3-staps wizard: geolocation → lagen selecteren → sheet genereren. Vector data (WFS) wordt als shapes geplaatst, raster data (WMS/WMTS) als image underlays. Tekst-annotaties (straatnamen, huisnummers, perceelnummers) worden automatisch in KAPITAAL geplaatst.

### Scope

**Fase 1 (dit document):** Complete GIS Extension met geocoding, 40+ lagen, WFS/WMS/WMTS import, tekst-annotaties, automatische sheet placement, en custom WMS/WFS ondersteuning.

### Design Principes

- Data-driven lagenregistratie via JSON configuratie (geen hardcoded URLs)
- NL-eerst maar internationaal uitbreidbaar (BE, ES, UK, globaal)
- Vector + raster: WFS als polylines/shapes, WMS/WMTS als image underlays
- Automatische sheet generatie met titelblok, schaal, noordpijl
- Tekst-annotaties in KAPITAAL met instelbare grootte
- Gebouwd als Extension (zelfde patroon als AEC Extension)

## 2. Wizard Flow

### 2.1 Stap 1: Geolocation

**Adres zoeken:**
- Zoekbalk bovenaan
- PDOK Locatieserver voor Nederland (https://api.pdok.nl/bzk/locatieserver/search/v3_1/free)
- Nominatim (OpenStreetMap) als fallback voor internationaal
- Automatisch land detecteren: NL adres → PDOK, anders → Nominatim
- Resultatenlijst met suggesties

**Coördinaten:**
- RD New (EPSG:28992) voor NL — tonen in meters
- WGS84 (EPSG:4326) — tonen als lat/lon
- Handmatige invoer mogelijk (RD of WGS84)

**Bounding box:**
- Dropdown: 100m, 200m, 500m, 1000m, 2000m, 5000m, custom
- Vierkant rondom het gekozen punt

**Kaartpreview:**
- Live kaartweergave met het gekozen punt en bbox
- Basemap: OpenStreetMap of ESRI World Street Map
- **WMS/WMTS lagen live preview** — wanneer je in stap 2 lagen aan/uitzet, wordt de preview direct bijgewerkt met de inhoud van die laag. Zo zie je meteen wat je importeert voordat je genereert.
- Preview gebruikt een laag-resolutie WMS GetMap request voor snelle weergave

### 2.2 Stap 2: Lagen selecteren

**Lagenlijst:**
- Checkbox per laag, gegroepeerd per categorie
- Per laag configureerbaar: kleur, lijnstijl, layer-naam
- Preset systeem: "Basis Ontwerp", "Stedenbouw", "Omgevingscheck"

**Tekst-annotaties (per laag in/uit te schakelen):**
- Straatnamen (uit Kadaster openbare ruimtenaam WFS) — KAPITAAL
- Huisnummers (uit BAG nummeraanduiding WFS) — KAPITAAL
- Perceelnummers (uit Kadaster percelen WFS) — KAPITAAL
- Tekstgrootte instelbaar per categorie (default: straatnamen 5mm, huisnummers 2.5mm, perceelnummers 3mm)

**WFS spatial filter:**
- Per WFS laag keuze: **Contains** (volledig binnen bbox) of **Intersects** (deels overlappend met bbox)
- Default: Intersects (alles wat de bbox raakt)
- **Live preview van WFS contouren** — wanneer je een WFS laag aanzet, worden de contouren direct in de kaartpreview getekend zodat je ziet welke features er worden ingeladen

**Custom lagen:**
- "Add Custom WMS" knop — URL, layer name, CRS invoeren
- "Add Custom WFS" knop — URL, typename, CRS invoeren

**Download:**
- Progress indicator per laag
- Annuleerbaar
- Retry logica (3 pogingen met backoff)

### 2.3 Stap 3: Sheet Placement

**Schaal:**
- Dropdown: 1:100, 1:200, 1:500, 1:1000, 1:2000, custom

**Papierformaat:**
- Dropdown: A4, A3, A2, A1, A0 (liggend/staand)

**Titelblok:**
- Selecteren uit bestaande templates
- Projectinformatie auto-invullen (adres, coördinaten, datum)

**Extra elementen:**
- Noordpijl (aan/uit, positie kiezen)
- Schaalbalk (aan/uit, positie kiezen)

**Generatie:**
1. Maak een nieuwe drawing aan (naam: adres of projectnaam)
2. Plaats alle vectorlagen als shapes op de drawing (eigen layer per GIS bron)
3. Plaats alle rasterlagen als image underlays
4. Plaats tekst-annotaties
5. Maak een sheet aan met viewport op de juiste schaal
6. Plaats titelblok, noordpijl, schaalbalk

## 3. Data Bronnen

### 3.1 Lagen Registry (gis-services.json)

Alle GIS bronnen worden gedefinieerd in een JSON configuratiebestand. De extensie leest dit bestand bij het laden.

```typescript
interface GISServiceDefinition {
  id: string;
  name: string;
  country: string;                    // 'NL', 'BE', 'ES', 'UK', 'GLOBAL'
  category: GISCategory;
  type: 'wfs' | 'wms' | 'wmts' | 'tms';
  url: string;
  crs: string;                       // 'EPSG:28992', 'EPSG:31370', etc.

  // WFS specifiek
  typeName?: string;                  // WFS feature type
  geometryField?: string;            // veld met geometrie
  outputFormat?: string;             // 'application/json', 'GML3'

  // WMS specifiek
  layers?: string;                   // WMS layer naam
  imageFormat?: string;              // 'image/png', 'image/jpeg'
  pixelWidth?: number;               // default resolutie

  // WMTS/TMS specifiek
  tileMatrixSet?: string;
  tileFormat?: string;

  // Display
  defaultColor: string;              // hex kleur
  defaultLineStyle: string;          // 'solid', 'dashed'
  defaultLineWidth: number;
  defaultVisible: boolean;

  // Tekst-annotatie
  textField?: string;                // JSON veld met tekst (bijv. 'tekst', 'naam')
  textPlacement?: 'centroid' | 'along-line'; // waar tekst plaatsen
  textCategory?: 'straatnaam' | 'huisnummer' | 'perceelnummer';
}

type GISCategory =
  | 'cadastre'
  | 'buildings'
  | 'topography'
  | 'aerial'
  | 'spatial-planning'
  | 'environment'
  | 'risk'
  | 'nature'
  | 'historical'
  | 'basemap'
  | 'custom';
```

### 3.2 Voorgedefinieerde lagen

**Nederland (EPSG:28992):**

| Laag | Type | URL | Categorie |
|---|---|---|---|
| Kadaster percelen | WFS | service.pdok.nl/kadaster/kadastralekaart/wfs/v5_0 | cadastre |
| Kadaster nummeraanduiding | WFS | service.pdok.nl/kadaster/kadastralekaart/wfs/v5_0 | cadastre |
| Kadaster openbare ruimtenaam | WFS | service.pdok.nl/kadaster/kadastralekaart/wfs/v5_0 | cadastre |
| BAG gebouwen | WFS | service.pdok.nl/lv/bag/wfs/v2_0 | buildings |
| BAG verblijfsobjecten | WFS | service.pdok.nl/lv/bag/wfs/v2_0 | buildings |
| Natura2000 contouren | WFS | service.pdok.nl/rvo/natura2000/wfs/v1_0 | nature |
| Luchtfoto actueel | WMS | service.pdok.nl/hwh/luchtfotorgb/wms/v1_0 | aerial |
| Luchtfoto 2016-2021 | WMS | service.pdok.nl/hwh/luchtfotorgb/wms/v1_0 | aerial |
| Top10NL wegdeel hartlijn | WMS | service.pdok.nl/brt/top10nl/wms/v1_0 | topography |
| Kadastrale kaart | WMS | service.pdok.nl/kadaster/kadastralekaart/wms/v5_0 | cadastre |
| Ruimtelijke plannen bouwvlak | WMS | service.pdok.nl/kadaster/plu/wms/v1_0 | spatial-planning |
| Ruimtelijke plannen enkelbestemming | WMS | service.pdok.nl/kadaster/plu/wms/v1_0 | spatial-planning |
| Ruimtelijke plannen dubbelbestemming | WMS | service.pdok.nl/kadaster/plu/wms/v1_0 | spatial-planning |
| Ruimtelijke plannen totaal | WMS | afnemers.ruimtelijkeplannen.nl | spatial-planning |
| Natura2000 | WMS | service.pdok.nl/rvo/natura2000/wms/v1_0 | nature |
| RIVM geluid alle bronnen | WMS | data.rivm.nl/geo/alo/wms | environment |
| RIVM geluid wegverkeer | WMS | data.rivm.nl/geo/alo/wms | environment |
| RIVM geluid spoor | WMS | data.rivm.nl/geo/alo/wms | environment |
| Risicocontour basisnet | WMS | apps.geodan.nl/public/data/org/gws | risk |
| Risicocontour EV | WMS | apps.geodan.nl/public/data/org/gws | risk |
| Risicocontour EV brand | WMS | apps.geodan.nl/public/data/org/gws | risk |
| Risicocontour EV explosie | WMS | apps.geodan.nl/public/data/org/gws | risk |

**België (EPSG:31370):**

| Laag | Type | URL | Categorie |
|---|---|---|---|
| GRB kadastrale percelen | WFS | geoservices.informatievlaanderen.be | cadastre |
| GRB gebouwen | WFS | geoservices.informatievlaanderen.be | buildings |
| Luchtfoto winter | WMS | geoservices.informatievlaanderen.be | aerial |
| Historische kaart 1846 | WMS | geoservices.informatievlaanderen.be | historical |
| GRB basiskaart | WMS | geoservices.informatievlaanderen.be | basemap |

**Spanje (EPSG:25830):**

| Laag | Type | URL | Categorie |
|---|---|---|---|
| Catastro kadastrale percelen | WFS | ovc.catastro.meh.es | cadastre |

**UK (EPSG:27700):**

| Laag | Type | URL | Categorie |
|---|---|---|---|
| Scotland kadastrale percelen | WMS | ros.datafeed.locationcentre.co.uk | cadastre |

**Globaal:**

| Laag | Type | URL | Categorie |
|---|---|---|---|
| OpenStreetMap | TMS | tile.openstreetmap.org | basemap |
| ESRI World Street Map | TMS | server.arcgisonline.com | basemap |
| ESRI World Topo Map | TMS | server.arcgisonline.com | basemap |
| ESRI World Imagery | TMS | server.arcgisonline.com | aerial |

## 3.3 Dynamische PDOK Lagen Discovery

Naast de voorgedefinieerde lagen ondersteunt de extensie **dynamische discovery** van alle PDOK services, zodat elke laag die in de PDOK Viewer beschikbaar is ook in deze tool gebruikt kan worden.

**PDOK Services API:**
- `https://api.pdok.nl/lv/services/ogc/v1/collections` — OGC API endpoint voor alle beschikbare collections
- `https://www.pdok.nl/datasets` — dataset catalogus
- WMS GetCapabilities per service: `?service=WMS&request=GetCapabilities`
- WFS GetCapabilities per service: `?service=WFS&request=GetCapabilities`

**Workflow:**
1. Bij eerste gebruik of op verzoek: fetch de PDOK catalogus
2. Parse alle beschikbare WMS/WFS services met hun lagen
3. Toon in een doorzoekbare lijst in de wizard
4. Gebruiker kan lagen aan/uit zetten en favorieten opslaan
5. Cache de catalogus lokaal (ververs op verzoek)

**Zoekfunctie:**
- Zoekbalk in stap 2 van de wizard
- Zoekt op laagnaam, service naam, en beschrijving
- Filtert de lagenlijst real-time

**Eigen lagen toevoegen:**
- "Add Custom Layer" knop
- WMS: URL + laagnaam + CRS
- WFS: URL + typename + CRS + output format
- Opgeslagen in gebruiker-instellingen

### 3.4 URL Validatie

Bij eerste gebruik en periodiek:
- Test elke voorgedefinieerde URL met een simpele GetCapabilities request
- Markeer niet-werkende URLs als "offline" (grijze tekst, niet selecteerbaar)
- Toon waarschuwing bij verouderde/gewijzigde endpoints
- Update-suggesties wanneer een redirect gedetecteerd wordt

## 4. Coördinaatsysteem

### 4.1 Conversie

Ingebouwde conversie-functies voor:
- **RD New ↔ WGS84** — 2e orde polynoom (Kadaster-gecertificeerde formules)
- **Belgian Lambert 72 ↔ WGS84** — voor BE lagen
- **ETRS89 / UTM zone 30N ↔ WGS84** — voor ES lagen
- **BNG ↔ WGS84** — voor UK lagen

### 4.2 Intern formaat

- Alle coördinaten worden intern opgeslagen in het **CRS van de bron** (bijv. RD voor NL)
- Canvas-eenheid: **millimeters** (consistent met de app)
- Conversie: broncoördinaten (meters) × 1000 → mm bij import
- Offset: coördinaten worden genormaliseerd t.o.v. het gekozen centrum (bbox center = canvas origin)

## 5. Data Processing

### 5.1 WFS Vector → Shapes

```
WFS GetFeature request (GeoJSON format)
  ↓
Parse GeoJSON FeatureCollection
  ↓
Per Feature:
  - Extract geometry (Polygon, MultiPolygon, LineString, Point)
  - Convert coordinates: CRS meters → canvas mm, offset naar origin
  - Create shapes: PolylineShape (closed voor polygons), PointShape
  - Extract text property (if textField defined)
  - Create TextShape at centroid (UPPERCASE, configured size)
  ↓
Add shapes to drawing on dedicated layer
```

### 5.2 WMS Raster → Image Underlay

```
WMS GetMap request (PNG format, bbox, width×height pixels)
  ↓
Receive PNG image bytes
  ↓
Store as embedded image in project
  ↓
Create ImageShape on drawing:
  - Position: bbox min corner (in canvas mm)
  - Width/height: bbox size (in canvas mm)
  - Image data: embedded PNG
  ↓
Place on dedicated layer (behind vector layers)
```

### 5.3 WMTS/TMS Tiles → Image Underlay

```
Calculate tile indices for bbox at appropriate zoom level
  ↓
Fetch all tiles (parallel requests)
  ↓
Stitch tiles into single image (canvas compositing)
  ↓
Same as WMS: create ImageShape
```

### 5.4 Tekst-annotaties

| Categorie | Bron | Tekstveld | Plaatsing | Default grootte |
|---|---|---|---|---|
| Straatnamen | Kadaster openbare ruimtenaam WFS | `tekst` of `openbareRuimteNaam` | Centroid van lijn/gebied | 5mm |
| Huisnummers | BAG nummeraanduiding WFS | `huisnummer` + `huisletter` | Centroid van verblijfsobject | 2.5mm |
| Perceelnummers | Kadaster percelen WFS | `perceelnummer` | Centroid van perceel | 3mm |

Alle teksten:
- Omgezet naar HOOFDLETTERS (`.toUpperCase()`)
- Geplaatst op het geometrisch zwaartepunt (centroid)
- Op eigen layer ("GIS_Tekst_Straatnamen", "GIS_Tekst_Huisnummers", etc.)
- Instelbare grootte per categorie in stap 2 van de wizard

## 6. Presets

### 6.1 Ingebouwde presets

**Basis Ontwerp (500m):**
- Kadaster percelen + nummeraanduiding + straatnamen
- BAG gebouwen
- Luchtfoto actueel
- Tekst: straatnamen + huisnummers + perceelnummers

**Stedenbouw (2000m):**
- Alles uit Basis Ontwerp
- Ruimtelijke plannen (bouwvlak, enkelbestemming)
- Top10NL wegdeel
- Tekst: straatnamen

**Omgevingscheck (1000m):**
- Kadaster percelen
- RIVM geluid (alle bronnen)
- Risicocontouren (EV, brand, explosie)
- Natura2000
- Tekst: straatnamen + perceelnummers

**Historisch Kadaster:**
- Kadastrale kaart (huidige WMS)
- Topotijdreis historische kaarten (diverse jaren, 1815-2015 via ArcGIS tiles)
- Oude kadastrale minuutplannen (indien beschikbaar via PDOK/WMS)
- Tekst: straatnamen + perceelnummers

### 6.2 Historische kadastrale lagen

De extensie ondersteunt het inladen van **oude kadastrale kaarten** voor vergelijking met de huidige situatie:

- **Topotijdreis** — historische topografische kaarten van 1815 t/m 2015 (via ArcGIS tile service)
- **Kadastrale minuutplannen** — vroeg 19e-eeuwse perceelkaarten (indien beschikbaar via PDOK)
- **Oude luchtfoto's** — PDOK luchtfoto's per jaar (2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, actueel)

Workflow:
1. Gebruiker selecteert "Historisch" preset of kiest individuele historische lagen
2. Jaarselectie dropdown voor Topotijdreis (1815-2015) en luchtfoto's (2016-actueel)
3. Historische lagen worden als aparte image underlays geplaatst op eigen layers
4. Gebruiker kan layers aan/uitzetten om historisch vs huidig te vergelijken

### 6.3 Gebruiker presets

- Opslaan als JSON in project of app settings
- Naam, beschrijving, laag-selectie, bbox grootte, tekst-instellingen

## 7. UI Componenten

### 7.1 GIS Wizard Dialog

Modal dialog met 3 tabs/stappen en Vorige/Volgende/Genereer knoppen.

**Tab 1 — Geolocation:**
- Zoekbalk met autocomplete
- Resultatenlijst
- RD + WGS84 coördinaten display
- Bbox grootte dropdown
- Kaartpreview (optioneel, kan simpele static image zijn)

**Tab 2 — Lagen:**
- Land/regio dropdown (NL, BE, ES, UK, Globaal)
- Categorie-secties (inklapbaar)
- Per laag: checkbox, kleurselector, lijnstype, layer-naam
- Tekst-annotatie toggles met grootte-invoer
- Preset dropdown + opslaan knop
- Custom WMS/WFS toevoegen
- Download progress bar

**Tab 3 — Sheet Setup:**
- Schaal dropdown
- Papierformaat dropdown + orientatie
- Titelblok template dropdown
- Noordpijl en schaalbalk toggles
- Preview (simpele layout-indicatie)
- "Genereer" knop

### 7.2 Losse dialogen

- **WMS Import Dialog** — voor losse WMS laag import zonder wizard
- **WFS Import Dialog** — voor losse WFS laag import zonder wizard
- **Geolocation Dialog** — voor het instellen van projectlocatie zonder import

## 8. Extension Structuur

### 8.1 Registratie

```typescript
// GIS Extension onLoad:
api.ui.addRibbonTab({ id: 'gis', label: 'GIS', order: 30 });

api.ui.addRibbonButton({
  tab: 'GIS', group: 'Import',
  label: 'Kadastrale Tekening',
  onClick: () => openGISWizard(),
  tooltip: 'Import GIS data en genereer kadastrale tekening',
});

api.ui.addRibbonButton({
  tab: 'GIS', group: 'Import',
  label: 'WMS Laag',
  onClick: () => openWMSDialog(),
});

api.ui.addRibbonButton({
  tab: 'GIS', group: 'Import',
  label: 'WFS Laag',
  onClick: () => openWFSDialog(),
});

api.ui.addRibbonButton({
  tab: 'GIS', group: 'Tools',
  label: 'Geolocation',
  onClick: () => openGeolocationDialog(),
});
```

### 8.2 Bestandsstructuur

```
open-2D-studio-GIS-extension/
├── src/
│   ├── index.tsx                    # Extension entry point
│   ├── gis/
│   │   ├── coordinates.ts          # RD↔WGS84, Lambert72↔WGS84 conversie
│   │   ├── geocoding.ts            # PDOK Locatieserver + Nominatim
│   │   ├── wfsClient.ts            # WFS GetFeature → GeoJSON
│   │   ├── wmsClient.ts            # WMS GetMap → PNG image
│   │   ├── wmtsClient.ts           # WMTS tile fetching + stitching
│   │   ├── geoJsonToShapes.ts      # GeoJSON → canvas shapes + tekst
│   │   ├── imageToUnderlay.ts      # PNG → ImageShape placement
│   │   ├── sheetGenerator.ts       # Drawing + sheet + viewport generatie
│   │   └── textAnnotations.ts      # Tekst-annotatie extractie + plaatsing
│   ├── data/
│   │   ├── gis-services.json       # Lagen registry
│   │   └── presets.json            # Ingebouwde presets
│   ├── ui/
│   │   ├── GISWizardDialog.tsx     # 3-staps wizard
│   │   ├── GeolocationPanel.tsx    # Stap 1
│   │   ├── LayerSelectionPanel.tsx  # Stap 2
│   │   ├── SheetSetupPanel.tsx     # Stap 3
│   │   ├── WMSDialog.tsx           # Losse WMS import
│   │   ├── WFSDialog.tsx           # Losse WFS import
│   │   └── GeolocationDialog.tsx   # Losse geolocation
│   └── registrations.ts            # Extension registry calls
├── manifest.json
├── package.json
└── vite.config.ts
```

## 9. Canvas Layer Mapping

Elke GIS bron krijgt een eigen layer in de tekening:

| Layer naam | Kleur | Inhoud |
|---|---|---|
| GIS_Kadaster_Percelen | #FF0000 (rood) | Perceelgrenzen (polylines) |
| GIS_Kadaster_Nummeraanduiding | #FF8800 (oranje) | Adrespunten |
| GIS_BAG_Gebouwen | #00FFFF (cyaan) | Gebouwcontouren |
| GIS_BGT_Wegen | #808080 (grijs) | Wegvlakken |
| GIS_BGT_Water | #0066FF (blauw) | Watervlakken |
| GIS_BGT_Terrein | #00AA00 (groen) | Terreinvlakken |
| GIS_Natura2000 | #228B22 (forestgreen) | Natuurgebieden |
| GIS_Luchtfoto | — | Rasterbeeld |
| GIS_Topografisch | — | Rasterbeeld |
| GIS_Tekst_Straatnamen | #000000 (zwart) | Straatnaam teksten |
| GIS_Tekst_Huisnummers | #333333 (donkergrijs) | Huisnummer teksten |
| GIS_Tekst_Perceelnummers | #CC0000 (donkerrood) | Perceelnummer teksten |
| GIS_Custom_* | User-defined | Custom lagen |
