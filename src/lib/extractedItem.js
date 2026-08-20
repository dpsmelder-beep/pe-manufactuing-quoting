// Standardized text-extraction item used across the app regardless of whether
// the text came from PDF.js embedded text or Tesseract.js OCR. Downstream
// consumers should only depend on this shape — no separate PDF-vs-OCR logic.
//
// {
//   text: string,          // the recognized/extracted text content
//   page: number,          // 1-based PDF page number
//   x: number,             // left coordinate in PDF user-space units (bottom-left origin)
//   y: number,             // bottom coordinate in PDF user-space units (bottom-left origin)
//   width: number,         // bounding box width in PDF user-space units
//   height: number,        // bounding box height in PDF user-space units
//   source: 'pdf_text' | 'ocr',
//   confidence: number | null  // 0-100 for OCR, null for embedded PDF text
// }

const round2 = (n) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

/**
 * Build a standardized item from a PDF.js getTextContent() text item.
 * `source` is 'pdf_text' and `confidence` is null (not applicable).
 */
export function fromPdfText(pageNum, item) {
  const tx = item.transform || [0, 0, 0, 0, 0, 0];
  const height = Math.abs(item.height || 0);
  return {
    text: item.str ?? '',
    page: pageNum,
    x: round2(tx[4]),
    y: round2(tx[5]),
    width: round2(item.width),
    height: round2(height),
    source: 'pdf_text',
    confidence: null,
  };
}

/**
 * Build a standardized item from a Tesseract.js word object.
 * `scale` is the render scale used for the off-screen canvas; canvasH is that
 * canvas's pixel height. Tesseract bboxes are canvas-space (top-left origin);
 * we convert to PDF user-space units (scale 1) with a bottom-left Y origin.
 * `source` is 'ocr' and `confidence` is a 0-100 number (or null if unknown).
 */
export function fromOcrWord(pageNum, word, scale, canvasH) {
  const b = word.bbox || {};
  const x0 = Number.isFinite(b.x0) ? b.x0 : 0;
  const y0 = Number.isFinite(b.y0) ? b.y0 : 0;
  const x1 = Number.isFinite(b.x1) ? b.x1 : x0;
  const y1 = Number.isFinite(b.y1) ? b.y1 : y0;
  return {
    text: word.text || '',
    page: pageNum,
    x: round2(x0 / scale),
    y: round2((canvasH - y1) / scale),
    width: round2((x1 - x0) / scale),
    height: round2((y1 - y0) / scale),
    source: 'ocr',
    confidence: typeof word.confidence === 'number' ? round2(word.confidence) : null,
  };
}

/**
 * Flatten nested Tesseract.js v5 output (blocks/paragraphs/lines/words) into a
 * flat array of word objects, falling back to a top-level data.words array.
 */
export function flattenOcrWords(data) {
  if (data.words && data.words.length) return data.words;
  return (data.blocks || []).flatMap((blk) =>
    (blk.paragraphs || []).flatMap((p) =>
      (p.lines || []).flatMap((l) => l.words || [])
    )
  );
}