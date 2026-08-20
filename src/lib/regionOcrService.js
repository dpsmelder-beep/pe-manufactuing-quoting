// Portable region OCR with orientation handling.
//
// Reuses a single Tesseract.js worker across many crop recognitions for
// efficiency. For each candidate text crop it OCRs the original orientation,
// a 90°-clockwise copy, and a 90°-counterclockwise copy, then keeps the
// orientation with the strongest result (recognized text amount, tie-broken
// by confidence). No engineering interpretation is performed here.

import Tesseract from 'tesseract.js';
import { rotateCanvas } from './imagePreprocessing';

let workerPromise = null;
async function getWorker() {
  if (!workerPromise) workerPromise = Tesseract.createWorker('eng');
  return workerPromise;
}

/** OCR a single canvas. Returns { text, confidence, wordCount }. */
export async function ocrCanvasOnce(canvas) {
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas);
  const text = (data.text || '').trim();
  const confidence = typeof data.confidence === 'number' ? Math.round(data.confidence) : 0;
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const charCount = text.length;
  return { text, confidence, wordCount, charCount };
}

/**
 * OCR a crop in three orientations and pick the strongest.
 * @returns {{ selected, variants }}
 *   selected = { orientation, text, confidence, wordCount }
 *   variants = [{ orientation, text, confidence, wordCount }, ...]
 */
export async function ocrRegionOrientations(cropCanvas, onStatus) {
  const variants = [
    { orientation: 'Original', canvas: cropCanvas },
    { orientation: '90° CW', canvas: rotateCanvas(cropCanvas, 90) },
    { orientation: '90° CCW', canvas: rotateCanvas(cropCanvas, -90) },
  ];
  const results = [];
  for (const v of variants) {
    if (onStatus) onStatus(v.orientation);
    const r = await ocrCanvasOnce(v.canvas);
    results.push({ orientation: v.orientation, ...r });
  }
  // Score: more recognized words first, then higher confidence.
  const best = results
    .slice()
    .sort((a, b) => (b.wordCount * 100 + b.confidence) - (a.wordCount * 100 + a.confidence))[0];
  return { selected: best, variants: results };
}