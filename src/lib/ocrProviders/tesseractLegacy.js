// Legacy Tesseract.js OCR provider.
//
// Wraps the existing Tesseract.js logic behind the standardized OCR provider
// interface so the rest of the application does not depend directly on
// Tesseract.js. Treat this as a legacy/test provider — its accuracy is not
// sufficient for production. The actual Tesseract calls are delegated to the
// existing portable services (pdfOcrService / regionOcrService) which are frozen
// (no further tuning). When a stronger engine is added, it will implement the
// same interface and Tesseract can be removed without touching callers.

import { ocrCanvas } from '@/lib/pdfOcrService';
import { ocrRegionOrientations } from '@/lib/regionOcrService';

export const id = 'tesseract';

// Normalize confidence to 0..1 (Tesseract reports 0..100).
const norm = (c) => (typeof c === 'number' && c > 1 ? c / 100 : Number(c) || 0);

const orientationLabelToDeg = (label) =>
  label === '90° CW' ? 90 : label === '90° CCW' ? -90 : 0;

/**
 * OCR a full drawing-page image. Returns standardized word/line items.
 */
export async function analyzeDrawingPage(image, { pageNumber = 1, onStatus } = {}) {
  const { words, text, confidence } = await ocrCanvas(image, pageNumber, { onStatus });
  const items = (words || []).map((w) => ({
    text: w.text,
    page: w.page ?? pageNumber,
    x: w.x,
    y: w.y,
    width: w.width,
    height: w.height,
    confidence: norm(w.confidence),
    orientation: 0,
    source: id,
  }));
  return { items, text, confidence: norm(confidence) };
}

/**
 * OCR a single region crop. The legacy provider evaluates the original, 90° CW,
 * and 90° CCW orientations and keeps the strongest (existing behavior, unchanged).
 * Returns one standardized item positioned at regionBbox in page coordinates.
 */
export async function analyzeRegion(image, { pageNumber = 1, regionBbox = null, onStatus } = {}) {
  const { selected } = await ocrRegionOrientations(image, onStatus);
  const orientation = orientationLabelToDeg(selected.orientation);
  const item = {
    text: selected.text,
    page: pageNumber,
    x: regionBbox?.x ?? 0,
    y: regionBbox?.y ?? 0,
    width: regionBbox?.w ?? image?.width ?? 0,
    height: regionBbox?.h ?? image?.height ?? 0,
    confidence: norm(selected.confidence),
    orientation,
    source: id,
  };
  return { items: [item], text: selected.text, confidence: item.confidence, orientation };
}

export default { id, analyzeDrawingPage, analyzeRegion };