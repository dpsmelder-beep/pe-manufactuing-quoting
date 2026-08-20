// Text Region Neighbor Growth (experimental).
//
// Starts from probable text regions detected on the ORIGINAL high-resolution
// drawing (via the Character-Based detector) and examines the area immediately
// surrounding each region for additional character-like components that appear
// to belong to the same text line. It does NOT rediscover all text — it only
// extends existing regions left/right (horizontal lines) or up/down (vertical
// lines) up to a configurable neighbor search distance.
//
// The cleaned/OpenCV image is never used. Final crops are always taken from the
// original render (by the caller). No OCR, no merge logic, no engineering
// interpretation. Pure canvas/typed-array processing; no Base44 dependencies.

function overlapRatio(aStart, aLen, bStart, bLen) {
  const aEnd = aStart + aLen;
  const bEnd = bStart + bLen;
  const overlap = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
  const denom = Math.min(aLen, bLen);
  return denom > 0 ? overlap / denom : 0;
}

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Character-height-based final padding (1.0× long axis, 0.40× short axis). */
export function padRegionBbox(bbox, orientation, charH, bounds, opts = {}) {
  const horizontal = orientation === 'horizontal';
  const longPad = charH * (opts.padLong ?? 1.0);
  const shortPad = charH * (opts.padShort ?? 0.4);
  const leftPad = horizontal ? longPad : shortPad;
  const rightPad = horizontal ? longPad : shortPad;
  const topPad = horizontal ? shortPad : longPad;
  const bottomPad = horizontal ? shortPad : longPad;
  const x = Math.max(0, Math.round(bbox.x - leftPad));
  const y = Math.max(0, Math.round(bbox.y - topPad));
  const right = Math.min(bounds.w, Math.round(bbox.x + bbox.w + rightPad));
  const bottom = Math.min(bounds.h, Math.round(bbox.y + bbox.h + bottomPad));
  return { x, y, w: right - x, h: bottom - y, orientation, charH: Math.round(charH) };
}

/**
 * Grow one probable text region by absorbing compatible neighbor components.
 *
 * @param {object} group - a group from detectCharacterTextRegions (has
 *   `components`, `indices`, `orientation`, `bbox`).
 * @param {{c, i}[]} pool - unused candidate components (not already assigned to
 *   any group) available for absorption.
 * @param {object} opts
 * @param {number} [opts.searchFactor=3] - max neighbor search distance =
 *   charH × searchFactor on each side.
 * @param {number} [opts.baselineTolFactor=0.6] - perpendicular band tolerance.
 * @param {number} [opts.maxHeightRatio=2.5] - reject components much taller than
 *   the line's character height (but keep smaller ones — dots, degree, ± parts).
 * @param {number} [opts.lineRejectFactor=4] - reject components whose long or
 *   short side exceeds charH × this (clearly long dimension/extension lines).
 * @param {number} [opts.overlapMin=0.2] - minimum perpendicular overlap if not
 *   within the baseline band.
 */
export function growRegion(group, pool, opts = {}) {
  const orientation = group.orientation;
  const horizontal = orientation === 'horizontal';
  const indicesIn = new Set(group.indices);
  const current = group.components.slice();

  const searchFactor = opts.searchFactor ?? 3;
  const bandTolFactor = opts.baselineTolFactor ?? 0.6;
  const maxHeightRatio = opts.maxHeightRatio ?? 2.5;
  const lineRejectFactor = opts.lineRejectFactor ?? 4;
  const overlapMin = opts.overlapMin ?? 0.2;

  const charH = (horizontal
    ? median(current.map((c) => c.h))
    : median(current.map((c) => c.w))
  ) || 1;
  const searchDist = charH * searchFactor;
  const bandTol = charH * bandTolFactor;

  // Baseline/column band from the original line — kept fixed so absorbed
  // components stay consistent with the existing text.
  const so0 = Math.min(...current.map((c) => (horizontal ? c.y : c.x)));
  const shi0 = Math.max(...current.map((c) => (horizontal ? c.y + c.h : c.x + c.w)));
  const center = (so0 + shi0) / 2;
  const halfShort = (shi0 - so0) / 2;

  const compatible = (c) => {
    const cLong = horizontal ? c.w : c.h;
    const cShort = horizontal ? c.h : c.w;
    // Reject clearly long dimension / extension lines or part geometry.
    if (cLong > charH * lineRejectFactor) return false;
    if (cShort > charH * lineRejectFactor) return false;
    // Reject much taller components, but KEEP smaller ones (decimal points,
    // degree symbols, ± portions, diameter symbols, punctuation).
    if (cShort > charH * maxHeightRatio) return false;
    const cShortStart = horizontal ? c.y : c.x;
    const cCenter = horizontal ? c.cy : c.cx;
    const withinBand = Math.abs(cCenter - center) <= halfShort + bandTol;
    const ov = overlapRatio(so0, shi0 - so0, cShortStart, cShort);
    if (ov < overlapMin && !withinBand) return false;
    return true;
  };

  // Greedily absorb the closest compatible neighbor on either side, then keep
  // searching outward from the expanded span — does not stop after one.
  let changed = true;
  while (changed) {
    changed = false;
    const lo = Math.min(...current.map((c) => (horizontal ? c.x : c.y)));
    const hi = Math.max(...current.map((c) => (horizontal ? c.x + c.w : c.y + c.h)));
    let best = null;
    let bestGap = Infinity;
    for (const item of pool) {
      if (indicesIn.has(item.i)) continue;
      const c = item.c;
      if (!compatible(c)) continue;
      const cStart = horizontal ? c.x : c.y;
      const cEnd = horizontal ? c.x + c.w : c.y + c.h;
      if (cEnd <= lo + 1) {
        const gap = lo - cEnd;
        if (gap >= -charH && gap <= searchDist && gap < bestGap) { bestGap = gap; best = item; }
      } else if (cStart >= hi - 1) {
        const gap = cStart - hi;
        if (gap >= -charH && gap <= searchDist && gap < bestGap) { bestGap = gap; best = item; }
      }
    }
    if (best) {
      indicesIn.add(best.i);
      current.push(best.c);
      changed = true;
    }
  }

  const beforeBbox = group.bbox;
  const afterBbox = {
    x: Math.min(...current.map((c) => c.x)),
    y: Math.min(...current.map((c) => c.y)),
    w: Math.max(...current.map((c) => c.x + c.w)) - Math.min(...current.map((c) => c.x)),
    h: Math.max(...current.map((c) => c.y + c.h)) - Math.min(...current.map((c) => c.y)),
  };
  const beforeLo = horizontal ? beforeBbox.x : beforeBbox.y;
  const beforeHi = horizontal ? beforeBbox.x + beforeBbox.w : beforeBbox.y + beforeBbox.h;
  const afterLo = horizontal ? afterBbox.x : afterBbox.y;
  const afterHi = horizontal ? afterBbox.x + afterBbox.w : afterBbox.y + afterBbox.h;

  return {
    orientation,
    charH: Math.round(charH),
    beforeCount: group.components.length,
    addedCount: current.length - group.components.length,
    afterCount: current.length,
    startGrowth: Math.round(Math.max(0, beforeLo - afterLo)),
    endGrowth: Math.round(Math.max(0, afterHi - beforeHi)),
    beforeBbox,
    afterBbox,
  };
}