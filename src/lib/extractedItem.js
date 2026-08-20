// Standardized text-extraction item used across the app regardless of whether
// the text came from PDF.js embedded text or an OCR provider. Downstream
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
//   confidence: number | null  // 0-1 for OCR, null for embedded PDF text
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