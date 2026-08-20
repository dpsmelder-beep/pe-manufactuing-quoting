// Character-Based Engineering Text Detector (experimental).
//
// A more permissive, character-first approach to locating engineering-drawing
// text. The legacy textRegionDetection groups "character-like" components with
// fairly strict size filters and can clip or miss callouts. This detector:
//   1. Keeps very permissive character candidates (decimal points, degree
//      symbols, ± portions, small letters/fractions) and only rejects things
//      that are clearly too large to be drawing text.
//   2. Estimates character-height size classes (drawings often mix text sizes).
//   3. Builds probable HORIZONTAL text lines by extending left/right while
//      neighbors share a baseline, have compatible heights, and are reasonably
//      spaced (gaps large enough for spaces / engineering symbols).
//   4. Builds VERTICAL text lines the same way (rotated) and records orientation.
//   5. Computes the OCR bounding box only AFTER the line is assembled — it must
//      contain ALL character components of the group — then applies
//      character-height-based padding. The final crop is always taken from the
//      original high-resolution render (see cropBox); no stitching of prior crops.
//
// Pure canvas / typed-array image processing. No Base44 UI or AI dependencies.
// No OCR and no engineering interpretation is performed here.

import { toGrayscale, applyContrast, threshold } from './imagePreprocessing';

/** Two-pass 8-connectivity connected-component labeling on a binary image. */
function connectedComponents(bin, w, h) {
  const labels = new Int32Array(w * h);
  const parent = [0];
  const find = (x) => {
    let r = x;
    while (parent[r] !== r) { parent[r] = parent[parent[r]]; r = parent[r]; }
    return r;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent[rb] = ra; else parent[ra] = rb;
  };
  let next = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (!bin[idx]) continue;
      const nbs = [];
      if (x > 0 && labels[idx - 1]) nbs.push(labels[idx - 1]);
      if (y > 0) {
        if (x > 0 && labels[idx - w - 1]) nbs.push(labels[idx - w - 1]);
        if (labels[idx - w]) nbs.push(labels[idx - w]);
        if (x < w - 1 && labels[idx - w + 1]) nbs.push(labels[idx - w + 1]);
      }
      let lab;
      if (nbs.length === 0) {
        lab = next++;
        parent.push(lab);
      } else {
        lab = nbs[0];
        for (let k = 1; k < nbs.length; k++) union(lab, nbs[k]);
        lab = find(lab);
      }
      labels[idx] = lab;
    }
  }
  const minX = new Int32Array(next);
  const minY = new Int32Array(next);
  const maxX = new Int32Array(next).fill(-1);
  const maxY = new Int32Array(next).fill(-1);
  const area = new Int32Array(next);
  for (let i = 0; i < next; i++) { minX[i] = w; minY[i] = h; }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (!labels[idx]) continue;
      const r = find(labels[idx]);
      if (x < minX[r]) minX[r] = x;
      if (x > maxX[r]) maxX[r] = x;
      if (y < minY[r]) minY[r] = y;
      if (y > maxY[r]) maxY[r] = y;
      area[r]++;
    }
  }
  const comps = [];
  for (let r = 1; r < next; r++) {
    if (area[r] <= 0) continue;
    const cw = maxX[r] - minX[r] + 1;
    const ch = maxY[r] - minY[r] + 1;
    comps.push({
      x: minX[r], y: minY[r], w: cw, h: ch, area: area[r],
      cx: minX[r] + cw / 2, cy: minY[r] + ch / 2,
    });
  }
  return comps;
}

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

/**
 * Estimate character-height size classes from candidate component heights.
 * Drawings often contain several text sizes; we do not assume a single global
 * height. Heights are sorted and split when the next height exceeds ~1.6× the
 * class reference, producing a small set of approximate size classes.
 */
function estimateSizeClasses(comps) {
  if (!comps.length) return [];
  const hs = comps.map((c) => c.h).sort((a, b) => a - b);
  const classes = [];
  let cur = { ref: hs[0], members: [hs[0]] };
  for (let i = 1; i < hs.length; i++) {
    if (hs[i] <= cur.ref * 1.6) cur.members.push(hs[i]);
    else { classes.push(cur); cur = { ref: hs[i], members: [hs[i]] }; }
  }
  classes.push(cur);
  return classes.map((cl) => ({
    ref: Math.round(cl.members[Math.floor(cl.members.length / 2)]),
    count: cl.members.length,
  }));
}

/**
 * Greedy line assembly along one axis. `axis` = 'x' (horizontal lines, extend
 * left/right) or 'y' (vertical lines, extend up/down). The "long" coordinate
 * is the reading direction; the "short" coordinate is perpendicular (baseline
 * / column). Components already used (by a prior horizontal pass) are skipped.
 */
function assembleLines(comps, used, axis, opts, fallbackSize) {
  const longKey = axis === 'x' ? 'x' : 'y';
  const longLen = axis === 'x' ? 'w' : 'h';
  const shortKey = axis === 'x' ? 'y' : 'x';
  const shortLen = axis === 'x' ? 'h' : 'w';

  const order = comps
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c[longKey] - b.c[longKey]);
  const lines = [];

  const lineGapFactor = opts.lineGapFactor ?? 3.0;
  const baselineTolFactor = opts.baselineTolFactor ?? 0.6;
  const maxHeightRatio = opts.maxHeightRatio ?? 2.5;
  const overlapMin = opts.lineOverlapMin ?? 0.2;

  for (let k = 0; k < order.length; k++) {
    if (used[order[k].i]) continue;
    const group = [order[k]];
    used[order[k].i] = true;
    let changed = true;
    while (changed) {
      changed = false;
      let lo = Infinity, so = Infinity, hi = -Infinity, shi = -Infinity;
      for (const g of group) {
        const c = g.c;
        if (c[longKey] < lo) lo = c[longKey];
        if (c[shortKey] < so) so = c[shortKey];
        if (c[longKey] + c[longLen] > hi) hi = c[longKey] + c[longLen];
        if (c[shortKey] + c[shortLen] > shi) shi = c[shortKey] + c[shortLen];
      }
      const longLenTotal = hi - lo;
      const shortLenTotal = shi - so;
      const sizeBasis = median(group.map((g) => g.c[shortLen])) || fallbackSize;
      const spacingThr = sizeBasis * lineGapFactor;
      const bandTol = sizeBasis * baselineTolFactor;
      const center = (so + shi) / 2;

      for (let m = 0; m < order.length; m++) {
        const idx = order[m].i;
        if (used[idx]) continue;
        const c = order[m].c;
        // Gap along the reading direction to the current line span.
        const gap = c[longKey] >= hi
          ? c[longKey] - hi
          : c[longKey] + c[longLen] <= lo
            ? lo - (c[longKey] + c[longLen])
            : 0;
        if (gap > spacingThr) continue;
        // Perpendicular (baseline / column) compatibility.
        const ov = overlapRatio(so, shortLenTotal, c[shortKey], c[shortLen]);
        const withinBand = Math.abs(c[shortKey === 'y' ? 'cy' : 'cx'] - center) <= shortLenTotal / 2 + bandTol;
        if (ov < overlapMin && !withinBand) continue;
        // Reject a clearly different (much larger) size class; keep small ones.
        if (c[shortLen] > sizeBasis * maxHeightRatio) continue;
        group.push(order[m]);
        used[idx] = true;
        changed = true;
      }
    }
    lines.push({
      indices: group.map((g) => g.i),
      components: group.map((g) => g.c),
      orientation: axis === 'x' ? 'horizontal' : 'vertical',
      bbox: {
        x: Math.min(...group.map((g) => g.c.x)),
        y: Math.min(...group.map((g) => g.c.y)),
        w: Math.max(...group.map((g) => g.c.x + g.c.w)) - Math.min(...group.map((g) => g.c.x)),
        h: Math.max(...group.map((g) => g.c.y + g.c.h)) - Math.min(...group.map((g) => g.c.y)),
      },
    });
  }
  return lines;
}

/** Character-height-based padding (1.0× long axis, 0.40× short axis), clamped. */
function padRegion(bbox, orientation, charH, bounds, opts) {
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
  return { x, y, w: right - x, h: bottom - y, orientation, charH: Math.round(charH), padding: { left: longPad, right: longPad, top: shortPad, bottom: shortPad } };
}

/**
 * Run the Character-Based Engineering Text Detector on a high-resolution page
 * render. The source canvas is not modified.
 *
 * @returns {{ components, groups, regions, sizeClasses, thresholdCanvas, stats }}
 */
export function detectCharacterTextRegions(sourceCanvas, opts = {}) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;

  // 1) Working canvas: grayscale + contrast + binarize.
  const work = document.createElement('canvas');
  work.width = w;
  work.height = h;
  const ctx = work.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  toGrayscale(img);
  applyContrast(img, opts.contrastFactor ?? 1.6);
  threshold(img, opts.threshold ?? null);
  ctx.putImageData(img, 0, 0);

  const data = img.data;
  const bin = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) bin[p] = data[i] < 128 ? 1 : 0;

  // 2) Connected components.
  const all = connectedComponents(bin, w, h);

  // 3) Permissive character-candidate filter — reject only clearly too-large
  //    geometry; keep small components (dots, degree symbols, ± portions).
  const minCharH = h * (opts.minCharHFrac ?? 0.004);
  const maxCharH = h * (opts.maxCharHFrac ?? 0.08);
  const minCharW = w * (opts.minCharWFrac ?? 0.0015);
  const maxCharW = w * (opts.maxCharWFrac ?? 0.15);
  const maxAspect = opts.maxAspect ?? 10;
  const minArea = opts.minArea ?? 2;
  const maxAreaFrac = opts.maxAreaFrac ?? 0.02;
  const candidates = [];
  for (const c of all) {
    if (c.h > maxCharH || c.w > maxCharW) continue; // too large to be text
    if (c.h < minCharH && c.w < minCharW && c.area < minArea) continue; // speck
    const aspect = c.w / c.h;
    if (aspect > maxAspect || aspect < 1 / maxAspect) continue; // long geometry line
    if (c.area > w * h * maxAreaFrac) continue; // huge filled region
    candidates.push(c);
  }

  // 4) Estimate character-height size classes.
  const sizeClasses = estimateSizeClasses(candidates);
  const medianCharH = median(candidates.map((c) => c.h)) || h * 0.02;

  // 5) Assemble horizontal text lines, then vertical lines from what remains.
  const used = new Array(candidates.length).fill(false);
  const hLines = assembleLines(candidates, used, 'x', opts, medianCharH);
  const vLines = assembleLines(candidates, used, 'y', opts, medianCharH);
  const groups = [...hLines, ...vLines];

  // 6) Final regions: bbox of ALL components in the group + char-height padding.
  const bounds = { w, h };
  const minComponents = opts.minComponentsPerRegion ?? 1;
  const regions = [];
  for (const g of groups) {
    if (g.components.length < minComponents) continue;
    const charH = g.orientation === 'horizontal'
      ? median(g.components.map((c) => c.h))
      : median(g.components.map((c) => c.w));
    const region = padRegion(g.bbox, g.orientation, charH || medianCharH, bounds, opts);
    region.componentCount = g.components.length;
    region.groupBbox = g.bbox;
    regions.push(region);
  }

  return {
    components: candidates,
    groups,
    regions,
    sizeClasses,
    thresholdCanvas: work,
    stats: {
      totalComponents: all.length,
      charCandidates: candidates.length,
      groups: groups.length,
      regions: regions.length,
      horizontalLines: hLines.length,
      verticalLines: vLines.length,
      sizeClasses: sizeClasses.length,
    },
  };
}

/** Crop a region from the original high-resolution render (source not mutated). */
export function cropRegionFromSource(sourceCanvas, region) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const x = Math.max(0, Math.round(region.x));
  const y = Math.max(0, Math.round(region.y));
  const width = Math.max(1, Math.min(w - x, Math.round(region.w)));
  const height = Math.max(1, Math.min(h - y, Math.round(region.h)));
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  c.getContext('2d').drawImage(sourceCanvas, x, y, width, height, 0, 0, width, height);
  return { canvas: c, x, y, width, height };
}