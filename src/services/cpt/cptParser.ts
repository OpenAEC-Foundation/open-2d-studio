/**
 * CPT Parser — dedicated parsing module for GEF and BRO-XML cone penetration
 * test file formats.
 *
 * Supports:
 * - GEF format (Dutch geotechnical exchange format)
 * - BRO-XML format (Basisregistratie Ondergrond XML)
 *
 * Each parser extracts depth, qc (cone resistance), fs (sleeve friction) and
 * optionally rf (friction ratio) arrays from the file content.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CPTParsedData {
  /** Depth values in metres below surface */
  depth: number[];
  /** Cone resistance qc in MPa */
  qc: number[];
  /** Sleeve friction fs in MPa */
  fs: number[];
  /** Friction ratio Rf in % (optional) */
  rf?: number[];
  /** Source filename */
  sourceFile?: string;
}

// ---------------------------------------------------------------------------
// GEF parser
// ---------------------------------------------------------------------------

interface GefColumnInfo {
  index: number;
  /** Unit string from #COLUMNINFO */
  unit: string;
  /** Description string from #COLUMNINFO */
  name: string;
  /** Quantity number from #COLUMNINFO */
  quantity: number;
}

/**
 * Parse a GEF (Geotechnical Exchange Format) file and extract depth, qc, fs,
 * and optionally rf.
 *
 * GEF files have a header section (lines starting with #) and a data section
 * after #EOH= (End Of Header). Column semantics are identified via
 * #COLUMNINFO and/or #MEASUREMENTVAR headers.
 *
 * Common column quantity numbers:
 *   1 = penetration length / sondeerlengte (m)
 *   2 = cone resistance / conusweerstand qc (MPa)
 *   3 = sleeve friction / plaatselijke wrijving fs (MPa)
 *   4 = friction ratio Rf (%)
 *  11 = corrected cone resistance qt (MPa)
 */
export function parseGEF(text: string, fileName?: string): CPTParsedData {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const columns: GefColumnInfo[] = [];
  let columnSep = ' ';
  let recordSep: string | undefined;
  let eohIndex = -1;

  // Parse header
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.toUpperCase().startsWith('#EOH')) {
      eohIndex = i;
      break;
    }

    // #COLUMNSEPARATOR
    if (line.toUpperCase().startsWith('#COLUMNSEPARATOR')) {
      const val = extractHeaderValue(line);
      if (val) columnSep = val;
    }

    // #RECORDSEPARATOR
    if (line.toUpperCase().startsWith('#RECORDSEPARATOR')) {
      const val = extractHeaderValue(line);
      if (val) recordSep = val;
    }

    // #COLUMNINFO= colNr, unit, name, quantityNr
    if (line.toUpperCase().startsWith('#COLUMNINFO')) {
      const val = extractHeaderValue(line);
      if (val) {
        const parts = val.split(',').map(s => s.trim());
        if (parts.length >= 4) {
          columns.push({
            index: parseInt(parts[0], 10),
            unit: parts[1],
            name: parts[2],
            quantity: parseInt(parts[3], 10),
          });
        }
      }
    }
  }

  if (eohIndex < 0) {
    throw new Error('GEF file has no #EOH= marker — cannot find data section');
  }

  // Identify column indices (0-based in the data row array)
  // GEF column numbering is 1-based
  let depthCol = -1;
  let qcCol = -1;
  let fsCol = -1;
  let rfCol = -1;

  for (const col of columns) {
    const idx = col.index - 1; // convert to 0-based
    if (col.quantity === 1) depthCol = idx;   // penetration length
    if (col.quantity === 2) qcCol = idx;      // cone resistance
    if (col.quantity === 3) fsCol = idx;      // sleeve friction
    if (col.quantity === 4) rfCol = idx;      // friction ratio
  }

  // Fallback: if no quantity numbers, try name-based matching
  if (depthCol < 0 || qcCol < 0) {
    for (const col of columns) {
      const idx = col.index - 1;
      const nameLower = col.name.toLowerCase();
      if (depthCol < 0 && (nameLower.includes('sondeerlengte') || nameLower.includes('penetration') || nameLower.includes('diepte') || nameLower.includes('depth'))) {
        depthCol = idx;
      }
      if (qcCol < 0 && (nameLower.includes('conusweerstand') || nameLower.includes('cone resist') || nameLower.includes('qc'))) {
        qcCol = idx;
      }
      if (fsCol < 0 && (nameLower.includes('kleef') || nameLower.includes('plaatselijke_wrijving') || nameLower.includes('friction') || nameLower.includes('fs') || nameLower.includes('wrijving'))) {
        fsCol = idx;
      }
      if (rfCol < 0 && (nameLower.includes('wrijvingsgetal') || nameLower.includes('friction ratio') || nameLower === 'rf')) {
        rfCol = idx;
      }
    }
  }

  // Last resort: assume standard column order (depth, qc, fs, ...)
  if (depthCol < 0) depthCol = 0;
  if (qcCol < 0) qcCol = 1;
  if (fsCol < 0) fsCol = 2;
  // rfCol stays -1 if not found — rf will be derived from qc/fs

  // Parse data section
  const depth: number[] = [];
  const qc: number[] = [];
  const fs: number[] = [];
  const rf: number[] = [];
  const hasRfCol = rfCol >= 0;

  for (let i = eohIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (recordSep && line === recordSep) continue;

    // Split on separator (semicolon or space/tab)
    let parts: string[];
    if (columnSep === ';') {
      parts = line.split(';').map(s => s.trim());
    } else {
      parts = line.split(/[\s;,]+/).filter(Boolean);
    }

    const maxCol = Math.max(depthCol, qcCol, fsCol, rfCol);
    if (parts.length <= Math.max(depthCol, qcCol)) continue;

    const dVal = parseFloat(parts[depthCol]);
    const qVal = parseFloat(parts[qcCol]);
    const fVal = fsCol >= 0 && fsCol < parts.length ? parseFloat(parts[fsCol]) : 0;

    if (isNaN(dVal) || isNaN(qVal)) continue;

    depth.push(dVal);
    qc.push(qVal);
    fs.push(isNaN(fVal) ? 0 : fVal);

    // Extract or derive friction ratio
    if (hasRfCol && rfCol < parts.length) {
      const rVal = parseFloat(parts[rfCol]);
      rf.push(isNaN(rVal) ? 0 : rVal);
    } else if (qVal > 0 && !isNaN(fVal) && fVal > 0) {
      // Derive Rf = (fs / qc) * 100 (%)
      rf.push((fVal / qVal) * 100);
    } else {
      rf.push(0);
    }
  }

  if (depth.length === 0) {
    throw new Error('GEF file contains no valid data rows');
  }

  // Only include rf if there are meaningful values
  const hasRf = rf.some(v => v > 0);

  return {
    depth,
    qc,
    fs,
    rf: hasRf ? rf : undefined,
    sourceFile: fileName,
  };
}

// ---------------------------------------------------------------------------
// BRO-XML parser
// ---------------------------------------------------------------------------

/**
 * Parse a BRO-XML (Basisregistratie Ondergrond) CPT file.
 *
 * Uses simple string parsing (no XML library required). Looks for the
 * data block inside <cpt:conePenetrationTest> or similar elements.
 * Data is typically in <cpt:values> with space-separated rows.
 *
 * Row format: penetrationLength coneResistance localFriction frictionRatio ...
 */
export function parseBROXML(text: string, fileName?: string): CPTParsedData {
  const depth: number[] = [];
  const qc: number[] = [];
  const fs: number[] = [];
  const rf: number[] = [];

  // Strategy 1: Find <cpt:values> or <values> elements
  const valuesRegex = /<(?:cpt:)?values>([\s\S]*?)<\/(?:cpt:)?values>/gi;
  const valuesMatches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = valuesRegex.exec(text)) !== null) {
    valuesMatches.push(m[1]);
  }

  if (valuesMatches.length > 0) {
    for (const block of valuesMatches) {
      const rows = block.trim().split('\n');
      for (const row of rows) {
        const parts = row.trim().split(/[\s,;]+/).filter(Boolean);
        if (parts.length < 2) continue;

        const dVal = parseFloat(parts[0]);
        const qVal = parseFloat(parts[1]);
        const fVal = parts.length >= 3 ? parseFloat(parts[2]) : 0;
        const rVal = parts.length >= 4 ? parseFloat(parts[3]) : 0;

        if (isNaN(dVal) || isNaN(qVal)) continue;

        depth.push(dVal);
        qc.push(qVal);
        fs.push(isNaN(fVal) ? 0 : fVal);
        rf.push(isNaN(rVal) ? 0 : rVal);
      }
    }
  }

  // Strategy 2: Individual measurement elements
  if (depth.length === 0) {
    const depthValues = extractXmlArray(text, 'penetrationLength');
    const qcValues = extractXmlArray(text, 'coneResistance');
    const fsValues = extractXmlArray(text, 'localFriction');
    const rfValues = extractXmlArray(text, 'frictionRatio');

    if (depthValues.length > 0 && qcValues.length > 0) {
      const len = Math.min(depthValues.length, qcValues.length);
      for (let i = 0; i < len; i++) {
        depth.push(depthValues[i]);
        qc.push(qcValues[i]);
        fs.push(i < fsValues.length ? fsValues[i] : 0);
        rf.push(i < rfValues.length ? rfValues[i] : 0);
      }
    }
  }

  // Strategy 3: dataBlock elements
  if (depth.length === 0) {
    const dataBlockRegex = /<(?:[\w]+:)?dataBlock[^>]*>([\s\S]*?)<\/(?:[\w]+:)?dataBlock>/gi;
    while ((m = dataBlockRegex.exec(text)) !== null) {
      const rows = m[1].trim().split('\n');
      for (const row of rows) {
        const parts = row.trim().split(/[\s,;]+/).filter(Boolean);
        if (parts.length < 2) continue;

        const dVal = parseFloat(parts[0]);
        const qVal = parseFloat(parts[1]);
        const fVal = parts.length >= 3 ? parseFloat(parts[2]) : 0;
        const rVal = parts.length >= 4 ? parseFloat(parts[3]) : 0;

        if (isNaN(dVal) || isNaN(qVal)) continue;

        depth.push(dVal);
        qc.push(qVal);
        fs.push(isNaN(fVal) ? 0 : fVal);
        rf.push(isNaN(rVal) ? 0 : rVal);
      }
    }
  }

  if (depth.length === 0) {
    throw new Error('BRO-XML file contains no recognizable CPT data');
  }

  // Only include rf if there are meaningful values
  const hasRf = rf.some(v => v > 0);

  return {
    depth,
    qc,
    fs,
    rf: hasRf ? rf : undefined,
    sourceFile: fileName,
  };
}

// ---------------------------------------------------------------------------
// Auto-detect format and parse
// ---------------------------------------------------------------------------

/**
 * Auto-detect the CPT file format (GEF vs BRO-XML) and parse it.
 */
export function parseCPTFile(text: string, fileName?: string): CPTParsedData {
  const trimmed = text.trim();

  // Detect XML by checking for XML declaration or root element
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<')) {
    return parseBROXML(text, fileName);
  }

  // Otherwise treat as GEF
  return parseGEF(text, fileName);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractHeaderValue(line: string): string | undefined {
  const eqIdx = line.indexOf('=');
  if (eqIdx < 0) return undefined;
  return line.substring(eqIdx + 1).trim();
}

/**
 * Extract numeric values from XML elements like
 * <cpt:penetrationLength>1.23</cpt:penetrationLength>
 * that appear multiple times in the document.
 */
function extractXmlArray(xml: string, tagLocalName: string): number[] {
  const regex = new RegExp(
    `<(?:[\\w]+:)?${tagLocalName}[^>]*>([^<]+)<\\/(?:[\\w]+:)?${tagLocalName}>`,
    'gi',
  );
  const values: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const val = parseFloat(match[1].trim());
    if (!isNaN(val)) values.push(val);
  }
  return values;
}
