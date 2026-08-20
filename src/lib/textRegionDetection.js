// Portable, experimental "Text Region Detection" for engineering drawings.
//
// Pure browser-side image processing (canvas + typed arrays). No Base44 UI or
// AI dependencies. The goal is to locate candidate text regions so OCR can
// process smaller regions instead of the whole drawing. No OCR and no
// engineering interpretation is performed here.
//
// Pipeline:
//   1. Build a high-resolution grayscale + contrast + binarized copy
//      (the source canvas is never modified).
//   2. Two-pass 8-connectivity connected-component labeling on dark pixels.
//   3. Keep only "character-like" components (size / aspect filters) — this
//      rejects long geometry lines and huge filled regions.
//   4. Group components into probable text lines by extending left/right while
//      neighbors share a baseline, have similar heights, and are reasonably
//      spaced; a bounding box is created only after the line is formed.
//   5. Reject overly large regions that are obviously whole-drawing geometry.

import { toGrayscale, applyContrast, threshold } from './imagePreprocessing';

/**
 * Two-pass 8-connectivity connected-component labeling on a binary image.
 * @param {Uint8Array} bin - 1 = foreground (dark), 0 = background
 * @returns { { x, y, w, h, area, cx, cy }[] }
 */
function connectedComponents(bin, w, h) {
  const labels = new Int32Array(w * h); // 0 = background
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

  // Second pass: accumulate bbox/area per root label.
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

function flushGroup(group, regions, minComponents) {
  if (group.length < minComponents) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of group) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x + c.w > maxX) maxX = c.x + c.w;
    if (c.y + c.h > maxY) maxY = c.y + c.h;
  }
  regions.push({ x: minX, y: minY, w: maxX - minX, h: maxY - minY, components: group.length });
}

/**
 * Detect candidate text regions on a high-resolution page render.
 * Does not mutate the source canvas.
 *
 * @param {HTMLCanvasElement} sourceCanvas
 * @param {object} [opts]
 * @returns {{ regions, thresholdCanvas, components, stats }}
 */
export function detectTextRegions(sourceCanvas, opts = {}) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;

  // 1) Working canvas: grayscale + contrast + binarize (source untouched).
  const work = document.createElement('canvas');
  work.width = w;
  work.height = h;
  const ctx = work.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  toGrayscale(img);
  applyContrast(img, opts.contrastFactor ?? 1.6);
  threshold(img, opts.threshold ?? null); // binarizes in place
  ctx.putImageData(img, 0, 0);

  // foreground = dark pixels (value 0 after binarization).
  const data = img.data;
  const bin = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    bin[p] = data[i] < 128 ? 1 : 0;
  }

  // 2) Connected components.
  const all = connectedComponents(bin, w, h);

  // 3) Character-like component filters (fractions of image size).
  const minCharH = h * (opts.minCharHFrac ?? 0.006);
  const maxCharH = h * (opts.maxCharHFrac ?? 0.06);
  const minCharW = w * (opts.minCharWFrac ?? 0.002);
  const maxCharW = w * (opts.maxCharWFrac ?? 0.12);
  const maxAspect = opts.maxAspect ?? 8;
  const minArea = minCharH * minCharW;
  let keep = [];
  for (const c of all) {
    if (c.h < minCharH || c.h > maxCharH) continue;
    if (c.w < minCharW || c.w > maxCharW) continue;
    const aspect = c.w / c.h;
    if (aspect > maxAspect || aspect < 1 / maxAspect) continue; // reject long geometry lines
    if (c.area < minArea) continue; // reject specks
    keep.push(c);
  }

  // Exclude components that fall inside pre-detected drawing analysis regions
  // (title block / large tabular structures) so the dimension detector ignores
  // them. Originals are not modified; this only affects the dimension search.
  if (opts.exclude && opts.exclude.length) {
    const ex = opts.exclude;
    keep = keep.filter(
      (c) => !ex.some((e) => c.cx >= e.x && c.cx <= e.x + e.w && c.cy >= e.y && c.cy <= e.y + e.h)
    );
  }

  // Estimate character size from survivors (medians).
  const charHs = keep.map((c) => c.h).sort((a, b) => a - b);
  const charWs = keep.map((c) => c.w).sort((a, b) => a - b);
  const medianCharH = charHs.length ? charHs[Math.floor(charHs.length / 2)] : h * 0.02;
  const medianCharW = charWs.length ? charWs[Math.floor(charWs.length / 2)] : w * 0.01;

  // 4) Greedy text-line grouping: build a probable line by extending left and
  //    right while neighboring components share a baseline (substantial vertical
  //    overlap), have similar heights, and are reasonably spaced. A bounding
  //    box is created only after the line is formed — never per component.
  const spacingThr = Math.max(medianCharW * (opts.spacingFactor ?? 2), medianCharH * (opts.maxGapFactor ?? 1.5));
  const baselineOverlapMin = opts.baselineOverlapMin ?? 0.4;
  const heightRatioMin = opts.heightRatioMin ?? 0.4;
  const minComponents = opts.minComponentsPerRegion ?? 2;
  const regions = [];
  const byX = keep.map((c, i) => ({ c, i })).sort((a, b) => a.c.x - b.c.x);
  const used = new Array(keep.length).fill(false);
  for (let k = 0; k < byX.length; k++) {
    if (used[byX[k].i]) continue;
    const group = [byX[k]];
    used[byX[k].i] = true;
    let changed = true;
    while (changed) {
      changed = false;
      let lx = Infinity, ly = Infinity, rx = -Infinity, by = -Infinity;
      for (const g of group) {
        const c = g.c;
        if (c.x < lx) lx = c.x;
        if (c.y < ly) ly = c.y;
        if (c.x + c.w > rx) rx = c.x + c.w;
        if (c.y + c.h > by) by = c.y + c.h;
      }
      const hs = group.map((g) => g.c.h).sort((a, b) => a - b);
      const medH = hs.length ? hs[Math.floor(hs.length / 2)] : medianCharH;
      for (let m = 0; m < byX.length; m++) {
        const idx = byX[m].i;
        if (used[idx]) continue;
        const c = byX[m].c;
        const gap = c.x >= rx ? c.x - rx : c.x + c.w <= lx ? lx - (c.x + c.w) : 0;
        if (gap > spacingThr) continue;
        if (overlapRatio(ly, by - ly, c.y, c.h) < baselineOverlapMin) continue;
        if (Math.min(c.h, medH) / Math.max(1, Math.max(c.h, medH)) < heightRatioMin) continue;
        group.push(byX[m]);
        used[idx] = true;
        changed = true;
      }
    }
    flushGroup(group.map((g) => g.c), regions, minComponents);
  }

  // 5) Reject overly large regions (whole-drawing geometry).
  const maxRegionW = w * (opts.maxRegionWFrac ?? 0.95);
  const maxRegionH = h * (opts.maxRegionHFrac ?? 0.4);
  const maxRegionArea = w * h * (opts.maxRegionAreaFrac ?? 0.05);
  const finalRegions = regions.filter(
    (rg) => rg.w <= maxRegionW && rg.h <= maxRegionH && rg.w * rg.h <= maxRegionArea
  );

  return {
    regions: finalRegions,
    thresholdCanvas: work,
    components: keep,
    stats: {
      totalComponents: all.length,
      charComponents: keep.length,
      regions: finalRegions.length,
      medianCharH: Math.round(medianCharH),
      medianCharW: Math.round(medianCharW),
    },
  };
}

/**
 * Crop a single detected region out of the high-resolution render with padding
 * so characters are not clipped. Coordinates are clamped to the canvas bounds.
 * The source canvas is not modified.
 *
 * @returns {{ canvas, x, y, width, height }} the crop canvas and its top-left
 *   coordinate (including padding) on the source render.
 */
export function cropRegion(sourceCanvas, region, padding = 15) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const x = Math.max(0, Math.round(region.x - padding));
  const y = Math.max(0, Math.round(region.y - padding));
  const width = Math.min(w - x, Math.round(region.w + padding * 2));
  const height = Math.min(h - y, Math.round(region.h + padding * 2));
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  c.getContext('2d').drawImage(sourceCanvas, x, y, width, height, 0, 0, width, height);
  return { canvas: c, x, y, width, height };
}

/**
 * Expansion levels tested before generating an OCR crop. Expansion is applied
 * equally to all four sides as a proportion of the detected region's width
 * and height, then clamped to the page boundaries.
 */
export const EXPANSION_LEVELS = [
  { key: 'original', label: 'Original', color: '#ef4444', factor: 0 },
  { key: 'small', label: 'Small +15%', color: '#f59e0b', factor: 0.15 },
  { key: 'medium', label: 'Medium +30%', color: '#22c55e', factor: 0.30 },
  { key: 'large', label: 'Large +50%', color: '#06b6d4', factor: 0.50 },
];

/** Expand a region equally on all four sides by factor*w / factor*h, clamped to bounds. */
export function expandRegion(region, factor, bounds) {
  const dx = region.w * factor;
  const dy = region.h * factor;
  const x = Math.max(0, Math.round(region.x - dx));
  const y = Math.max(0, Math.round(region.y - dy));
  const right = Math.min(bounds.w, Math.round(region.x + region.w + dx));
  const bottom = Math.min(bounds.h, Math.round(region.y + region.h + dy));
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * Directional expansion: favors the text's long axis to recover clipped
 * first/last characters without grabbing excessive geometry above/below.
 * Horizontal text (w >= h): left/right = 50% of height, top/bottom = 20%.
 * Vertical text (h > w): the same logic rotated 90° — top/bottom = 50% of
 * width, left/right = 20%. Result is clamped to page bounds.
 */
export function expandRegionDirectional(region, bounds) {
  const horizontal = region.w >= region.h;
  const basis = horizontal ? region.h : region.w;
  const longPad = basis * 0.5;
  const shortPad = basis * 0.2;
  const leftPad = horizontal ? longPad : shortPad;
  const rightPad = horizontal ? longPad : shortPad;
  const topPad = horizontal ? shortPad : longPad;
  const bottomPad = horizontal ? shortPad : longPad;
  const x = Math.max(0, Math.round(region.x - leftPad));
  const y = Math.max(0, Math.round(region.y - topPad));
  const right = Math.min(bounds.w, Math.round(region.x + region.w + rightPad));
  const bottom = Math.min(bounds.h, Math.round(region.y + region.h + bottomPad));
  return { x, y, w: right - x, h: bottom - y, orientation: horizontal ? 'horizontal' : 'vertical' };
}

/**
 * Final OCR crop expansion: padding is based on the detected text region's
 * estimated character height (not a percentage of width). For horizontal text,
 * left/right = 1.0× char height and top/bottom = 0.40× char height, so the
 * first/last characters of a dimension are not clipped without grabbing much
 * geometry above/below. Vertical text rotates the same logic (heavy padding on
 * top/bottom). The result is clamped to the page boundary.
 */
export function expandRegionForOcr(region, bounds) {
  const horizontal = region.w >= region.h;
  const charH = horizontal ? region.h : region.w;
  const longPad = charH * 1.0;
  const shortPad = charH * 0.4;
  const leftPad = horizontal ? longPad : shortPad;
  const rightPad = horizontal ? longPad : shortPad;
  const topPad = horizontal ? shortPad : longPad;
  const bottomPad = horizontal ? shortPad : longPad;
  const x = Math.max(0, Math.round(region.x - leftPad));
  const y = Math.max(0, Math.round(region.y - topPad));
  const right = Math.min(bounds.w, Math.round(region.x + region.w + rightPad));
  const bottom = Math.min(bounds.h, Math.round(region.y + region.h + bottomPad));
  return {
    x,
    y,
    w: right - x,
    h: bottom - y,
    orientation: horizontal ? 'horizontal' : 'vertical',
    charH: Math.round(charH),
    padding: { left: longPad, right: longPad, top: shortPad, bottom: shortPad },
  };
}

// ---- Region merging (diagnostic stage before OCR) ----
//
// The row splitter may break one engineering callout into several adjacent
// regions. These helpers propose merges for pairs that look like they belong
// to the same callout, without discarding the originals.

function overlapRatio(aStart, aLen, bStart, bLen) {
  const aEnd = aStart + aLen;
  const bEnd = bStart + bLen;
  const overlap = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
  const denom = Math.min(aLen, bLen);
  return denom > 0 ? overlap / denom : 0;
}

function axisGap(a, b, axis) {
  // Smallest positive extent gap between a and b along `axis` ('x' or 'y').
  const aStart = axis === 'x' ? a.x : a.y;
  const aLen = axis === 'x' ? a.w : a.h;
  const bStart = axis === 'x' ? b.x : b.y;
  const bLen = axis === 'x' ? b.w : b.h;
  const left = aStart <= bStart ? a : b;
  const right = aStart <= bStart ? b : a;
  const lEnd = (axis === 'x' ? left.x : left.y) + (axis === 'x' ? left.w : left.h);
  const rStart = axis === 'x' ? right.x : right.y;
  return rStart - lEnd;
}

/**
 * Decide whether two regions are merge candidates.
 * Horizontal text: same baseline (vertical overlap), similar heights, and a
 *   horizontal gap < ~1.5× the average height.
 * Vertical text: same column (horizontal overlap), similar widths, and a
 *   vertical gap < ~1.5× the average width.
 */
function mergeable(a, b, opts = {}) {
  const avgH = (a.h + b.h) / 2;
  const avgW = (a.w + b.w) / 2;
  const hGap = axisGap(a, b, 'x');
  const vGap = axisGap(a, b, 'y');
  const vOverlap = overlapRatio(a.y, a.h, b.y, b.h);
  const hOverlap = overlapRatio(a.x, a.w, b.x, b.w);
  const hRatio = Math.min(a.h, b.h) / Math.max(1, Math.max(a.h, b.h));
  const wRatio = Math.min(a.w, b.w) / Math.max(1, Math.max(a.w, b.w));
  const gapHF = opts.horizontalGapFactor ?? 1.5;
  const gapVF = opts.verticalGapFactor ?? 1.5;
  const overlapMin = opts.overlapMin ?? 0.5;
  const ratioMin = opts.ratioMin ?? 0.7;
  const horizMerge =
    vOverlap >= overlapMin &&
    hRatio >= ratioMin &&
    hGap < gapHF * avgH &&
    hGap >= -0.05 * avgH; // allow tiny bbox overlap, reject heavy stacking
  const vertMerge =
    hOverlap >= overlapMin &&
    wRatio >= ratioMin &&
    vGap < gapVF * avgW &&
    vGap >= -0.05 * avgW;
  return horizMerge || vertMerge;
}

/**
 * Union-find merge of detected regions into proposed merged regions.
 * Original regions are never modified.
 *
 * @returns {{ merged: object[], groups: number[][] }}
 *   merged[i] = { x, y, w, h, sourceIndices } (bbox of group i)
 *   groups[i] = array of original region indices in group i
 */
export function mergeRegions(regions, opts = {}) {
  const n = regions.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => {
    let r = x;
    while (parent[r] !== r) { parent[r] = parent[parent[r]]; r = parent[r]; }
    return r;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (mergeable(regions[i], regions[j], opts)) union(i, j);
    }
  }
  const groupsMap = {};
  for (let i = 0; i < n; i++) {
    const r = find(i);
    (groupsMap[r] = groupsMap[r] || []).push(i);
  }
  const groups = Object.values(groupsMap);
  const merged = groups.map((group) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const idx of group) {
      const r = regions[idx];
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, sourceIndices: group };
  });
  return { merged, groups };
}

/**
 * Decide whether two EXPANDED regions are merge candidates. Expanded boxes
 * already carry character-height padding, so adjacency shows up as box overlap.
 * Candidates must overlap, share a baseline (or column for vertical text), and
 * have similar sizes — stacked lines whose padding does not overlap are left
 * alone.
 */
function mergeableExpanded(a, b, opts = {}) {
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(a.x + a.w, b.x + b.w);
  const iy2 = Math.min(a.y + a.h, b.y + b.h);
  if (ix2 <= ix1 || iy2 <= iy1) return false; // no overlap between expanded boxes
  const overlapMin = opts.overlapMin ?? 0.4;
  const ratioMin = opts.ratioMin ?? 0.5;
  const vOverlap = overlapRatio(a.y, a.h, b.y, b.h);
  const hOverlap = overlapRatio(a.x, a.w, b.x, b.w);
  const hRatio = Math.min(a.h, b.h) / Math.max(1, Math.max(a.h, b.h));
  const wRatio = Math.min(a.w, b.w) / Math.max(1, Math.max(a.w, b.w));
  const horiz = vOverlap >= overlapMin && hRatio >= ratioMin;
  const vert = hOverlap >= overlapMin && wRatio >= ratioMin;
  return horiz || vert;
}

/**
 * Region merging on the EXPANDED text regions (the greedy text-line regions
 * after character-height padding). For each group of candidates the merged
 * bounding box is the union of BOTH complete expanded regions, with ADDITIONAL
 * character-height-based padding (1.0× long axis, 0.40× short axis, rotated for
 * vertical text) applied around that union, clamped to the page. The merged box
 * is meant to be cropped from the original high-resolution render — never built
 * by stitching previously cropped images.
 *
 * @returns {{ merged: object[], groups: number[][] }}
 *   merged[i] = { x, y, w, h, charH, padding, unionBox, sourceIndices }
 */
export function mergeExpandedRegions(expanded, bounds, opts = {}) {
  const n = expanded.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => {
    let r = x;
    while (parent[r] !== r) { parent[r] = parent[parent[r]]; r = parent[r]; }
    return r;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (mergeableExpanded(expanded[i], expanded[j], opts)) union(i, j);
    }
  }
  const groupsMap = {};
  for (let i = 0; i < n; i++) {
    const r = find(i);
    (groupsMap[r] = groupsMap[r] || []).push(i);
  }
  const groups = Object.values(groupsMap);
  const merged = groups.map((group) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let charHSum = 0;
    for (const idx of group) {
      const e = expanded[idx];
      minX = Math.min(minX, e.x);
      minY = Math.min(minY, e.y);
      maxX = Math.max(maxX, e.x + e.w);
      maxY = Math.max(maxY, e.y + e.h);
      charHSum += e.charH || (e.w >= e.h ? e.h : e.w);
    }
    const unionBox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    const charH = charHSum / group.length;
    const horizontal = unionBox.w >= unionBox.h;
    const longPad = charH * 1.0;
    const shortPad = charH * 0.4;
    const leftPad = horizontal ? longPad : shortPad;
    const rightPad = horizontal ? longPad : shortPad;
    const topPad = horizontal ? shortPad : longPad;
    const bottomPad = horizontal ? shortPad : longPad;
    const x = Math.max(0, Math.round(unionBox.x - leftPad));
    const y = Math.max(0, Math.round(unionBox.y - topPad));
    const right = Math.min(bounds.w, Math.round(unionBox.x + unionBox.w + rightPad));
    const bottom = Math.min(bounds.h, Math.round(unionBox.y + unionBox.h + bottomPad));
    return {
      x,
      y,
      w: right - x,
      h: bottom - y,
      charH: Math.round(charH),
      padding: { left: longPad, right: longPad, top: shortPad, bottom: shortPad },
      unionBox,
      sourceIndices: group,
    };
  });
  return { merged, groups };
}

/** Crop an arbitrary bounding box (already in source-canvas coords) from a render. */
export function cropBox(sourceCanvas, box) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const x = Math.max(0, Math.round(box.x));
  const y = Math.max(0, Math.round(box.y));
  const width = Math.max(1, Math.min(w - x, Math.round(box.w)));
  const height = Math.max(1, Math.min(h - y, Math.round(box.h)));
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  c.getContext('2d').drawImage(sourceCanvas, x, y, width, height, 0, 0, width, height);
  return { canvas: c, x, y, width, height };
}

/**
 * Overlay the original + three expanded boxes (distinguishable colors) and the
 * region number on a copy of the display canvas. `regions` are in source-canvas
 * pixel coords; `scale` maps them to the display canvas. `sourceW/sourceH` are
 * the full-resolution page bounds used for clamping expansion.
 */
export function drawExpansionOverlay(baseCanvas, regions, scale, sourceW, sourceH) {
  const out = document.createElement('canvas');
  out.width = baseCanvas.width;
  out.height = baseCanvas.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(baseCanvas, 0, 0);
  const bounds = { w: sourceW, h: sourceH };
  const order = [...EXPANSION_LEVELS].reverse(); // large → original (original on top)
  const fontPx = Math.max(9, 12 * scale);
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    for (const lvl of order) {
      const box = lvl.factor === 0 ? r : expandRegion(r, lvl.factor, bounds);
      ctx.lineWidth = Math.max(1, (lvl.key === 'original' ? 2 : 1.5) * scale);
      ctx.strokeStyle = lvl.color;
      ctx.strokeRect(box.x * scale, box.y * scale, box.w * scale, box.h * scale);
    }
    const large = expandRegion(r, 0.5, bounds);
    ctx.font = `bold ${fontPx}px sans-serif`;
    ctx.fillStyle = '#06b6d4';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${i + 1}`, large.x * scale + 2, large.y * scale - 2);
  }
  return out;
}

/**
 * Draw detected regions as rectangles over a copy of a base (display) canvas.
 * `regions` are in source-canvas pixel coordinates; `scale` maps them to the
 * base canvas. The base canvas is not modified.
 */
export function drawRegionsOverlay(baseCanvas, regions, scale = 1) {
  const out = document.createElement('canvas');
  out.width = baseCanvas.width;
  out.height = baseCanvas.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(baseCanvas, 0, 0);
  ctx.lineWidth = Math.max(1, 2 * scale);
  ctx.strokeStyle = '#06b6d4';
  ctx.fillStyle = 'rgba(6, 182, 212, 0.15)';
  for (const r of regions) {
    const x = r.x * scale;
    const y = r.y * scale;
    const w = r.w * scale;
    const h = r.h * scale;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }
  return out;
}

// ---- Drawing Analysis Regions (experimental exclusion stage) ----
//
// Before the dimension detector runs, we try to identify the outer drawing
// border and large tabular structures (title block / tables) so their text can
// be excluded from dimension-region detection. Pure canvas image processing;
// the PDF is never modified and the originals are not discarded.

function mergeLines(lines, posKey, extKeys, tol = 3) {
  if (!lines.length) return [];
  const sorted = [...lines].sort((a, b) => a[posKey] - b[posKey]);
  const merged = [];
  for (const ln of sorted) {
    const last = merged[merged.length - 1];
    if (
      last &&
      Math.abs(ln[posKey] - last[posKey]) <= tol &&
      last[extKeys[1]] >= ln[extKeys[0]] &&
      ln[extKeys[1]] >= last[extKeys[0]]
    ) {
      last[posKey] = (last[posKey] + ln[posKey]) / 2;
      last[extKeys[0]] = Math.min(last[extKeys[0]], ln[extKeys[0]]);
      last[extKeys[1]] = Math.max(last[extKeys[1]], ln[extKeys[1]]);
    } else {
      merged.push({ ...ln });
    }
  }
  return merged;
}

function findLines(bin, w, h, opts = {}) {
  const minHRun = Math.round(w * (opts.minHRunFrac ?? 0.3));
  const minVRun = Math.round(h * (opts.minVRunFrac ?? 0.2));
  const horiz = [];
  for (let y = 0; y < h; y++) {
    let runStart = -1;
    for (let x = 0; x <= w; x++) {
      const dark = x < w && bin[y * w + x] === 1;
      if (dark && runStart < 0) runStart = x;
      else if (!dark && runStart >= 0) {
        if (x - runStart >= minHRun) horiz.push({ y, x1: runStart, x2: x });
        runStart = -1;
      }
    }
  }
  const vert = [];
  for (let x = 0; x < w; x++) {
    let runStart = -1;
    for (let y = 0; y <= h; y++) {
      const dark = y < h && bin[y * w + x] === 1;
      if (dark && runStart < 0) runStart = y;
      else if (!dark && runStart >= 0) {
        if (y - runStart >= minVRun) vert.push({ x, y1: runStart, y2: y });
        runStart = -1;
      }
    }
  }
  return {
    horiz: mergeLines(horiz, 'y', ['x1', 'x2']).slice(0, 80),
    vert: mergeLines(vert, 'x', ['y1', 'y2']).slice(0, 80),
  };
}

function rectsIoU(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const iw = Math.max(0, x2 - x1);
  const ih = Math.max(0, y2 - y1);
  const inter = iw * ih;
  return inter / (a.w * a.h + b.w * b.h - inter + 1e-9);
}

function dedupRects(rects) {
  const sorted = [...rects].sort((a, b) => b.w * b.h - a.w * a.h);
  const out = [];
  for (const r of sorted) {
    if (out.every((o) => rectsIoU(o, r) < 0.4)) out.push(r);
  }
  return out;
}

function findRectangles(horiz, vert, w, h) {
  const rects = [];
  for (let i = 0; i < horiz.length; i++) {
    for (let j = i + 1; j < horiz.length; j++) {
      const top = horiz[i];
      const bot = horiz[j];
      if (bot.y <= top.y) continue;
      const x1 = Math.max(top.x1, bot.x1);
      const x2 = Math.min(top.x2, bot.x2);
      const spanW = x2 - x1;
      if (spanW < w * 0.08) continue;
      const yTol = Math.max(4, (bot.y - top.y) * 0.1);
      const xTol = Math.max(4, spanW * 0.05);
      for (const v1 of vert) {
        if (Math.abs(v1.x - x1) > xTol) continue;
        if (v1.y1 > top.y + yTol || v1.y2 < bot.y - yTol) continue;
        for (const v2 of vert) {
          if (v2.x <= v1.x) continue;
          if (Math.abs(v2.x - x2) > xTol) continue;
          if (v2.y1 > top.y + yTol || v2.y2 < bot.y - yTol) continue;
          const rx = Math.min(v1.x, v2.x);
          const ry = Math.min(top.y, bot.y);
          rects.push({ x: rx, y: ry, w: Math.abs(v2.x - v1.x), h: Math.abs(bot.y - top.y) });
        }
      }
    }
  }
  return dedupRects(rects);
}

/**
 * Detect the drawing analysis regions: the outer border and large tabular
 * structures (title block / tables) to exclude from dimension detection.
 * The source canvas is not modified.
 *
 * @returns {{ border, tables, lines }}
 *   border: { x, y, w, h } drawing analysis region (page bounds if no border)
 *   tables: [{ id, x, y, w, h, type, enabled }]
 */
export function detectExclusionRegions(sourceCanvas, opts = {}) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const work = document.createElement('canvas');
  work.width = w;
  work.height = h;
  const ctx = work.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  toGrayscale(img);
  applyContrast(img, opts.contrastFactor ?? 1.4);
  threshold(img, opts.threshold ?? null);
  ctx.putImageData(img, 0, 0);
  const data = img.data;
  const bin = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) bin[p] = data[i] < 128 ? 1 : 0;

  const { horiz, vert } = findLines(bin, w, h, opts);

  // Outer border from the widest horizontal + vertical lines.
  const wideHoriz = horiz.filter((l) => l.x2 - l.x1 >= w * 0.5);
  const wideVert = vert.filter((l) => l.y2 - l.y1 >= h * 0.5);
  let border = null;
  if (wideHoriz.length >= 2 && wideVert.length >= 2) {
    const top = wideHoriz.reduce((m, l) => (l.y < m.y ? l : m));
    const bottom = wideHoriz.reduce((m, l) => (l.y > m.y ? l : m));
    const left = wideVert.reduce((m, l) => (l.x < m.x ? l : m));
    const right = wideVert.reduce((m, l) => (l.x > m.x ? l : m));
    border = {
      x: Math.min(left.x, right.x),
      y: Math.min(top.y, bottom.y),
      w: Math.abs(right.x - left.x),
      h: Math.abs(bottom.y - top.y),
    };
  }
  if (!border) border = { x: 0, y: 0, w, h };

  // Large rectangles formed by long horizontal + vertical lines.
  const rects = findRectangles(horiz, vert, w, h);
  const minArea = w * h * (opts.minTableAreaFrac ?? 0.005);
  const tables = rects
    .filter((r) => r.w * r.h >= minArea && r.w >= w * 0.08)
    .map((r, i) => {
      const cy = r.y + r.h / 2;
      const type = cy > h * (opts.titleBlockYFrac ?? 0.6) ? 'title_block' : 'table';
      return {
        id: i + 1,
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        type,
        enabled: type === 'title_block' || r.w * r.h > w * h * 0.02,
      };
    })
    .slice(0, 20);

  return { border, tables, lines: { horiz: horiz.length, vert: vert.length } };
}