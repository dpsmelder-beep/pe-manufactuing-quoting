// Engineering drawing text parser (deterministic, no AI).
//
// Independent of Base44 UI logic and the OCR pipeline itself. Its only input is
// the standardized extracted text items produced by the existing PDF.js /
// PaddleOCR pipeline (see src/lib/extractedItem.js + src/lib/ocrProviders):
//
//   {
//     text: string,                 // recognized/extracted text
//     page: number,                 // 1-based page number
//     x, y, width, height: number,  // bounding box (page pixels / user-space units)
//     source: string,               // 'pdf_text' | 'paddleocr' | ...
//     confidence: number | null     // 0..1 (OCR) or null (PDF.js embedded text)
//   }
//
// Output is structured engineering data. Each parsed item preserves the
// original text, page, confidence, source engine, and bounding box (when
// available), plus parsed fields (value, unit, type, spec, tolerance).
//
// Classification is deterministic: regular expressions + engineering notation
// patterns, applied in priority order so specific callouts (Ø, R, QTY, Ra,
// MATERIAL) are matched before the generic linear-dimension matcher. Items
// that match nothing land in `unclassified`.
//
// NOT covered yet (by design): GD&T interpretation, STEP-to-drawing
// correlation, AI-based interpretation.

const UNIT_RE = /(mm|in|cm|")/i;
const normUnit = (u) => (u ? (u === '"' ? 'in' : u.toLowerCase()) : null);

/** Curated finish keywords (matched as substrings, case-insensitive). */
const FINISH_KEYWORDS = [
  'hard anodize', 'hardcoat', 'hard coat', 'hard anodized',
  'chem film', 'chemical film', 'alodine', 'iridite',
  'passivate', 'passivation', 'passivated',
  'black oxide', 'zinc plating', 'zinc plated', 'zinc plate',
  'nickel plating', 'nickel plated', 'nickel plate',
  'tin plating', 'tin plated', 'silver plating', 'gold plating',
  'chromate', 'phosphate', 'phosphating',
  'galvanize', 'galvanized', 'galvanising', 'galvanizing',
  'powder coat', 'powder coating', 'powdercoat',
  'e-coat', 'electrocoat', 'electrophoretic',
  'electropolish', 'electropolished',
  'tumble finish', 'tumbled', 'vibratory finish',
  'bead blast', 'sand blast', 'sandblast', 'shot blast',
  'brushed', 'polished', 'mirror finish', 'matte', 'matt',
  'paint', 'painted', 'primer',
  'anodize', 'anodized', 'anodise', 'anodised',
  'mil-dtl', 'mil-c', 'mil-a', 'mil-prf',
  'astm b117', 'astm a967', 'ams', 'iso 9001',
];

/** Curated material keywords (matched on word boundaries, case-insensitive). */
const MATERIAL_KEYWORDS = [
  'stainless steel', 'stainless', 'carbon steel', 'alloy steel', 'tool steel',
  'spring steel', 'mild steel', 'steel',
  'aluminum', 'aluminium', 'alum',
  'brass', 'bronze', 'copper', 'cast iron', 'ductile iron', 'iron',
  'titanium', 'titanium alloy', 'inconel', 'monel', 'hastelloy', 'tungsten',
  'zinc', 'magnesium', 'nickel', 'cobalt', 'chromoly',
  'nylon', 'delrin', 'acetal', 'pom', 'peek', 'ultem', 'pei',
  'abs', 'polycarbonate', 'acrylic', 'pmma',
  'ptfe', 'teflon', 'hdpe', 'ldpe', 'pvc', 'polypropylene',
  'phenolic', 'garolite', 'g10', 'fr4',
];

/** Common engineering-drawing note phrases (substring, case-insensitive). */
const NOTE_PHRASES = [
  'break sharp edges', 'break all sharp edges',
  'deburr all edges', 'deburr', 'remove all burrs', 'no burrs',
  'do not scale drawing', 'do not scale',
  'unless otherwise specified', 'u.o.s', 'uos',
  'all dimensions in millimeters', 'all dimensions in mm',
  'all dimensions in inches', 'all dimensions in inch',
  'dimensions in mm', 'dimensions in inches', 'dimensions are in',
  'inspect per', 'inspection per',
  'third angle projection', 'first angle projection',
  'interpret per asme', 'interpret drawing per',
  'conforms to', 'in accordance with',
  'general tolerance', 'general tolerances',
  'all edges broken', 'edges to be broken',
  'typical', 'typ', 'all fillets r',
  'make from', 'fabricate from', 'machined from',
  'heat treat', 'heat treatment', 'stress relieve',
  'do not mark', 'do not stamp', 'permanent ink',
  'critical dimension', 'critical feature',
];

// ---------------------------------------------------------------------------
// Per-category matchers. Each returns { category, value, unit, type, spec,
// tolerance? } or null. Order in `parseItem` is the classification priority.
// ---------------------------------------------------------------------------

function matchDiameter(text) {
  const m = text.match(/(?:[Ø⌀ø]\s*(\d+(?:\.\d+)?))|(?:\bDIA\.?\s*(\d+(?:\.\d+)?))/i);
  if (!m) return null;
  const value = Number(m[1] ?? m[2]);
  const unit = normUnit((text.match(UNIT_RE) || [])[1]);
  return { category: 'diameters', value, unit, type: 'diameter', spec: text.trim() };
}

function matchRadius(text) {
  // R or SR (spherical radius) prefix, not preceded by a letter (avoids "Ra").
  const m = text.match(/(?:^|[^A-Za-z])(S?R)\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const value = Number(m[2]);
  const unit = normUnit((text.match(UNIT_RE) || [])[1]);
  const isSpherical = /^s/i.test(m[1]);
  return {
    category: 'radii',
    value,
    unit,
    type: isSpherical ? 'spherical_radius' : 'radius',
    spec: text.trim(),
  };
}

function matchQuantity(text) {
  const m =
    text.match(/QTY\.?\s*[:=]?\s*(\d+)/i) ||
    text.match(/\(\s*(\d+)\s*(?:pcs|ea|pc|x|places|plces)\s*\)/i) ||
    text.match(/\b(\d+)\s*(?:pcs|ea|places|plces)\b/i) ||
    text.match(/\bTOTAL\s*[:=]?\s*(\d+)/i);
  if (!m) return null;
  return { category: 'quantities', value: Number(m[1]), unit: 'pcs', type: 'quantity', spec: text.trim() };
}

function matchFinish(text) {
  // 1) Surface roughness: Ra 1.6 / Rz 3.2 (must have Ra/Rz prefix).
  let m = text.match(/R[aAzZ]\s*(\d+(?:\.\d+)?)/);
  if (m) {
    const sym = /rz/i.test(text) ? 'Rz' : 'Ra';
    return { category: 'finishes', value: Number(m[1]), unit: null, type: 'surface_roughness', spec: `${sym} ${m[1]}` };
  }
  // 2) Explicit FINISH prefix.
  m = text.match(/\b(?:SURFACE\s+)?FINISH(?:ED)?\s*[:=]?\s*(.+)/i);
  if (m) return { category: 'finishes', value: null, unit: null, type: 'finish_prefix', spec: m[1].trim() };
  // 3) Known finish keywords.
  const lower = text.toLowerCase();
  for (const kw of FINISH_KEYWORDS) {
    if (lower.includes(kw)) return { category: 'finishes', value: null, unit: null, type: 'finish_keyword', spec: kw };
  }
  return null;
}

function matchMaterial(text) {
  // 1) MATERIAL / MAT'L / MATL prefix — capture the trailing spec.
  let m = text.match(/\bMAT(?:ERIAL|'L|L)\.?\s*[:=]?\s*(.+)/i);
  if (m) return { category: 'materials', value: null, unit: null, type: 'material_prefix', spec: m[1].trim() };
  // 2) Known material keywords.
  for (const kw of MATERIAL_KEYWORDS) {
    const re = new RegExp(`\\b${kw.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (re.test(text)) return { category: 'materials', value: null, unit: null, type: 'material_keyword', spec: kw };
  }
  // 3) Common alloy / grade designations (e.g. 6061-T6, 304, 17-4PH, A36, 12L14).
  m = text.match(
    /\b(6061|6063|7075|5052|2024|3003)(?:[-_]?(T[0-9]+))?|\b(303|304|316L?|17-4(?:PH)?|410|420|1018|1045|12L14|4140|4340|8620|A36|O1|D2|A2|S7)(?:\b)/i
  );
  if (m) return { category: 'materials', value: null, unit: null, type: 'material_alloy', spec: m[0].trim() };
  return null;
}

function matchDimension(text) {
  // Bilateral tolerance: 12.5 ±0.1  /  12.5mm ±0.1mm
  let m = text.match(/(\d+(?:\.\d+)?)\s*(mm|in|cm|")?\s*±\s*(\d+(?:\.\d+)?)\s*(mm|in|cm|")?/i);
  if (m) {
    const nominal = Number(m[1]);
    const tol = Number(m[3]);
    return {
      category: 'dimensions',
      value: nominal,
      unit: normUnit(m[2] || m[4]),
      type: 'bilateral',
      tolerance: { type: 'bilateral', value: tol, upper: nominal + tol, lower: nominal - tol },
      spec: text.trim(),
    };
  }
  // Unilateral tolerance: 12.5 +0.1 -0.05
  m = text.match(/(\d+(?:\.\d+)?)\s*(mm|in|cm|")?\s*\+\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(mm|in|cm|")?/i);
  if (m) {
    const nominal = Number(m[1]);
    return {
      category: 'dimensions',
      value: nominal,
      unit: normUnit(m[2] || m[5]),
      type: 'unilateral',
      tolerance: { type: 'unilateral', upper: nominal + Number(m[3]), lower: nominal - Number(m[4]) },
      spec: text.trim(),
    };
  }
  // Limit dimension: 10.00/9.98
  m = text.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(mm|in|cm|")?/i);
  if (m) {
    return {
      category: 'dimensions',
      value: Number(m[1]),
      unit: normUnit(m[3]),
      type: 'limit',
      tolerance: { type: 'limit', upper: Number(m[1]), lower: Number(m[2]) },
      spec: text.trim(),
    };
  }
  // Linear with explicit unit: 12.5 mm / 1.500"
  m = text.match(/(\d+(?:\.\d+)?)\s*(mm|in|cm|")\b/i);
  if (m) return { category: 'dimensions', value: Number(m[1]), unit: normUnit(m[2]), type: 'linear', tolerance: { type: 'none' }, spec: text.trim() };
  // Fractional inch: 1-1/2
  m = text.match(/(\d+)-(\d+)\/(\d+)/);
  if (m) {
    return {
      category: 'dimensions',
      value: Number(m[1]) + Number(m[2]) / Number(m[3]),
      unit: 'in',
      type: 'fraction',
      tolerance: { type: 'none' },
      spec: text.trim(),
    };
  }
  // Fractional inch: 1/2
  m = text.match(/(\d+)\/(\d+)/);
  if (m) {
    return { category: 'dimensions', value: Number(m[1]) / Number(m[2]), unit: 'in', type: 'fraction', tolerance: { type: 'none' }, spec: text.trim() };
  }
  // Bare decimal: 12.5 (treated as a linear dimension candidate)
  m = text.match(/(\d+\.\d+)/);
  if (m) return { category: 'dimensions', value: Number(m[1]), unit: null, type: 'linear', tolerance: { type: 'none' }, spec: text.trim() };
  return null;
}

function matchNote(text) {
  if (/\bNOTES?\b/i.test(text)) return { category: 'notes', value: null, unit: null, type: 'note_prefix', spec: text.trim() };
  // Numbered list line: "1. Deburr all edges" (must contain letters after the number).
  let m = text.match(/^\s*(\d{1,2})[.)]\s+(.+)/);
  if (m && /[a-zA-Z]{2,}/.test(m[2])) {
    return { category: 'notes', value: null, unit: null, type: 'numbered_note', spec: text.trim() };
  }
  const lower = text.toLowerCase();
  for (const p of NOTE_PHRASES) {
    if (lower.includes(p)) return { category: 'notes', value: null, unit: null, type: 'note_phrase', spec: p };
  }
  return null;
}

// Priority order: specific callouts first, generic dimension last, notes before
// falling through to unclassified.
const MATCHERS = [
  matchDiameter,
  matchRadius,
  matchQuantity,
  matchFinish,
  matchMaterial,
  matchDimension,
  matchNote,
];

/**
 * Classify a single standardized item. Returns the parsed entry (without
 * re-attaching metadata — use `parseItem` for the full record).
 */
export function classify(text) {
  if (!text || !text.trim()) return null;
  for (const match of MATCHERS) {
    const res = match(text);
    if (res) return res;
  }
  return null;
}

/** Bounding box is included only when coordinates are actually present. */
function bboxOf(item) {
  const has = (v) => v !== undefined && v !== null && Number.isFinite(Number(v));
  if (has(item.x) && (has(item.width) || has(item.y))) {
    return {
      x: Number(item.x),
      y: Number(item.y),
      width: Number(item.width ?? 0),
      height: Number(item.height ?? 0),
    };
  }
  return null;
}

/**
 * Parse a single standardized item into a full engineering-data record,
 * preserving original text, page, confidence, source engine, and bbox.
 */
export function parseItem(item) {
  const text = item?.text ?? '';
  const parsed = classify(text) || {
    category: 'unclassified',
    value: null,
    unit: null,
    type: 'unclassified',
    spec: text.trim(),
  };
  return {
    text,
    page: item?.page ?? null,
    confidence: item?.confidence ?? null,
    source: item?.source ?? null,
    bbox: bboxOf(item),
    value: parsed.value ?? null,
    unit: parsed.unit ?? null,
    type: parsed.type,
    spec: parsed.spec,
    ...(parsed.tolerance ? { tolerance: parsed.tolerance } : {}),
  };
}

export const CATEGORIES = [
  'dimensions',
  'radii',
  'diameters',
  'quantities',
  'materials',
  'finishes',
  'notes',
  'unclassified',
];

/**
 * Parse an array of standardized extracted items into structured engineering
 * data grouped by category.
 * @param {Array} items - standardized items from the PDF.js / PaddleOCR pipeline
 * @returns {{ dimensions:[], radii:[], diameters:[], quantities:[],
 *            materials:[], finishes:[], notes:[], unclassified:[] }}
 */
export function parseDrawingItems(items) {
  const out = {
    dimensions: [],
    radii: [],
    diameters: [],
    quantities: [],
    materials: [],
    finishes: [],
    notes: [],
    unclassified: [],
  };
  for (const item of items || []) {
    const entry = parseItem(item);
    const bucket = out[entry.category] || out.unclassified;
    bucket.push(entry);
  }
  return out;
}