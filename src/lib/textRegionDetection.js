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
//   4. Group components into rows by vertical alignment, then split each row
//      into rectangular regions by horizontal character spacing.
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
  const keep = [];
  for (const c of all) {
    if (c.h < minCharH || c.h > maxCharH) continue;
    if (c.w < minCharW || c.w > maxCharW) continue;
    const aspect = c.w / c.h;
    if (aspect > maxAspect || aspect < 1 / maxAspect) continue; // reject long geometry lines
    if (c.area < minArea) continue; // reject specks
    keep.push(c);
  }

  // Estimate character size from survivors (medians).
  const charHs = keep.map((c) => c.h).sort((a, b) => a - b);
  const charWs = keep.map((c) => c.w).sort((a, b) => a - b);
  const medianCharH = charHs.length ? charHs[Math.floor(charHs.length / 2)] : h * 0.02;
  const medianCharW = charWs.length ? charWs[Math.floor(charWs.length / 2)] : w * 0.01;

  // 4) Group components into rows by vertical alignment.
  const rowTol = medianCharH * (opts.rowTolFactor ?? 0.6);
  const sorted = keep.slice().sort((a, b) => a.cy - b.cy);
  const rows = [];
  for (const c of sorted) {
    let placed = false;
    for (const r of rows) {
      if (Math.abs(c.cy - r.cy) <= rowTol) { r.members.push(c); placed = true; break; }
    }
    if (!placed) rows.push({ cy: c.cy, members: [c] });
  }

  // Split each row into regions by horizontal character spacing.
  const maxGap = Math.max(medianCharW * (opts.maxGapFactor ?? 6), medianCharH * 3);
  const minComponents = opts.minComponentsPerRegion ?? 2;
  const regions = [];
  for (const r of rows) {
    r.members.sort((a, b) => a.cx - b.cx);
    let group = [];
    let prevRight = null;
    for (const c of r.members) {
      if (prevRight !== null && c.x - prevRight > maxGap) {
        flushGroup(group, regions, minComponents);
        group = [];
      }
      group.push(c);
      prevRight = c.x + c.w;
    }
    flushGroup(group, regions, minComponents);
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