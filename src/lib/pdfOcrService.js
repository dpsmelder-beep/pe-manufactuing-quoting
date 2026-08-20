// Portable PDF text-extraction + OCR fallback.
//
// This module contains NO Base44-specific UI logic and NO Base44 AI
// dependencies. It relies only on:
//   - pdfjs-dist (PDF rendering / embedded text)
//   - tesseract.js (OCR)
//   - ./extractedItem (pure standardization helpers, also portable)
//
// It is intentionally framework-agnostic so that it keeps working unchanged
// when the application is exported from Base44 and run as a plain
// JavaScript/TypeScript web app.
//
// Standardized item shape (see ./extractedItem):
//   { text, page, x, y, width, height, source: 'pdf_text' | 'ocr', confidence }

import * as pdfjsLib from 'pdfjs-dist';
import { recognize as tesseractRecognize } from 'tesseract.js';
import { fromPdfText, fromOcrWord, flattenOcrWords } from './extractedItem';
import { buildOcrVersions } from './imagePreprocessing';

// Configure the pdf.js worker once. Consumers may override via setPdfWorkerSrc.
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

/** Minimum embedded-text chars a page needs to skip OCR. */
export const EMBEDDED_TEXT_THRESHOLD = 20;

/** Default render scale for off-screen OCR canvases. */
export const DEFAULT_OCR_SCALE = 3.0;

/** Higher render scale for OCR-preprocessing tests (~360 DPI at 72 DPI base). */
export const HIGH_OCR_SCALE = 5.0;

/**
 * Override the pdf.js worker source if you ship the worker locally.
 */
export function setPdfWorkerSrc(src) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = src;
}

/**
 * Load a PDF document from a URL using pdf.js.
 * @param {string} url
 * @returns {Promise<PDFDocumentProxy>}
 */
export async function loadPdf(url) {
  return pdfjsLib.getDocument({ url }).promise;
}

/**
 * Attempt embedded-text extraction for a single PDF page via pdf.js.
 * @returns {Promise<{ items: StandardizedItem[], charCount: number }>}
 */
export async function extractEmbeddedText(pdfPage, pageNum) {
  const content = await pdfPage.getTextContent();
  let charCount = 0;
  const items = [];
  for (const it of content.items) {
    const s = it.str ?? '';
    if (s.trim()) {
      items.push(fromPdfText(pageNum, it));
      charCount += s.trim().length;
    }
  }
  return { items, charCount };
}

/**
 * Render a PDF page to an off-screen canvas (white background) at the given
 * scale, suitable for OCR. Accepts either a pdf.js page or any object exposing
 * getViewport({ scale }) and render({ canvasContext, viewport }).
 * @returns {Promise<{ canvas: HTMLCanvasElement, viewport }>}
 */
export async function renderPageToCanvas(pdfPage, scale = DEFAULT_OCR_SCALE) {
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, viewport };
}

/**
 * Run Tesseract.js OCR on a rendered page image or canvas and return
 * standardized JSON items (source: 'ocr').
 *
 * @param {HTMLCanvasElement|HTMLImageElement|ImageLike} imageOrCanvas
 * @param {number} pageNum - 1-based page number attached to each item
 * @param {object} [opts]
 * @param {number} [opts.scale=DEFAULT_OCR_SCALE] - render scale used to produce
 *   the image; used to normalize bbox coordinates back to PDF user-space units.
 * @param {string} [opts.lang='eng'] - Tesseract language(s)
 * @param {(status: string)=>void} [opts.onStatus] - progress callback
 * @returns {Promise<{ words: StandardizedItem[], text: string, confidence: number|null }>}
 */
export async function ocrCanvas(imageOrCanvas, pageNum, { scale = DEFAULT_OCR_SCALE, lang = 'eng', onStatus } = {}) {
  const { data } = await tesseractRecognize(imageOrCanvas, lang, {
    logger: (m) => {
      if (m?.status === 'recognizing text') onStatus?.('Recognizing text');
    },
  });
  const canvasH = imageOrCanvas.height || 0;
  const words = flattenOcrWords(data).map((w) => fromOcrWord(pageNum, w, scale, canvasH));
  return {
    words,
    text: data.text || '',
    confidence: typeof data.confidence === 'number' ? data.confidence : null,
  };
}

/**
 * Build the three preprocessing variants of a high-resolution page render
 * (original, grayscale+contrast, thresholded B&W) and run Tesseract.js
 * against each. Used by the OCR-preprocessing diagnostic to compare which
 * method yields the best accuracy on engineering drawings. No version is
 * chosen automatically here.
 *
 * @param {HTMLCanvasElement} sourceCanvas - high-resolution PDF.js render
 * @param {number} pageNum
 * @param {object} [opts]
 * @param {string} [opts.lang='eng']
 * @param {(status: string)=>void} [opts.onStatus]
 * @returns {Promise<{ key, label, method, text, confidence, wordCount, error? }[]>}
 */
export async function runOcrVersions(sourceCanvas, pageNum, { lang = 'eng', onStatus } = {}) {
  const versions = buildOcrVersions(sourceCanvas);
  const results = [];
  for (const v of versions) {
    onStatus?.(`OCR ${v.label}`);
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    try {
      const { words, text, confidence } = await ocrCanvas(v.canvas, pageNum, {
        scale: HIGH_OCR_SCALE,
        lang,
        onStatus,
      });
      const processingMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
      results.push({
        key: v.key,
        label: v.label,
        method: v.method,
        ocrMethod: 'Whole Page OCR',
        text,
        confidence,
        wordCount: words.length,
        processingMs,
      });
    } catch (err) {
      const processingMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
      results.push({
        key: v.key,
        label: v.label,
        method: v.method,
        ocrMethod: 'Whole Page OCR',
        text: '',
        confidence: null,
        wordCount: 0,
        processingMs,
        error: err?.message || String(err),
      });
    }
  }
  onStatus?.('OCR versions complete');
  return results;
}

/**
 * Determine the overall extraction mode given the number of pages that used
 * embedded PDF text vs. pages that required OCR.
 * @returns {'PDF Embedded Text' | 'OCR' | 'Mixed'}
 */
export function computeExtractionMode(pagesPdf, pagesOcr) {
  if (pagesOcr === 0) return 'PDF Embedded Text';
  if (pagesPdf === 0) return 'OCR';
  return 'Mixed';
}