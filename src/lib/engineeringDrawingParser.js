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
// available), plus parsed fields. Dimensions emit { type, nominal, unit,
// tolerance_type, plus_tolerance, minus_tolerance, original_text }; other
// categories emit { value, unit, type, spec }.
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

// Numeric token for dimensions: matches "1.122", ".375", "12", "12.5" —
// allowing leading-dot decimals common on inch dimensions (e.g. .250, .004).
const NUM = '(\\d+(?:\\.\\d+)?|\\.\\d+)';
const DIM_UNIT = '(mm|in|cm|")';
const CONDITION = '(MAX|MIN|TYPICAL|TYP)';
const cond = (s) => (s ? s.toUpperCase() : null);

/**
 * Parse the body of a callout (text after the leading symbol/prefix) into a
 * numeric value with optional tolerance and/or condition. Returns null when the
 * body is not a confident numeric callout. Shared by the radius and diameter
 * matchers so both support leading-dot decimals, ± / +x/-y tolerances, MAX/MIN
 * conditions, and trailing units.
 */
function parseNumericCallout(body) {
  if (!body) return null;

  // Bilateral: nominal ± tol
  let m = body.match(new RegExp(`^${NUM}\\s*${DIM_UNIT}?\\s*±\\s*${NUM}\\s*${DIM_UNIT}?\\s*${CONDITION}?\\s*$`, 'i'));
  if (m) {
    return { value: Number(m[1]), unit: normUnit(m[2] || m[4]), tolerance_type: 'bilateral', plus_tolerance: Number(m[3]), minus_tolerance: Number(m[3]), condition: cond(m[5]) };
  }

  // Unilateral (slash form): nominal +plus/−minus
  m = body.match(new RegExp(`^${NUM}\\s*${DIM_UNIT}?\\s*\\+\\s*${NUM}\\s*/\\s*-\\s*${NUM}\\s*${DIM_UNIT}?\\s*${CONDITION}?\\s*$`, 'i'));
  if (m) {
    return { value: Number(m[1]), unit: normUnit(m[2] || m[5]), tolerance_type: 'unilateral', plus_tolerance: Number(m[3]), minus_tolerance: Number(m[4]), condition: cond(m[6]) };
  }

  // Unilateral (space form): nominal +plus −minus
  m = body.match(new RegExp(`^${NUM}\\s*${DIM_UNIT}?\\s*\\+\\s*${NUM}\\s*-\\s*${NUM}\\s*${DIM_UNIT}?\\s*${CONDITION}?\\s*$`, 'i'));
  if (m) {
    return { value: Number(m[1]), unit: normUnit(m[2] || m[5]), tolerance_type: 'unilateral', plus_tolerance: Number(m[3]), minus_tolerance: Number(m[4]), condition: cond(m[6]) };
  }

  // Plain: nominal, optional unit, optional condition
  m = body.match(new RegExp(`^${NUM}\\s*${DIM_UNIT}?\\s*${CONDITION}?\\s*$`, 'i'));
  if (m) {
    return { value: Number(m[1]), unit: normUnit(m[2]), tolerance_type: 'none', plus_tolerance: null, minus_tolerance: null, condition: cond(m[3]) };
  }

  return null;
}

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
// Per-category matchers. Each returns { category, ...fields } or null, where
// fields vary by category (dimensions emit nominal/tolerance_type/etc.; other
// categories emit value/unit/type/spec). Order in MATCHERS is the priority.
// ---------------------------------------------------------------------------

function matchDiameter(text) {
  const original = text.trim();
  const norm = text.replace(/\+\s*\/\s*-/g, '±').replace(/\s+/g, ' ').trim();

  // Leading symbol: Ø/⌀/ø, or DIA (optionally "DIA." only when that dot is not the
  // start of a leading-dot value). Letter "O" is treated as Ø only in strong
  // diameter context — when it begins the callout and is immediately followed by
  // a digit or a decimal point — never as a blanket O→Ø substitution.
  let m = norm.match(new RegExp(`^(?:[Ø⌀ø]|DIA(?:\\.(?!\\d))?)\\s*(.+)$`, 'i'));
  let usedO = false;
  if (!m) {
    m = norm.match(new RegExp(`^O(?=\\s*\\d|\\s*\\.)\\s*(.+)$`, 'i'));
    if (m) usedO = true;
  }
  if (!m) return null;

  const callout = parseNumericCallout(m[1].trim());
  if (!callout) return null;

  const out = {
    category: 'diameters',
    type: 'diameter',
    nominal: callout.value,
    tolerance_type: callout.tolerance_type,
    plus_tolerance: callout.plus_tolerance,
    minus_tolerance: callout.minus_tolerance,
    original_text: original,
  };
  if (callout.unit) out.unit = callout.unit;
  if (usedO) out.ocr_substitution = 'O→Ø';
  return out;
}

function matchRadius(text) {
  const original = text.trim();
  const norm = text.replace(/\+\s*\/\s*-/g, '±').replace(/\s+/g, ' ').trim();

  // R or SR prefix at the start of the callout. An optional space is allowed
  // between the prefix and the value (e.g. "R .125"). "Ra"/"Rz" surface-roughness
  // callouts fall through because their body does not start with a number.
  const m = norm.match(/^(S?R)\s*(.+)$/i);
  if (!m) return null;

  const callout = parseNumericCallout(m[2].trim());
  if (!callout) return null;

  const isSpherical = /^s/i.test(m[1]);
  const out = {
    category: 'radii',
    type: isSpherical ? 'spherical_radius' : 'radius',
    value: callout.value,
    condition: callout.condition,
    original_text: original,
  };
  if (callout.unit) out.unit = callout.unit;
  return out;
}

function matchFeatureCallout(text) {
  const original = text.trim();
  const norm = text.replace(/\s+/g, ' ').trim();

  // A feature callout begins with a quantity marker "<n>X" (the X is the
  // places/times marker, e.g. "4X"). The remainder optionally describes the
  // repeated feature (a chamfer, diameter, radius, or bare size). Anything not
  // recognized is preserved in `remainder` rather than discarded.
  const m = norm.match(/^(\d+)\s*[xX]\b\s*(.*)$/);
  if (!m) return null;

  const out = {
    category: 'quantities',
    type: 'feature_callout',
    quantity: Number(m[1]),
    feature: null,
    size: null,
    angle: null,
    original_text: original,
  };

  const rest = m[2].trim();
  if (!rest) return out; // "2X" — quantity only, no feature

  // Chamfer: "<size> X <angle>°"  (the X here is the size/angle separator; the
  // degree symbol makes a chamfer confident).
  let c = rest.match(new RegExp(`^${NUM}\\s*[xX]\\s*${NUM}\\s*°\\s*(.*)$`, 'i'));
  if (c) {
    out.feature = 'chamfer';
    out.size = Number(c[1]);
    out.angle = Number(c[2]);
    const rem = c[3].trim();
    if (rem) out.remainder = rem;
    return out;
  }

  // Diameter feature: "Ø<size>" / "O<size>" / "DIA<size>" (O only in strong
  // diameter context — see matchDiameter).
  c = rest.match(new RegExp(`^(?:[Ø⌀ø]|DIA(?:\\.(?!\\d))?)\\s*${NUM}\\s*(${DIM_UNIT})?\\s*(.*)$`, 'i'));
  let usedO = false;
  if (!c) {
    c = rest.match(new RegExp(`^O(?=\\s*\\d|\\s*\\.)\\s*${NUM}\\s*(${DIM_UNIT})?\\s*(.*)$`, 'i'));
    if (c) usedO = true;
  }
  if (c) {
    out.feature = 'diameter';
    out.size = Number(c[1]);
    if (c[2]) out.unit = normUnit(c[2]);
    if (usedO) out.ocr_substitution = 'O→Ø';
    const rem = c[3].trim();
    if (rem) out.remainder = rem;
    return out;
  }

  // Radius feature: "R<size>" / "SR<size>"
  c = rest.match(new RegExp(`^(S?R)\\s*${NUM}\\s*(${DIM_UNIT})?\\s*(.*)$`, 'i'));
  if (c) {
    out.feature = /^s/i.test(c[1]) ? 'spherical_radius' : 'radius';
    out.size = Number(c[2]);
    if (c[3]) out.unit = normUnit(c[3]);
    const rem = c[4].trim();
    if (rem) out.remainder = rem;
    return out;
  }

  // Plain size: "<size>" with no feature prefix
  c = rest.match(new RegExp(`^${NUM}\\s*(${DIM_UNIT})?\\s*(.*)$`, 'i'));
  if (c) {
    out.size = Number(c[1]);
    if (c[2]) out.unit = normUnit(c[2]);
    const rem = c[3].trim();
    if (rem) out.remainder = rem;
    return out;
  }

  // Nothing recognized after the quantity marker — preserve the remainder.
  out.remainder = rest;
  return out;
}

function matchQuantity(text) {
  const m =
    text.match(/QTY\.?\s*[:=]?\s*(\d+)/i) ||
    text.match(/\(\s*(\d+)\s*(?:pcs|ea|pc|x|places|plces)\s*\)/i) ||
    text.match(/\b(\d+)\s*(?:pcs|ea|places|plces)\b/i) ||
    text.match(/\bTOTAL\s*[:=]?\s*(\d+)/i) ||
    // "4X" — count notation. Word boundary before the digits avoids matching
    // the "8" inside a thread callout like "M8x1.25"; trailing boundary avoids
    // matching when X is followed by more digits ("4X10").
    text.match(/^\s*(\d+)\s*[xX]\b/);
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
  // Normalize common OCR variations: a standalone "+/-" (and spaced variants
  // such as "+ / -") becomes "±". The "+x/-y" unilateral form (e.g. "+.002/-.000")
  // is untouched because its slash sits between digits, not between the + and -.
  // Whitespace is collapsed; digits and decimal points are never altered.
  const norm = text.replace(/\+\s*\/\s*-/g, '±').replace(/\s+/g, ' ').trim();
  if (!norm) return null;

  // Bilateral tolerance: nominal ± tol  (1.122±.004, .375±.003, 1.040 ± .004)
  let m = norm.match(new RegExp(`^${NUM}\\s*${DIM_UNIT}?\\s*±\\s*${NUM}\\s*${DIM_UNIT}?$`, 'i'));
  if (m) {
    const nominal = Number(m[1]);
    const tol = Number(m[3]);
    return {
      category: 'dimensions',
      type: 'linear_dimension',
      nominal,
      unit: normUnit(m[2] || m[4]),
      tolerance_type: 'bilateral',
      plus_tolerance: tol,
      minus_tolerance: tol,
      original_text: text.trim(),
    };
  }

  // Unilateral tolerance (slash form): nominal +plus/−minus  (2.000 +.002/-.000)
  m = norm.match(new RegExp(`^${NUM}\\s*${DIM_UNIT}?\\s*\\+\\s*${NUM}\\s*/\\s*-\\s*${NUM}\\s*${DIM_UNIT}?$`, 'i'));
  if (m) {
    return {
      category: 'dimensions',
      type: 'linear_dimension',
      nominal: Number(m[1]),
      unit: normUnit(m[2] || m[5]),
      tolerance_type: 'unilateral',
      plus_tolerance: Number(m[3]),
      minus_tolerance: Number(m[4]),
      original_text: text.trim(),
    };
  }

  // Unilateral tolerance (space form): nominal +plus −minus  (15.0 +0.1 -0.0)
  m = norm.match(new RegExp(`^${NUM}\\s*${DIM_UNIT}?\\s*\\+\\s*${NUM}\\s*-\\s*${NUM}\\s*${DIM_UNIT}?$`, 'i'));
  if (m) {
    return {
      category: 'dimensions',
      type: 'linear_dimension',
      nominal: Number(m[1]),
      unit: normUnit(m[2] || m[5]),
      tolerance_type: 'unilateral',
      plus_tolerance: Number(m[3]),
      minus_tolerance: Number(m[4]),
      original_text: text.trim(),
    };
  }

  // Limit dimension: upper/lower (both decimals required)  (10.00/9.98)
  m = norm.match(new RegExp(`^(\\d+\\.\\d+)\\s*/\\s*(\\d+\\.\\d+)\\s*${DIM_UNIT}?$`, 'i'));
  if (m) {
    return {
      category: 'dimensions',
      type: 'limit_dimension',
      nominal: null,
      unit: normUnit(m[3]),
      tolerance_type: 'limit',
      plus_tolerance: null,
      minus_tolerance: null,
      upper: Number(m[1]),
      lower: Number(m[2]),
      original_text: text.trim(),
    };
  }

  // Fractional inch: 1-1/2
  m = norm.match(/^(\d+)-(\d+)\/(\d+)\s*$/);
  if (m) {
    return {
      category: 'dimensions',
      type: 'fraction_dimension',
      nominal: Number(m[1]) + Number(m[2]) / Number(m[3]),
      unit: 'in',
      tolerance_type: 'none',
      plus_tolerance: null,
      minus_tolerance: null,
      original_text: text.trim(),
    };
  }

  // Fractional inch: 1/2
  m = norm.match(/^(\d+)\/(\d+)\s*$/);
  if (m) {
    return {
      category: 'dimensions',
      type: 'fraction_dimension',
      nominal: Number(m[1]) / Number(m[2]),
      unit: 'in',
      tolerance_type: 'none',
      plus_tolerance: null,
      minus_tolerance: null,
      original_text: text.trim(),
    };
  }

  // Plain linear dimension: a decimal number, optionally with a unit. A decimal
  // point is required so bare integers — ambiguous as note numbers, quantities,
  // etc. — are not guessed as dimensions.
  m = norm.match(new RegExp(`^(\\d*\\.\\d+)\\s*${DIM_UNIT}?$`, 'i'));
  if (m) {
    return {
      category: 'dimensions',
      type: 'linear_dimension',
      nominal: Number(m[1]),
      unit: normUnit(m[2]),
      tolerance_type: 'none',
      plus_tolerance: null,
      minus_tolerance: null,
      original_text: text.trim(),
    };
  }

  // Whole-number dimension with an explicit unit (e.g. "12 mm") — the unit makes
  // it unambiguous even without a decimal point.
  m = norm.match(new RegExp(`^(\\d+)\\s*${DIM_UNIT}$`, 'i'));
  if (m) {
    return {
      category: 'dimensions',
      type: 'linear_dimension',
      nominal: Number(m[1]),
      unit: normUnit(m[2]),
      tolerance_type: 'none',
      plus_tolerance: null,
      minus_tolerance: null,
      original_text: text.trim(),
    };
  }

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
function matchThread(text) {
  // Thread callouts have no dedicated bucket yet — route to unclassified with a
  // `thread` type hint so they are not mistaken for linear dimensions (e.g. the
  // "1.25" in "M8x1.25" or the "1/4" in "1/4-20 UNC").
  const m =
    text.match(/\bM\s*\d+(?:\.\d+)?\s*[xX]\s*\d+(?:\.\d+)?\b/) || // metric: M8x1.25
    text.match(/\b\d+\/\d+-\d+\s*(?:UNC|UNF|UNEF|UNR)?\b/i) || // 1/4-20 [UNC]
    text.match(/\b\d+-\d+\s*(?:UNC|UNF|UNEF|UNR)\b/i); // 10-32 UNF
  if (!m) return null;
  return { category: 'unclassified', value: null, unit: null, type: 'thread', spec: text.trim() };
}

const MATCHERS = [
  matchDiameter,
  matchRadius,
  matchThread,
  matchFeatureCallout,
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
    type: 'unclassified',
    spec: text.trim(),
  };
  const { category, ...fields } = parsed;
  return {
    category,
    text,
    page: item?.page ?? null,
    confidence: item?.confidence ?? null,
    source: item?.source ?? null,
    bbox: bboxOf(item),
    ...fields,
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