// Reusable OCR provider architecture.
//
// The rest of the application should NOT import any OCR engine directly.
// Instead it calls the standardized OCR interface exposed by a provider
// obtained from this registry. Providers return a normalized JSON shape so
// downstream code (PDF.js, viewer, normalized drawing data, engineering
// parsing, UI) stays engine-agnostic.
//
// Standardized OCR result item shape:
//   {
//     text: string,                 // recognized text
//     page: number,                  // 1-based page number
//     x: number, y: number,         // bounding-box top-left (page pixels)
//     width: number, height: number, // bounding-box size (page pixels)
//     confidence: number,           // 0..1
//     orientation: number,          // degrees: 0 | 90 | -90
//     source: string                // provider id, e.g. "paddleocr"
//   }
//
// Provider interface (every provider implements):
//   id                                  -> string
//   analyzeDrawingPage(image, options)  -> Promise<{ items, text, confidence }>
//   analyzeRegion(image, options)       -> Promise<{ items, text, confidence, orientation }>
//
//   image   : HTMLCanvasElement | ImageData (page render or crop)
//   options : { pageNumber?, regionBbox?, onStatus? }
//     pageNumber  : 1-based page (defaults to 1)
//     regionBbox  : { x, y, w, h } in page pixels (for region crops; positions the
//                   recognized text back onto the page coordinate space)
//     onStatus    : (msg: string) => void  (live progress)
//
// Add a new provider by implementing the interface and registering it below —
// no other part of the app changes.

import paddleOcr from './paddleOcr';

export const DEFAULT_PROVIDER_ID = 'paddleocr';

// Provider metadata shown in any OCR engine selector. New engines get a row
// here once implemented.
export const PROVIDERS = [
  {
    id: 'paddleocr',
    label: 'PaddleOCR (PP-OCRv5)',
    description: 'In-browser OCR engine via ONNX Runtime Web. Runs locally; strong printed/technical-text accuracy.',
  },
];

const REGISTRY = {
  paddleocr: paddleOcr,
};

export function getProvider(id) {
  return REGISTRY[id] || REGISTRY[DEFAULT_PROVIDER_ID];
}

export function getProviderMeta(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
}