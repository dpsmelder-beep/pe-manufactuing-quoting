// Engineering Line Removal (experimental preprocessing stage).
//
// Uses OpenCV.js morphology to detect long horizontal/vertical drawing lines
// (dimension lines, extension lines, borders, table lines, long part edges) and
// remove them from a COPY of the high-resolution black-and-white drawing — never
// from the original PDF render used by the viewer. Only lines substantially
// longer than the estimated character height are removed, so short character
// strokes (1, 4, 7, T, L, E, +, ±, …) are preserved.
//
// Portable: depends only on the OpenCV.js loader and the browser canvas API.
// No OCR and no engineering interpretation is performed here.

import { loadOpenCV } from './opencvLoader';

function matToDataUrl(cv, rgbaMat) {
  const w = rgbaMat.cols;
  const h = rgbaMat.rows;
  const clamped = new Uint8ClampedArray(rgbaMat.data.length);
  clamped.set(rgbaMat.data);
  const imgData = new ImageData(clamped, w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').putImageData(imgData, 0, 0);
  return c.toDataURL();
}

/**
 * Detect and remove long horizontal/vertical lines from a black-and-white
 * canvas (dark text/lines on a white background, e.g. a thresholded render).
 *
 * @param {HTMLCanvasElement} bwCanvas - the high-res B&W drawing (a copy)
 * @param {number} charH - estimated character height in pixels
 * @param {number} factor - line length = charH * factor (default ~5)
 * @returns {Promise<{ detectedDataUrl, textDataUrl, lineLen }>}
 *   detectedDataUrl: the long line structures to remove (white on black)
 *   textDataUrl: the B&W drawing after those lines are removed (dark on white)
 */
export async function removeEngineeringLines(bwCanvas, charH, factor = 5) {
  const cv = await loadOpenCV();
  const w = bwCanvas.width;
  const h = bwCanvas.height;
  const ctx = bwCanvas.getContext('2d');
  const imgData = ctx.getImageData(0, 0, w, h);

  const src = cv.matFromImageData(imgData); // RGBA
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  const bin = new cv.Mat();
  // Dark foreground (text/lines) -> white (255) on black background.
  cv.threshold(gray, bin, 128, 255, cv.THRESH_BINARY_INV);

  const lineLen = Math.max(8, Math.round(charH * factor));

  // Horizontal lines: open with a wide horizontal kernel (keeps only long
  // horizontal runs). Vertical lines: open with a tall vertical kernel.
  const hKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(lineLen, 1));
  const vKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, lineLen));
  const hLines = new cv.Mat();
  const vLines = new cv.Mat();
  cv.morphologyEx(bin, hLines, cv.MORPH_OPEN, hKernel);
  cv.morphologyEx(bin, vLines, cv.MORPH_OPEN, vKernel);

  const detected = new cv.Mat();
  cv.bitwise_or(hLines, vLines, detected);

  // Remove detected lines from the foreground.
  const notDetected = new cv.Mat();
  cv.bitwise_not(detected, notDetected);
  const textFg = new cv.Mat();
  cv.bitwise_and(bin, notDetected, textFg);

  // Display text as dark on white (invert foreground).
  const textDisplay = new cv.Mat();
  cv.bitwise_not(textFg, textDisplay);

  const detectedRgba = new cv.Mat();
  const textRgba = new cv.Mat();
  cv.cvtColor(detected, detectedRgba, cv.COLOR_GRAY2RGBA);
  cv.cvtColor(textDisplay, textRgba, cv.COLOR_GRAY2RGBA);

  const detectedDataUrl = matToDataUrl(cv, detectedRgba);
  const textDataUrl = matToDataUrl(cv, textRgba);

  src.delete();
  gray.delete();
  bin.delete();
  hKernel.delete();
  vKernel.delete();
  hLines.delete();
  vLines.delete();
  detected.delete();
  notDetected.delete();
  textFg.delete();
  textDisplay.delete();
  detectedRgba.delete();
  textRgba.delete();

  return { detectedDataUrl, textDataUrl, lineLen };
}

function matToCanvas(cv, rgbaMat) {
  const w = rgbaMat.cols;
  const h = rgbaMat.rows;
  const clamped = new Uint8ClampedArray(rgbaMat.data.length);
  clamped.set(rgbaMat.data);
  const imgData = new ImageData(clamped, w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').putImageData(imgData, 0, 0);
  return c;
}

/**
 * Build the OpenCV line-removed image as a canvas (dark text on white) to be
 * used ONLY for locating/grouping text. Same morphology settings as
 * removeEngineeringLines. Returns the cleaned canvas and the detected-line
 * canvas for diagnostic display. The original PDF render is never modified.
 */
export async function getCleanedCanvas(bwCanvas, charH, factor = 5) {
  const cv = await loadOpenCV();
  const w = bwCanvas.width;
  const h = bwCanvas.height;
  const ctx = bwCanvas.getContext('2d');
  const imgData = ctx.getImageData(0, 0, w, h);

  const src = cv.matFromImageData(imgData);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  const bin = new cv.Mat();
  cv.threshold(gray, bin, 128, 255, cv.THRESH_BINARY_INV);

  const lineLen = Math.max(8, Math.round(charH * factor));
  const hKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(lineLen, 1));
  const vKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, lineLen));
  const hLines = new cv.Mat();
  const vLines = new cv.Mat();
  cv.morphologyEx(bin, hLines, cv.MORPH_OPEN, hKernel);
  cv.morphologyEx(bin, vLines, cv.MORPH_OPEN, vKernel);

  const detected = new cv.Mat();
  cv.bitwise_or(hLines, vLines, detected);
  const notDetected = new cv.Mat();
  cv.bitwise_not(detected, notDetected);
  const textFg = new cv.Mat();
  cv.bitwise_and(bin, notDetected, textFg);
  const textDisplay = new cv.Mat();
  cv.bitwise_not(textFg, textDisplay);

  const detectedRgba = new cv.Mat();
  const textRgba = new cv.Mat();
  cv.cvtColor(detected, detectedRgba, cv.COLOR_GRAY2RGBA);
  cv.cvtColor(textDisplay, textRgba, cv.COLOR_GRAY2RGBA);

  const cleanedCanvas = matToCanvas(cv, textRgba);
  const detectedCanvas = matToCanvas(cv, detectedRgba);

  src.delete();
  gray.delete();
  bin.delete();
  hKernel.delete();
  vKernel.delete();
  hLines.delete();
  vLines.delete();
  detected.delete();
  notDetected.delete();
  textFg.delete();
  textDisplay.delete();
  detectedRgba.delete();
  textRgba.delete();

  return { cleanedCanvas, detectedCanvas, lineLen };
}