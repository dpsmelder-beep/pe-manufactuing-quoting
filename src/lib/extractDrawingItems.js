// Orchestrate the full drawing-text extraction pipeline for a single PDF and
// return a flat array of standardized items (embedded PDF text where present,
// PaddleOCR fallback otherwise) ready for the engineering drawing parser.
//
// Portable: no Base44 / UI dependencies — only pdf.js (./pdfOcrService) and the
// OCR provider registry (./ocrProviders).

import {
  loadPdf,
  extractEmbeddedText,
  renderPageToCanvas,
  EMBEDDED_TEXT_THRESHOLD,
  DEFAULT_OCR_SCALE,
} from './pdfOcrService';
import { getProvider } from './ocrProviders';

/**
 * Extract standardized text items from every page of a PDF drawing.
 * @param {string} url
 * @param {{ onStatus?: (msg: string) => void, scale?: number }} [opts]
 * @returns {Promise<{ items: any[], pagesPdf: number, pagesOcr: number, numPages: number }>}
 */
export async function extractDrawingItems(url, { onStatus, scale = DEFAULT_OCR_SCALE } = {}) {
  const pdf = await loadPdf(url);
  const allItems = [];
  let pagesPdf = 0;
  let pagesOcr = 0;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const { items, charCount } = await extractEmbeddedText(page, p);

    if (charCount >= EMBEDDED_TEXT_THRESHOLD) {
      allItems.push(...items);
      pagesPdf++;
      onStatus?.(`Page ${p}: embedded text (${charCount} chars)`);
      continue;
    }

    onStatus?.(`Page ${p}: rendering for OCR…`);
    const { canvas } = await renderPageToCanvas(page, scale);
    const provider = getProvider('paddleocr');
    onStatus?.(`Page ${p}: running PaddleOCR…`);
    const res = await provider.analyzeDrawingPage(canvas, { pageNumber: p });
    allItems.push(...(res.items || []));
    pagesOcr++;
  }

  return { items: allItems, pagesPdf, pagesOcr, numPages: pdf.numPages };
}