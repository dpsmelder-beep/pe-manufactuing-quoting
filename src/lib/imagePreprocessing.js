// Portable image-preprocessing helpers for OCR of engineering drawings.
//
// Pure canvas / ImageData transforms — no Base44 UI or AI dependencies.
// Used to build multiple OCR test versions of a PDF page so we can measure
// which preprocessing produces the highest Tesseract.js accuracy.

/** Clone a canvas (and its contents) into a new detached canvas. */
export function cloneCanvas(source) {
  const c = document.createElement('canvas');
  c.width = source.width;
  c.height = source.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(source, 0, 0);
  return c;
}

/** Return a scaled copy of a canvas. */
export function scaleCanvas(source, scale) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(source.width * scale));
  c.height = Math.max(1, Math.round(source.height * scale));
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c;
}

function getImageData(canvas) {
  return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
}

function putImageData(canvas, imageData) {
  canvas.getContext('2d').putImageData(imageData, 0, 0);
}

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Convert RGBA ImageData to grayscale in place. */
export function toGrayscale(imageData) {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  return imageData;
}

/** Increase contrast in place. factor > 1 increases contrast. */
export function applyContrast(imageData, factor = 1.6) {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      d[i + c] = clamp((d[i + c] - 128) * factor + 128);
    }
  }
  return imageData;
}

/**
 * Light 3x3 sharpen kernel applied in place. Strength kept gentle so it
 * enhances character edges without amplifying paper noise.
 */
export function sharpen(imageData) {
  const { width: w, height: h, data: src } = imageData;
  const out = new Uint8ClampedArray(src.length);
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        let ki = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const sx = Math.min(w - 1, Math.max(0, x + kx));
            const sy = Math.min(h - 1, Math.max(0, y + ky));
            const idx = (sy * w + sx) * 4 + c;
            acc += src[idx] * kernel[ki++];
          }
        }
        const di = (y * w + x) * 4 + c;
        out[di] = clamp(acc);
      }
    }
  }
  imageData.data.set(out);
  return imageData;
}

/** Otsu auto threshold. Returns a level 0..255. */
function otsuLevel(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, max = 0, level = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) { max = between; level = t; }
  }
  return level;
}

/** Binarize in place using Otsu (or a fixed level). Assumes grayscale input. */
export function threshold(imageData, level = null) {
  const d = imageData.data;
  const hist = new Array(256).fill(0);
  const px = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    hist[d[i]]++;
  }
  const t = level != null ? level : otsuLevel(hist, px);
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] > t ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  return imageData;
}

/**
 * Build the three OCR test versions of a source (high-resolution) render.
 * The source canvas is never mutated; each version is a fresh canvas.
 *
 * @returns {{ key: string, label: string, method: string, canvas: HTMLCanvasElement }[]}
 */
export function buildOcrVersions(sourceCanvas) {
  // 1) Original high-resolution render — no preprocessing.
  const original = cloneCanvas(sourceCanvas);

  // 2) Grayscale + contrast.
  const grayCanvas = cloneCanvas(sourceCanvas);
  const grayData = getImageData(grayCanvas);
  toGrayscale(grayData);
  applyContrast(grayData, 1.6);
  putImageData(grayCanvas, grayData);

  // 3) Thresholded black & white: grayscale -> contrast -> light sharpen -> Otsu binarize.
  const bwCanvas = cloneCanvas(sourceCanvas);
  const bwData = getImageData(bwCanvas);
  toGrayscale(bwData);
  applyContrast(bwData, 1.6);
  sharpen(bwData);
  threshold(bwData);
  putImageData(bwCanvas, bwData);

  return [
    { key: 'original', label: 'Original HR Render', method: 'High-resolution PDF.js render only (no preprocessing)', canvas: original },
    { key: 'grayscale', label: 'Grayscale + Contrast', method: 'Grayscale + contrast enhancement', canvas: grayCanvas },
    { key: 'threshold', label: 'Thresholded B&W', method: 'Grayscale + contrast + light sharpen + Otsu binarization', canvas: bwCanvas },
  ];
}