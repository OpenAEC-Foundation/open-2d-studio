# GIS Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a GIS Extension for Open 2D Studio that imports cadastral data, aerial photos, and vector/raster layers from Dutch PDOK, Belgian, Spanish, UK, and global GIS services — with a 3-step wizard that generates a complete sheet with title block at the correct scale.

**Architecture:** A new extension project (`open-2D-studio-GIS-extension`) following the AEC extension pattern. Core GIS modules handle coordinate conversion (RD↔WGS84), geocoding (PDOK + Nominatim), WFS vector fetching (→ polylines + text annotations), and WMS/WMTS raster fetching (→ image underlays). A data-driven `gis-services.json` registry defines all available layers. A React wizard dialog guides the user through geolocation → layer selection (with live preview) → sheet generation.

**Tech Stack:** TypeScript, React, Vite (CJS library build), Open 2D Studio Extension SDK, Tauri HTTP plugin (for API calls)

**Spec:** `docs/superpowers/specs/2026-04-14-gis-extension-design.md`

---

## File Map

All files live in a new repo: `C:\Users\rickd\Documents\GitHub\open-2D-studio-GIS-extension\`

### New Files

| File | Responsibility |
|---|---|
| `package.json` | Project config, scripts, dependencies |
| `tsconfig.json` | TypeScript config with SDK path alias |
| `vite.config.ts` | CJS library build + auto-deploy to extensions/gis |
| `manifest.json` | Extension metadata |
| `src/index.tsx` | Extension entry point (onLoad/onUnload) |
| `src/registrations.ts` | Ribbon tab + button registrations |
| `src/gis/coordinates.ts` | RD↔WGS84 polynomial conversion |
| `src/gis/geocoding.ts` | PDOK Locatieserver + Nominatim geocoding |
| `src/gis/wfsClient.ts` | WFS GetFeature → GeoJSON |
| `src/gis/wmsClient.ts` | WMS GetMap → PNG image bytes |
| `src/gis/wmtsClient.ts` | WMTS/TMS tile fetching + stitching |
| `src/gis/geoJsonToShapes.ts` | GeoJSON features → polyline/text shapes |
| `src/gis/textAnnotations.ts` | Text extraction + UPPERCASE + centroid placement |
| `src/gis/sheetGenerator.ts` | Drawing + layers + sheet + viewport creation |
| `src/gis/pdokDiscovery.ts` | Dynamic PDOK GetCapabilities layer discovery |
| `src/data/gis-services.json` | Predefined layer registry (40+ layers) |
| `src/data/presets.json` | Built-in presets (Basis Ontwerp, Stedenbouw, etc.) |
| `src/ui/GISWizardDialog.tsx` | 3-step wizard modal |
| `src/ui/GeolocationPanel.tsx` | Step 1: address search + map preview |
| `src/ui/LayerSelectionPanel.tsx` | Step 2: layer checkboxes + live preview + text config |
| `src/ui/SheetSetupPanel.tsx` | Step 3: scale + paper + title block |
| `src/ui/MapPreview.tsx` | Canvas-based map preview with WMS/WFS overlay |
| `src/ui/WMSDialog.tsx` | Standalone WMS import dialog |
| `src/ui/WFSDialog.tsx` | Standalone WFS import dialog |
| `src/__tests__/coordinates.test.ts` | Coordinate conversion tests |
| `src/__tests__/geoJsonToShapes.test.ts` | GeoJSON → shapes tests |
| `src/__tests__/textAnnotations.test.ts` | Text annotation tests |

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `manifest.json`, `src/index.tsx`, `src/registrations.ts`

- [ ] **Step 1: Create the project directory and initialize**

```bash
mkdir -p C:/Users/rickd/Documents/GitHub/open-2D-studio-GIS-extension/src
cd C:/Users/rickd/Documents/GitHub/open-2D-studio-GIS-extension
git init
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "open-2d-studio-gis-extension",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^25.3.3",
    "@types/react": "^19.2.14",
    "@vitejs/plugin-react": "^5.1.4",
    "lucide-react": "^0.577.0",
    "typescript": "^5.9.3",
    "vite": "^7.3.1",
    "vitest": "^4.0.18"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": {
      "open-2d-studio": ["../open-2d-studio/src/extensionSdk"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

function autoDeploy() {
  const appData = process.env.APPDATA;
  if (!appData) return { name: 'auto-deploy' };
  const targetDir = path.join(appData, 'com.open2dstudio.app', 'extensions', 'gis');
  return {
    name: 'auto-deploy',
    closeBundle() {
      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
      copyFileSync(path.resolve(__dirname, 'dist/main.js'), path.join(targetDir, 'main.js'));
      copyFileSync(path.resolve(__dirname, 'manifest.json'), path.join(targetDir, 'manifest.json'));
      console.log(`\n  ✓ Deployed GIS extension to ${targetDir}\n`);
    },
  };
}

export default defineConfig({
  plugins: [react(), autoDeploy()],
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.tsx'),
      formats: ['cjs'],
      fileName: () => 'main.js',
    },
    rollupOptions: {
      external: ['open-2d-studio', 'react', 'react/jsx-runtime', 'lucide-react'],
    },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
  },
});
```

- [ ] **Step 5: Create manifest.json**

```json
{
  "id": "gis",
  "name": "GIS (Geographic Information System)",
  "version": "0.1.0",
  "minAppVersion": "0.35.0",
  "author": "OpenAEC Foundation",
  "description": "Import cadastral data, aerial photos, and GIS layers from PDOK, BAG, BGT, Kadaster, and international WMS/WFS services. Generate cadastral drawings on sheets.",
  "category": "GIS",
  "main": "main.js",
  "permissions": ["commands", "ribbon", "events", "network"],
  "tags": ["gis", "kadaster", "pdok", "bag", "bgt", "wms", "wfs", "cadastre"]
}
```

- [ ] **Step 6: Create src/registrations.ts**

```typescript
// src/registrations.ts

let wizardOpenFn: (() => void) | null = null;
let wmsOpenFn: (() => void) | null = null;
let wfsOpenFn: (() => void) | null = null;
let geoOpenFn: (() => void) | null = null;

export function setWizardOpener(fn: () => void) { wizardOpenFn = fn; }
export function setWmsOpener(fn: () => void) { wmsOpenFn = fn; }
export function setWfsOpener(fn: () => void) { wfsOpenFn = fn; }
export function setGeoOpener(fn: () => void) { geoOpenFn = fn; }

export function registerGISExtension(api: any): void {
  api.ui.addRibbonTab({ id: 'gis', label: 'GIS', order: 30 });

  api.ui.addRibbonButton({
    tab: 'GIS',
    group: 'Import',
    label: 'Kadastrale Tekening',
    onClick: () => wizardOpenFn?.(),
    tooltip: 'Import GIS data en genereer kadastrale tekening',
  });

  api.ui.addRibbonButton({
    tab: 'GIS',
    group: 'Import',
    label: 'WMS Laag',
    onClick: () => wmsOpenFn?.(),
    tooltip: 'Importeer een WMS rasterlaag',
  });

  api.ui.addRibbonButton({
    tab: 'GIS',
    group: 'Import',
    label: 'WFS Laag',
    onClick: () => wfsOpenFn?.(),
    tooltip: 'Importeer een WFS vectorlaag',
  });

  api.ui.addRibbonButton({
    tab: 'GIS',
    group: 'Tools',
    label: 'Geolocation',
    onClick: () => geoOpenFn?.(),
    tooltip: 'Stel projectlocatie in',
  });
}

export function unregisterGISExtension(): void {
  wizardOpenFn = null;
  wmsOpenFn = null;
  wfsOpenFn = null;
  geoOpenFn = null;
}
```

- [ ] **Step 7: Create src/index.tsx**

```typescript
// src/index.tsx
import { registerGISExtension, unregisterGISExtension } from './registrations';

const gisExtension = {
  onLoad(api: any) {
    registerGISExtension(api);
    console.log('[GIS] Extension loaded');
  },
  onUnload() {
    unregisterGISExtension();
    console.log('[GIS] Extension unloaded');
  },
};

export default gisExtension;
if (typeof module !== 'undefined') {
  module.exports = gisExtension;
}
```

- [ ] **Step 8: Install dependencies and verify build**

```bash
cd C:/Users/rickd/Documents/GitHub/open-2D-studio-GIS-extension
npm install
npm run build
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(gis): scaffold GIS extension project"
```

---

## Task 2: Coordinate Conversion

**Files:**
- Create: `src/gis/coordinates.ts`
- Create: `src/__tests__/coordinates.test.ts`

- [ ] **Step 1: Write failing coordinate tests**

```typescript
// src/__tests__/coordinates.test.ts
import { describe, it, expect } from 'vitest';
import { rdToWgs84, wgs84ToRd } from '../gis/coordinates';

describe('coordinates', () => {
  // Reference point: Amersfoort (origin of RD)
  // RD: 155000, 463000 → WGS84: 52.15517, 5.38721

  describe('rdToWgs84', () => {
    it('converts Amersfoort origin', () => {
      const [lat, lon] = rdToWgs84(155000, 463000);
      expect(lat).toBeCloseTo(52.1551, 3);
      expect(lon).toBeCloseTo(5.3872, 3);
    });

    it('converts Amsterdam Central', () => {
      // RD: ~121688, ~487484 → WGS84: ~52.3791, ~4.9003
      const [lat, lon] = rdToWgs84(121688, 487484);
      expect(lat).toBeCloseTo(52.379, 2);
      expect(lon).toBeCloseTo(4.900, 2);
    });

    it('converts Rotterdam Erasmusbrug', () => {
      // RD: ~92400, ~437700 → WGS84: ~51.909, ~4.488
      const [lat, lon] = rdToWgs84(92400, 437700);
      expect(lat).toBeCloseTo(51.91, 1);
      expect(lon).toBeCloseTo(4.49, 1);
    });
  });

  describe('wgs84ToRd', () => {
    it('converts Amersfoort origin back', () => {
      const [x, y] = wgs84ToRd(52.15517, 5.38721);
      expect(x).toBeCloseTo(155000, -1);
      expect(y).toBeCloseTo(463000, -1);
    });

    it('round-trips Amsterdam Central', () => {
      const [lat, lon] = rdToWgs84(121688, 487484);
      const [x, y] = wgs84ToRd(lat, lon);
      expect(x).toBeCloseTo(121688, 0);
      expect(y).toBeCloseTo(487484, 0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/coordinates.test.ts`

- [ ] **Step 3: Implement coordinate conversion**

```typescript
// src/gis/coordinates.ts

// Kadaster-certified 2nd order polynomial approximation
// Source: https://www.kadaster.nl/zakelijk/registraties/basisregistraties/rijksdriehoeksmeting

const X0 = 155000.0;
const Y0 = 463000.0;
const PHI0 = 52.15517440;
const LAM0 = 5.38720621;

const KP = [
  [0, 1, 3235.65389],
  [2, 0, -32.58297],
  [0, 2, -0.24750],
  [2, 1, -0.84978],
  [0, 3, -0.06550],
  [2, 2, -0.01709],
  [1, 0, -0.00738],
  [4, 0, 0.00530],
  [2, 3, -0.00039],
  [4, 1, 0.00033],
  [1, 1, -0.00012],
];

const KQ = [
  [1, 0, 5260.52916],
  [1, 1, 105.94684],
  [1, 2, 2.45656],
  [3, 0, -0.81885],
  [1, 3, 0.05594],
  [3, 1, -0.05607],
  [0, 1, 0.01199],
  [3, 2, -0.00256],
  [1, 4, 0.00128],
  [0, 2, 0.00022],
  [2, 0, -0.00022],
  [5, 0, 0.00026],
];

const KR = [
  [0, 1, 190094.945],
  [1, 1, -11832.228],
  [2, 1, -114.221],
  [0, 3, -32.391],
  [1, 0, -0.705],
  [3, 1, -2.340],
  [1, 3, -0.608],
  [0, 2, -0.008],
  [2, 3, 0.148],
];

const KS = [
  [1, 0, 309056.544],
  [0, 2, 3638.893],
  [2, 0, 73.077],
  [1, 2, -157.984],
  [3, 0, 59.788],
  [0, 1, 0.433],
  [2, 2, -6.439],
  [1, 1, -0.032],
  [0, 4, 0.092],
  [1, 4, -0.054],
];

export function rdToWgs84(x: number, y: number): [number, number] {
  const dx = (x - X0) * 1e-5;
  const dy = (y - Y0) * 1e-5;

  let lat = 0;
  for (const [p, q, coeff] of KP) {
    lat += coeff * dx ** p * dy ** q;
  }
  lat = PHI0 + lat / 3600;

  let lon = 0;
  for (const [p, q, coeff] of KQ) {
    lon += coeff * dx ** p * dy ** q;
  }
  lon = LAM0 + lon / 3600;

  return [lat, lon];
}

export function wgs84ToRd(lat: number, lon: number): [number, number] {
  const dlat = 0.36 * (lat - PHI0);
  const dlon = 0.36 * (lon - LAM0);

  let x = 0;
  for (const [p, q, coeff] of KR) {
    x += coeff * dlat ** p * dlon ** q;
  }
  x = X0 + x;

  let y = 0;
  for (const [p, q, coeff] of KS) {
    y += coeff * dlat ** p * dlon ** q;
  }
  y = Y0 + y;

  return [x, y];
}

/**
 * Convert RD meters to canvas millimeters, offset from center.
 */
export function rdToCanvas(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
): { x: number; y: number } {
  return {
    x: (x - centerX) * 1000,
    y: (centerY - y) * 1000, // Y inverted: RD Y+ is north, canvas Y+ is down
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/coordinates.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/gis/coordinates.ts src/__tests__/coordinates.test.ts
git commit -m "feat(gis): add RD↔WGS84 coordinate conversion"
```

---

## Task 3: Geocoding Service

**Files:**
- Create: `src/gis/geocoding.ts`

- [ ] **Step 1: Implement geocoding**

```typescript
// src/gis/geocoding.ts

export interface GeocodingResult {
  displayName: string;
  lat: number;
  lon: number;
  rdX?: number;
  rdY?: number;
  type: string;
  source: 'pdok' | 'nominatim';
}

/**
 * Search via PDOK Locatieserver (Netherlands only).
 * Returns results with RD coordinates.
 */
export async function searchPDOK(query: string): Promise<GeocodingResult[]> {
  const url = `https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=${encodeURIComponent(query)}&rows=10`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`PDOK search failed: ${response.status}`);

  const data = await response.json();
  const docs = data.response?.docs || [];

  return docs.map((doc: any) => {
    // centroide_rd is "POINT(x y)"
    const rdMatch = doc.centroide_rd?.match(/POINT\((\S+)\s+(\S+)\)/);
    const llMatch = doc.centroide_ll?.match(/POINT\((\S+)\s+(\S+)\)/);

    return {
      displayName: doc.weergavenaam || doc.tekst || query,
      lat: llMatch ? parseFloat(llMatch[2]) : 0,
      lon: llMatch ? parseFloat(llMatch[1]) : 0,
      rdX: rdMatch ? parseFloat(rdMatch[1]) : undefined,
      rdY: rdMatch ? parseFloat(rdMatch[2]) : undefined,
      type: doc.type || 'unknown',
      source: 'pdok' as const,
    };
  });
}

/**
 * Search via Nominatim (OpenStreetMap) for international addresses.
 */
export async function searchNominatim(query: string): Promise<GeocodingResult[]> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=10&addressdetails=1`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Open2DStudio-GIS/0.1' },
  });
  if (!response.ok) throw new Error(`Nominatim search failed: ${response.status}`);

  const data = await response.json();

  return data.map((item: any) => ({
    displayName: item.display_name,
    lat: parseFloat(item.lat),
    lon: parseFloat(item.lon),
    type: item.type || 'unknown',
    source: 'nominatim' as const,
  }));
}

/**
 * Smart search: try PDOK first (for NL), fallback to Nominatim.
 */
export async function geocode(query: string): Promise<GeocodingResult[]> {
  try {
    const pdokResults = await searchPDOK(query);
    if (pdokResults.length > 0) return pdokResults;
  } catch {
    // PDOK failed, try Nominatim
  }

  return searchNominatim(query);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/gis/geocoding.ts
git commit -m "feat(gis): add PDOK + Nominatim geocoding"
```

---

## Task 4: WFS Client

**Files:**
- Create: `src/gis/wfsClient.ts`

- [ ] **Step 1: Implement WFS client**

```typescript
// src/gis/wfsClient.ts

export type SpatialFilter = 'intersects' | 'contains';

export interface WFSRequestParams {
  url: string;
  typeName: string;
  bbox: [number, number, number, number]; // [minX, minY, maxX, maxY]
  crs: string;
  outputFormat?: string;
  spatialFilter?: SpatialFilter;
  maxFeatures?: number;
}

export interface WFSFeatureCollection {
  type: 'FeatureCollection';
  features: WFSFeature[];
}

export interface WFSFeature {
  type: 'Feature';
  geometry: GeoJSONGeometry;
  properties: Record<string, any>;
}

export type GeoJSONGeometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'Polygon'; coordinates: [number, number][][] }
  | { type: 'MultiPolygon'; coordinates: [number, number][][][] }
  | { type: 'MultiLineString'; coordinates: [number, number][][] }
  | { type: 'MultiPoint'; coordinates: [number, number][] };

/**
 * Build a WFS GetFeature URL with bbox filter.
 */
function buildWFSUrl(params: WFSRequestParams): string {
  const { url, typeName, bbox, crs, outputFormat, spatialFilter, maxFeatures } = params;
  const format = outputFormat || 'application/json';
  const [minX, minY, maxX, maxY] = bbox;

  // Use BBOX or Filter depending on spatial filter type
  const bboxStr = `${minX},${minY},${maxX},${maxY},${crs}`;

  const queryParams = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeName,
    outputFormat: format,
    srsName: crs,
    count: String(maxFeatures || 10000),
  });

  if (spatialFilter === 'contains') {
    // Use CQL_FILTER for WITHIN
    queryParams.set('CQL_FILTER', `WITHIN(geometry, ENVELOPE(${minX},${maxX},${maxY},${minY}))`);
  } else {
    // Default: BBOX (intersects)
    queryParams.set('bbox', bboxStr);
  }

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${queryParams.toString()}`;
}

/**
 * Fetch WFS features as GeoJSON.
 * Includes retry logic (3 attempts with backoff).
 */
export async function fetchWFSFeatures(
  params: WFSRequestParams,
  onProgress?: (message: string) => void,
): Promise<WFSFeatureCollection> {
  const url = buildWFSUrl(params);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      onProgress?.(`Fetching ${params.typeName} (attempt ${attempt}/3)...`);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`WFS request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Handle different WFS response formats
      if (data.type === 'FeatureCollection') {
        onProgress?.(`Received ${data.features?.length || 0} features from ${params.typeName}`);
        return data as WFSFeatureCollection;
      }

      // Some WFS services wrap features differently
      if (data.features) {
        return { type: 'FeatureCollection', features: data.features };
      }

      return { type: 'FeatureCollection', features: [] };
    } catch (e) {
      lastError = e as Error;
      if (attempt < 3) {
        const delay = attempt * 1000;
        onProgress?.(`Retry in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError || new Error('WFS request failed after 3 attempts');
}

/**
 * Fetch WFS features for live preview (low resolution, small bbox).
 */
export async function fetchWFSPreview(
  params: WFSRequestParams,
): Promise<WFSFeatureCollection> {
  return fetchWFSFeatures({ ...params, maxFeatures: 500 });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/gis/wfsClient.ts
git commit -m "feat(gis): add WFS client with bbox/contains filter and retry logic"
```

---

## Task 5: WMS Client

**Files:**
- Create: `src/gis/wmsClient.ts`

- [ ] **Step 1: Implement WMS client**

```typescript
// src/gis/wmsClient.ts

export interface WMSRequestParams {
  url: string;
  layers: string;
  bbox: [number, number, number, number];
  crs: string;
  width?: number;
  height?: number;
  imageFormat?: string;
}

/**
 * Build a WMS GetMap URL.
 */
function buildWMSUrl(params: WMSRequestParams): string {
  const { url, layers, bbox, crs, width, height, imageFormat } = params;
  const [minX, minY, maxX, maxY] = bbox;
  const bboxWidth = maxX - minX;
  const bboxHeight = maxY - minY;
  const pixWidth = width || 3000;
  const pixHeight = height || Math.round(pixWidth * (bboxHeight / bboxWidth));

  const queryParams = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers,
    crs,
    bbox: `${minX},${minY},${maxX},${maxY}`,
    width: String(pixWidth),
    height: String(pixHeight),
    format: imageFormat || 'image/png',
    transparent: 'true',
  });

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${queryParams.toString()}`;
}

/**
 * Fetch a WMS GetMap image as a data URL.
 * Returns base64 data URL ready for embedding.
 */
export async function fetchWMSImage(
  params: WMSRequestParams,
  onProgress?: (message: string) => void,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const url = buildWMSUrl(params);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      onProgress?.(`Fetching WMS ${params.layers} (attempt ${attempt}/3)...`);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`WMS request failed: ${response.status}`);
      }

      const blob = await response.blob();
      const dataUrl = await blobToDataUrl(blob);

      const bboxWidth = params.bbox[2] - params.bbox[0];
      const bboxHeight = params.bbox[3] - params.bbox[1];
      const pixWidth = params.width || 3000;
      const pixHeight = params.height || Math.round(pixWidth * (bboxHeight / bboxWidth));

      onProgress?.(`WMS ${params.layers} loaded (${pixWidth}×${pixHeight})`);
      return { dataUrl, width: pixWidth, height: pixHeight };
    } catch (e) {
      lastError = e as Error;
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, attempt * 1000));
      }
    }
  }

  throw lastError || new Error('WMS request failed after 3 attempts');
}

/**
 * Fetch a low-resolution preview image for the wizard.
 */
export async function fetchWMSPreview(
  params: WMSRequestParams,
): Promise<{ dataUrl: string; width: number; height: number }> {
  return fetchWMSImage({ ...params, width: 800 });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Build a WMS GetCapabilities URL for layer discovery.
 */
export function buildGetCapabilitiesUrl(baseUrl: string): string {
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}service=WMS&request=GetCapabilities`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/gis/wmsClient.ts
git commit -m "feat(gis): add WMS client with GetMap and preview support"
```

---

## Task 6: GeoJSON → Shapes Converter

**Files:**
- Create: `src/gis/geoJsonToShapes.ts`
- Create: `src/gis/textAnnotations.ts`
- Create: `src/__tests__/geoJsonToShapes.test.ts`
- Create: `src/__tests__/textAnnotations.test.ts`

- [ ] **Step 1: Write failing GeoJSON tests**

```typescript
// src/__tests__/geoJsonToShapes.test.ts
import { describe, it, expect } from 'vitest';
import { geoJsonToShapes } from '../gis/geoJsonToShapes';
import type { WFSFeatureCollection } from '../gis/wfsClient';

describe('geoJsonToShapes', () => {
  const centerX = 155000;
  const centerY = 463000;

  it('converts a Polygon to a closed polyline', () => {
    const fc: WFSFeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[[155000, 463000], [155100, 463000], [155100, 463100], [155000, 463100], [155000, 463000]]],
        },
        properties: {},
      }],
    };

    const shapes = geoJsonToShapes(fc, centerX, centerY, '#FF0000', 'solid', 1, 'test-layer', 'test-drawing');
    expect(shapes.length).toBeGreaterThan(0);
    expect(shapes[0].type).toBe('polyline');
    expect((shapes[0] as any).closed).toBe(true);
  });

  it('converts coordinates from RD meters to canvas mm with offset', () => {
    const fc: WFSFeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[[155100, 463050], [155200, 463050], [155200, 463150], [155100, 463150], [155100, 463050]]],
        },
        properties: {},
      }],
    };

    const shapes = geoJsonToShapes(fc, centerX, centerY, '#FF0000', 'solid', 1, 'test-layer', 'test-drawing');
    const polyline = shapes[0] as any;
    // 155100 - 155000 = 100m = 100000mm
    expect(polyline.points[0].x).toBeCloseTo(100000);
    // 463050 - 463000 = 50m, inverted Y: -50000mm
    expect(polyline.points[0].y).toBeCloseTo(-50000);
  });

  it('handles MultiPolygon', () => {
    const fc: WFSFeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [[[155000, 463000], [155050, 463000], [155050, 463050], [155000, 463050], [155000, 463000]]],
            [[[155100, 463100], [155150, 463100], [155150, 463150], [155100, 463150], [155100, 463100]]],
          ],
        },
        properties: {},
      }],
    };

    const shapes = geoJsonToShapes(fc, centerX, centerY, '#FF0000', 'solid', 1, 'test-layer', 'test-drawing');
    expect(shapes.length).toBe(2); // Two polylines
  });

  it('returns empty array for empty feature collection', () => {
    const fc: WFSFeatureCollection = { type: 'FeatureCollection', features: [] };
    const shapes = geoJsonToShapes(fc, centerX, centerY, '#FF0000', 'solid', 1, 'l', 'd');
    expect(shapes).toEqual([]);
  });
});
```

- [ ] **Step 2: Write failing text annotation tests**

```typescript
// src/__tests__/textAnnotations.test.ts
import { describe, it, expect } from 'vitest';
import { extractTextAnnotations } from '../gis/textAnnotations';
import type { WFSFeatureCollection } from '../gis/wfsClient';

describe('textAnnotations', () => {
  const centerX = 155000;
  const centerY = 463000;

  it('extracts text from features and places at centroid in UPPERCASE', () => {
    const fc: WFSFeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[[155000, 463000], [155100, 463000], [155100, 463100], [155000, 463100], [155000, 463000]]],
        },
        properties: { tekst: 'Kerkstraat' },
      }],
    };

    const texts = extractTextAnnotations(fc, 'tekst', centerX, centerY, 5, 'text-layer', 'test-drawing');
    expect(texts).toHaveLength(1);
    expect((texts[0] as any).text).toBe('KERKSTRAAT');
  });

  it('skips features without the text field', () => {
    const fc: WFSFeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [155050, 463050] },
        properties: { naam: 'Test' },
      }],
    };

    const texts = extractTextAnnotations(fc, 'tekst', centerX, centerY, 5, 'l', 'd');
    expect(texts).toHaveLength(0);
  });

  it('combines multiple text fields (huisnummer + huisletter)', () => {
    const fc: WFSFeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [155050, 463050] },
        properties: { huisnummer: '42', huisletter: 'A' },
      }],
    };

    const texts = extractTextAnnotations(fc, 'huisnummer+huisletter', centerX, centerY, 2.5, 'l', 'd');
    expect(texts).toHaveLength(1);
    expect((texts[0] as any).text).toBe('42A');
  });
});
```

- [ ] **Step 3: Implement geoJsonToShapes**

```typescript
// src/gis/geoJsonToShapes.ts
import type { WFSFeatureCollection, GeoJSONGeometry } from './wfsClient';
import { rdToCanvas } from './coordinates';

function generateId(): string {
  return `gis_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function convertRing(
  ring: [number, number][],
  centerX: number,
  centerY: number,
): { x: number; y: number }[] {
  return ring.map(([x, y]) => rdToCanvas(x, y, centerX, centerY));
}

function polygonToShape(
  rings: [number, number][][],
  centerX: number,
  centerY: number,
  color: string,
  lineStyle: string,
  lineWidth: number,
  layerId: string,
  drawingId: string,
): any {
  // First ring is exterior, rest are holes (ignored for now)
  const points = convertRing(rings[0], centerX, centerY);
  return {
    id: generateId(),
    type: 'polyline',
    points,
    closed: true,
    bulges: new Array(points.length).fill(0),
    style: {
      strokeColor: color,
      strokeWidth: lineWidth,
      lineStyle,
    },
    layerId,
    drawingId,
    visible: true,
    locked: false,
  };
}

function geometryToShapes(
  geometry: GeoJSONGeometry,
  centerX: number,
  centerY: number,
  color: string,
  lineStyle: string,
  lineWidth: number,
  layerId: string,
  drawingId: string,
): any[] {
  switch (geometry.type) {
    case 'Polygon':
      return [polygonToShape(geometry.coordinates, centerX, centerY, color, lineStyle, lineWidth, layerId, drawingId)];

    case 'MultiPolygon':
      return geometry.coordinates.map(rings =>
        polygonToShape(rings, centerX, centerY, color, lineStyle, lineWidth, layerId, drawingId)
      );

    case 'LineString': {
      const points = convertRing(geometry.coordinates, centerX, centerY);
      return [{
        id: generateId(),
        type: 'polyline',
        points,
        closed: false,
        bulges: new Array(points.length).fill(0),
        style: { strokeColor: color, strokeWidth: lineWidth, lineStyle },
        layerId, drawingId, visible: true, locked: false,
      }];
    }

    case 'MultiLineString':
      return geometry.coordinates.map(coords => {
        const points = convertRing(coords, centerX, centerY);
        return {
          id: generateId(),
          type: 'polyline',
          points,
          closed: false,
          bulges: new Array(points.length).fill(0),
          style: { strokeColor: color, strokeWidth: lineWidth, lineStyle },
          layerId, drawingId, visible: true, locked: false,
        };
      });

    case 'Point': {
      const pos = rdToCanvas(geometry.coordinates[0], geometry.coordinates[1], centerX, centerY);
      return [{
        id: generateId(),
        type: 'point',
        position: pos,
        style: { strokeColor: color, strokeWidth: lineWidth, lineStyle },
        layerId, drawingId, visible: true, locked: false,
      }];
    }

    case 'MultiPoint':
      return geometry.coordinates.map(([x, y]) => {
        const pos = rdToCanvas(x, y, centerX, centerY);
        return {
          id: generateId(),
          type: 'point',
          position: pos,
          style: { strokeColor: color, strokeWidth: lineWidth, lineStyle },
          layerId, drawingId, visible: true, locked: false,
        };
      });

    default:
      return [];
  }
}

export function geoJsonToShapes(
  featureCollection: WFSFeatureCollection,
  centerX: number,
  centerY: number,
  color: string,
  lineStyle: string,
  lineWidth: number,
  layerId: string,
  drawingId: string,
): any[] {
  const shapes: any[] = [];
  for (const feature of featureCollection.features) {
    if (!feature.geometry) continue;
    shapes.push(...geometryToShapes(
      feature.geometry, centerX, centerY, color, lineStyle, lineWidth, layerId, drawingId
    ));
  }
  return shapes;
}
```

- [ ] **Step 4: Implement textAnnotations**

```typescript
// src/gis/textAnnotations.ts
import type { WFSFeatureCollection, GeoJSONGeometry } from './wfsClient';
import { rdToCanvas } from './coordinates';

function generateId(): string {
  return `gist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Calculate centroid of a geometry.
 */
function getCentroid(geometry: GeoJSONGeometry): [number, number] | null {
  switch (geometry.type) {
    case 'Point':
      return geometry.coordinates;
    case 'Polygon': {
      const ring = geometry.coordinates[0];
      let cx = 0, cy = 0;
      for (const [x, y] of ring) { cx += x; cy += y; }
      return [cx / ring.length, cy / ring.length];
    }
    case 'MultiPolygon': {
      // Use first polygon centroid
      const ring = geometry.coordinates[0][0];
      let cx = 0, cy = 0;
      for (const [x, y] of ring) { cx += x; cy += y; }
      return [cx / ring.length, cy / ring.length];
    }
    case 'LineString': {
      const mid = Math.floor(geometry.coordinates.length / 2);
      return geometry.coordinates[mid];
    }
    default:
      return null;
  }
}

/**
 * Extract text value from feature properties.
 * Supports combined fields: "huisnummer+huisletter" → "42A"
 */
function extractText(properties: Record<string, any>, textField: string): string | null {
  if (textField.includes('+')) {
    const fields = textField.split('+');
    const parts = fields
      .map(f => properties[f.trim()])
      .filter(v => v != null && v !== '');
    return parts.length > 0 ? parts.join('') : null;
  }

  const value = properties[textField];
  if (value == null || value === '') return null;
  return String(value);
}

/**
 * Extract text annotations from WFS features.
 * Text is always UPPERCASE.
 */
export function extractTextAnnotations(
  featureCollection: WFSFeatureCollection,
  textField: string,
  centerX: number,
  centerY: number,
  textHeight: number,
  layerId: string,
  drawingId: string,
): any[] {
  const textShapes: any[] = [];

  for (const feature of featureCollection.features) {
    if (!feature.geometry || !feature.properties) continue;

    const text = extractText(feature.properties, textField);
    if (!text) continue;

    const centroid = getCentroid(feature.geometry);
    if (!centroid) continue;

    const pos = rdToCanvas(centroid[0], centroid[1], centerX, centerY);

    textShapes.push({
      id: generateId(),
      type: 'text',
      position: pos,
      text: text.toUpperCase(),
      height: textHeight,
      rotation: 0,
      style: {
        strokeColor: '#000000',
        strokeWidth: 1,
        lineStyle: 'solid',
      },
      layerId,
      drawingId,
      visible: true,
      locked: false,
    });
  }

  return textShapes;
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run`

- [ ] **Step 6: Commit**

```bash
git add src/gis/geoJsonToShapes.ts src/gis/textAnnotations.ts src/__tests__/geoJsonToShapes.test.ts src/__tests__/textAnnotations.test.ts
git commit -m "feat(gis): add GeoJSON→shapes converter and text annotations"
```

---

## Task 7: Sheet Generator

**Files:**
- Create: `src/gis/sheetGenerator.ts`

- [ ] **Step 1: Implement sheet generator**

This module uses the Open 2D Studio extension SDK to create drawings, layers, sheets, and viewports.

```typescript
// src/gis/sheetGenerator.ts

export interface SheetConfig {
  drawingName: string;
  scale: number;               // e.g., 500 for 1:500
  paperWidth: number;          // mm
  paperHeight: number;         // mm
  titleBlockTemplate?: string;
  showNorthArrow: boolean;
  showScaleBar: boolean;
  address?: string;
  rdX?: number;
  rdY?: number;
}

export interface GISLayerConfig {
  name: string;
  color: string;
  lineStyle: string;
  lineWidth: number;
}

/**
 * Create a drawing with GIS layers and a sheet with viewport.
 * Uses the extension SDK (available as window.__open2dStudioSdk).
 */
export function generateSheet(
  config: SheetConfig,
  layerConfigs: GISLayerConfig[],
): {
  drawingId: string;
  sheetId: string;
  layerIds: Record<string, string>;
} {
  const sdk = (window as any).__open2dStudioSdk;
  if (!sdk) throw new Error('Open 2D Studio SDK not available');

  const store = sdk.useAppStore?.getState?.() || (window as any).useAppStore?.getState?.();
  if (!store) throw new Error('App store not available');

  // 1. Create a new drawing
  const drawingId = store.addDrawingSilent?.(config.drawingName, 'plan') || 'default';

  // 2. Create layers for each GIS source
  const layerIds: Record<string, string> = {};
  for (const lc of layerConfigs) {
    const layerId = `gis_layer_${lc.name.replace(/\s+/g, '_').toLowerCase()}_${Date.now()}`;
    store.addLayer?.({
      id: layerId,
      name: lc.name,
      color: lc.color,
      visible: true,
      locked: false,
      lineStyle: lc.lineStyle,
    });
    layerIds[lc.name] = layerId;
  }

  // 3. Create a sheet
  const sheetId = `gis_sheet_${Date.now()}`;
  store.addSheet?.({
    id: sheetId,
    name: config.drawingName,
    width: config.paperWidth,
    height: config.paperHeight,
    titleBlockTemplate: config.titleBlockTemplate,
  });

  // 4. Add viewport to sheet with the correct scale
  store.addViewportToSheet?.(sheetId, {
    drawingId,
    scale: 1 / config.scale,
    centerX: 0,
    centerY: 0,
    width: config.paperWidth * 0.85, // Leave margin for title block
    height: config.paperHeight * 0.85,
  });

  return { drawingId, sheetId, layerIds };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/gis/sheetGenerator.ts
git commit -m "feat(gis): add sheet generator for automatic drawing+sheet creation"
```

---

## Task 8: GIS Services Registry (JSON)

**Files:**
- Create: `src/data/gis-services.json`
- Create: `src/data/presets.json`

- [ ] **Step 1: Create the services registry**

Create `src/data/gis-services.json` with all 40+ layers from the spec. This is a large JSON file — include all NL, BE, ES, UK, and global layers with correct URLs, type names, CRS codes, colors, and text field mappings.

For each layer entry follow this structure:
```json
{
  "id": "nl_kadaster_percelen",
  "name": "Kadaster Percelen",
  "country": "NL",
  "category": "cadastre",
  "type": "wfs",
  "url": "https://service.pdok.nl/kadaster/kadastralekaart/wfs/v5_0",
  "crs": "EPSG:28992",
  "typeName": "kadastralekaartv5:perceel",
  "outputFormat": "application/json",
  "defaultColor": "#FF0000",
  "defaultLineStyle": "solid",
  "defaultLineWidth": 1,
  "defaultVisible": true,
  "textField": "perceelnummer",
  "textPlacement": "centroid",
  "textCategory": "perceelnummer"
}
```

Include historical layers:
- Topotijdreis tiles (multiple years)
- Old aerial photos per year (2016-2023)

- [ ] **Step 2: Create presets**

Create `src/data/presets.json`:
```json
{
  "presets": [
    {
      "id": "basis_ontwerp",
      "name": "Basis Ontwerp",
      "description": "Kadaster percelen, BAG gebouwen, luchtfoto",
      "bboxSize": 500,
      "layers": ["nl_kadaster_percelen", "nl_kadaster_nummeraanduiding", "nl_kadaster_straatnamen", "nl_bag_gebouwen", "nl_luchtfoto_actueel"],
      "textSettings": {
        "straatnaam": { "enabled": true, "size": 5 },
        "huisnummer": { "enabled": true, "size": 2.5 },
        "perceelnummer": { "enabled": true, "size": 3 }
      }
    },
    {
      "id": "stedenbouw",
      "name": "Stedenbouw",
      "description": "Uitgebreid met ruimtelijke plannen",
      "bboxSize": 2000,
      "layers": ["nl_kadaster_percelen", "nl_kadaster_straatnamen", "nl_bag_gebouwen", "nl_luchtfoto_actueel", "nl_ruimtelijke_plannen_bouwvlak", "nl_ruimtelijke_plannen_enkelbestemming", "nl_top10nl_wegdeel"],
      "textSettings": {
        "straatnaam": { "enabled": true, "size": 5 },
        "huisnummer": { "enabled": false, "size": 2.5 },
        "perceelnummer": { "enabled": false, "size": 3 }
      }
    },
    {
      "id": "omgevingscheck",
      "name": "Omgevingscheck",
      "description": "Milieu, geluid, risico",
      "bboxSize": 1000,
      "layers": ["nl_kadaster_percelen", "nl_rivm_geluid_alle_bronnen", "nl_risicocontour_ev", "nl_risicocontour_brand", "nl_risicocontour_explosie", "nl_natura2000"],
      "textSettings": {
        "straatnaam": { "enabled": true, "size": 5 },
        "huisnummer": { "enabled": false, "size": 2.5 },
        "perceelnummer": { "enabled": true, "size": 3 }
      }
    },
    {
      "id": "historisch",
      "name": "Historisch Kadaster",
      "description": "Historische kaarten en luchtfoto's",
      "bboxSize": 500,
      "layers": ["nl_kadastrale_kaart_wms", "nl_kadaster_percelen", "nl_topotijdreis_1900", "nl_topotijdreis_1950"],
      "textSettings": {
        "straatnaam": { "enabled": true, "size": 5 },
        "huisnummer": { "enabled": false, "size": 2.5 },
        "perceelnummer": { "enabled": true, "size": 3 }
      }
    }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add src/data/gis-services.json src/data/presets.json
git commit -m "feat(gis): add GIS services registry (40+ layers) and presets"
```

---

## Task 9: PDOK Discovery Service

**Files:**
- Create: `src/gis/pdokDiscovery.ts`

- [ ] **Step 1: Implement PDOK discovery**

```typescript
// src/gis/pdokDiscovery.ts

export interface DiscoveredLayer {
  id: string;
  name: string;
  title: string;
  abstract?: string;
  serviceUrl: string;
  serviceType: 'wms' | 'wfs';
  crs: string;
}

/**
 * Fetch and parse WMS GetCapabilities to discover available layers.
 */
export async function discoverWMSLayers(serviceUrl: string): Promise<DiscoveredLayer[]> {
  const url = `${serviceUrl}${serviceUrl.includes('?') ? '&' : '?'}service=WMS&request=GetCapabilities`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`GetCapabilities failed: ${response.status}`);

  const text = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/xml');

  const layers: DiscoveredLayer[] = [];
  const layerElements = doc.querySelectorAll('Layer > Layer');

  for (const el of layerElements) {
    const name = el.querySelector('Name')?.textContent;
    const title = el.querySelector('Title')?.textContent;
    const abstract = el.querySelector('Abstract')?.textContent;

    if (name && title) {
      layers.push({
        id: `discovered_wms_${name}`,
        name,
        title,
        abstract: abstract || undefined,
        serviceUrl,
        serviceType: 'wms',
        crs: 'EPSG:28992', // Default NL, can be extracted from CRS elements
      });
    }
  }

  return layers;
}

/**
 * Fetch and parse WFS GetCapabilities to discover available feature types.
 */
export async function discoverWFSLayers(serviceUrl: string): Promise<DiscoveredLayer[]> {
  const url = `${serviceUrl}${serviceUrl.includes('?') ? '&' : '?'}service=WFS&request=GetCapabilities`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`GetCapabilities failed: ${response.status}`);

  const text = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/xml');

  const layers: DiscoveredLayer[] = [];
  const featureTypes = doc.querySelectorAll('FeatureType');

  for (const el of featureTypes) {
    const name = el.querySelector('Name')?.textContent;
    const title = el.querySelector('Title')?.textContent;
    const abstract = el.querySelector('Abstract')?.textContent;

    if (name && title) {
      layers.push({
        id: `discovered_wfs_${name}`,
        name,
        title,
        abstract: abstract || undefined,
        serviceUrl,
        serviceType: 'wfs',
        crs: 'EPSG:28992',
      });
    }
  }

  return layers;
}

/**
 * Validate a service URL by attempting GetCapabilities.
 * Returns true if reachable, false if not.
 */
export async function validateServiceUrl(serviceUrl: string): Promise<{
  valid: boolean;
  error?: string;
  redirectUrl?: string;
}> {
  try {
    const url = `${serviceUrl}${serviceUrl.includes('?') ? '&' : '?'}service=WMS&request=GetCapabilities`;
    const response = await fetch(url, { redirect: 'follow' });

    if (response.redirected) {
      return { valid: true, redirectUrl: response.url };
    }

    return { valid: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` };
  } catch (e) {
    return { valid: false, error: (e as Error).message };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/gis/pdokDiscovery.ts
git commit -m "feat(gis): add PDOK discovery via GetCapabilities"
```

---

## Task 10: Map Preview Component

**Files:**
- Create: `src/ui/MapPreview.tsx`

- [ ] **Step 1: Implement canvas-based map preview**

A React component that renders a map preview with WMS/WFS layers overlaid. Uses a canvas element for drawing.

```typescript
// src/ui/MapPreview.tsx
import React, { useRef, useEffect, useCallback } from 'react';

interface MapPreviewProps {
  centerLat: number;
  centerLon: number;
  bboxSizeMeters: number;
  wmsPreviewUrls: string[];       // WMS GetMap URLs for enabled raster layers
  wfsPreviewShapes: Array<{       // Simplified polygon outlines for WFS preview
    points: { x: number; y: number }[];
    color: string;
    closed: boolean;
  }>;
  width?: number;
  height?: number;
}

export const MapPreview: React.FC<MapPreviewProps> = ({
  centerLat,
  centerLon,
  bboxSizeMeters,
  wmsPreviewUrls,
  wfsPreviewShapes,
  width = 400,
  height = 400,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagesRef = useRef<HTMLImageElement[]>([]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // Draw loaded WMS images
    for (const img of imagesRef.current) {
      if (img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, 0, 0, width, height);
      }
    }

    // Draw WFS vector preview
    for (const shape of wfsPreviewShapes) {
      if (shape.points.length < 2) continue;
      ctx.beginPath();
      ctx.strokeStyle = shape.color;
      ctx.lineWidth = 1;
      ctx.moveTo(shape.points[0].x, shape.points[0].y);
      for (let i = 1; i < shape.points.length; i++) {
        ctx.lineTo(shape.points[i].x, shape.points[i].y);
      }
      if (shape.closed) ctx.closePath();
      ctx.stroke();
    }

    // Draw bbox outline
    ctx.strokeStyle = '#ff6600';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    const margin = 10;
    ctx.strokeRect(margin, margin, width - 2 * margin, height - 2 * margin);
    ctx.setLineDash([]);

    // Draw center cross
    const cx = width / 2;
    const cy = height / 2;
    ctx.strokeStyle = '#ff3333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy);
    ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10);
    ctx.stroke();

    // Draw coordinates label
    ctx.fillStyle = '#ffffff';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${centerLat.toFixed(5)}, ${centerLon.toFixed(5)}`, cx, height - 8);
  }, [centerLat, centerLon, width, height, wfsPreviewShapes]);

  // Load WMS preview images
  useEffect(() => {
    imagesRef.current = [];
    for (const url of wmsPreviewUrls) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => draw();
      img.onerror = () => draw();
      img.src = url;
      imagesRef.current.push(img);
    }
    draw();
  }, [wmsPreviewUrls, draw]);

  useEffect(() => { draw(); }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        border: '1px solid #374151',
        borderRadius: 4,
        background: '#1a1a2e',
      }}
    />
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/MapPreview.tsx
git commit -m "feat(gis): add canvas-based map preview with WMS/WFS overlay"
```

---

## Task 11: GIS Wizard Dialog

**Files:**
- Create: `src/ui/GISWizardDialog.tsx`
- Create: `src/ui/GeolocationPanel.tsx`
- Create: `src/ui/LayerSelectionPanel.tsx`
- Create: `src/ui/SheetSetupPanel.tsx`

- [ ] **Step 1: Create GeolocationPanel (Step 1)**

Adres zoeken + coördinaten + bbox grootte. Uses geocoding module.

- [ ] **Step 2: Create LayerSelectionPanel (Step 2)**

Layer checkboxes grouped by category, preset dropdown, text annotation toggles with size input, Contains/Intersects toggle per WFS layer, search bar, custom WMS/WFS add buttons.

- [ ] **Step 3: Create SheetSetupPanel (Step 3)**

Scale dropdown, paper size dropdown, title block template, north arrow and scale bar toggles.

- [ ] **Step 4: Create GISWizardDialog (wrapper)**

Modal dialog with 3 tabs, Previous/Next/Generate buttons, orchestrates the full flow:
1. Geocode → get center coordinates
2. Fetch selected layers (WFS + WMS)
3. Generate drawing + layers + shapes + sheet

- [ ] **Step 5: Wire wizard into extension entry point**

Update `src/index.tsx` to register the wizard dialog and connect ribbon buttons.

- [ ] **Step 6: Commit**

```bash
git add src/ui/GISWizardDialog.tsx src/ui/GeolocationPanel.tsx src/ui/LayerSelectionPanel.tsx src/ui/SheetSetupPanel.tsx src/index.tsx
git commit -m "feat(gis): add 3-step GIS wizard dialog with all panels"
```

---

## Task 12: Standalone WMS/WFS Dialogs

**Files:**
- Create: `src/ui/WMSDialog.tsx`
- Create: `src/ui/WFSDialog.tsx`

- [ ] **Step 1: Create WMS import dialog**

Simple dialog: URL input, layer name, CRS, bbox, preview, import button.

- [ ] **Step 2: Create WFS import dialog**

Simple dialog: URL input, typename, CRS, bbox, Contains/Intersects toggle, preview, import button.

- [ ] **Step 3: Wire into registrations**

- [ ] **Step 4: Commit**

```bash
git add src/ui/WMSDialog.tsx src/ui/WFSDialog.tsx
git commit -m "feat(gis): add standalone WMS and WFS import dialogs"
```

---

## Task 13: Build + Integration Test

- [ ] **Step 1: Run all tests**

```bash
cd C:/Users/rickd/Documents/GitHub/open-2D-studio-GIS-extension
npx vitest run
```

- [ ] **Step 2: Build the extension**

```bash
npm run build
```

- [ ] **Step 3: Verify extension loads in Open 2D Studio**

Start Open 2D Studio and check:
- GIS tab appears in ribbon
- Kadastrale Tekening button opens wizard
- WMS/WFS buttons open dialogs
- Geolocation button opens dialog

- [ ] **Step 4: Test with real PDOK data**

1. Open wizard
2. Search "Grote Markt 1, Haarlem"
3. Select "Basis Ontwerp" preset
4. Generate → verify shapes appear on canvas + sheet

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(gis): resolve integration issues"
```

---

## Summary

| Task | Component | Key Files |
|---|---|---|
| 1 | Project Scaffold | package.json, vite.config, manifest, index.tsx |
| 2 | Coordinate Conversion | coordinates.ts + tests |
| 3 | Geocoding | geocoding.ts (PDOK + Nominatim) |
| 4 | WFS Client | wfsClient.ts (bbox/contains filter, retry) |
| 5 | WMS Client | wmsClient.ts (GetMap, preview) |
| 6 | GeoJSON → Shapes | geoJsonToShapes.ts + textAnnotations.ts + tests |
| 7 | Sheet Generator | sheetGenerator.ts |
| 8 | Services Registry | gis-services.json + presets.json |
| 9 | PDOK Discovery | pdokDiscovery.ts (GetCapabilities) |
| 10 | Map Preview | MapPreview.tsx (canvas with WMS/WFS overlay) |
| 11 | GIS Wizard Dialog | GISWizardDialog + 3 panels |
| 12 | Standalone Dialogs | WMSDialog + WFSDialog |
| 13 | Build + Integration | Full test + real data verification |
