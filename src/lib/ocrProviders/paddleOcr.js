// Experimental PaddleOCR provider (second OCR engine).
//
// Uses the official @paddleocr/paddleocr-js SDK, which runs the PP-OCR pipeline
// locally in the browser via ONNX Runtime Web (WASM). No drawing data is sent to
// an external cloud OCR service — inference happens in-page. Model weights are
// fetched from the PaddlePaddle model registry on first use (same pattern as
// Tesseract.js fetching its traineddata), and the npm package itself travels
// with the app when exported from Base44.
//
// Stronger than Tesseract.js for printed/technical text and returns per-line
// bounding boxes (polygons) + recognition scores. Results are mapped into the
// standardized OCR JSON item shape so downstream code stays engine-agnostic.

export const id = 'paddleocr';

// Lazily import the SDK so the heavy ONNX Runtime Web bundle is only loaded
// when this provider is actually used — it never enters the module graph for
// pages that don't run OCR.
let PaddleOCRCtor = null;
let servicePromise = null;

async function getService(onStatus) {
  if (!servicePromise) {
    if (onStatus) onStatus('Loading PaddleOCR SDK + model (first run downloads weights)');
    servicePromise = (async () => {
      if (!PaddleOCRCtor) {
        const mod = await import('@paddleocr/paddleocr-js');
        PaddleOCRCtor = mod.PaddleOCR;
      }
      return PaddleOCRCtor.create({
        lang: 'en',
        ocrVersion: 'PP-OCRv5',
        ortOptions: {
          backend: 'wasm',
          wasmPaths: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/',
          numThreads: 1,
          simd: true,
        },
      });
    })().catch((err) => {
      servicePromise = null;
      throw err;
    });
  }
  return servicePromise;
}

// PaddleOCR returns a 4-point polygon as a flat array [x1,y1,x2,y2,...].
// Convert to an axis-aligned bounding box.
function polyToBbox(poly) {
  if (!poly || poly.length < 2) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = [];
  const ys = [];
  for (let i = 0; i < poly.length; i += 2) {
    xs.push(poly[i]);
    ys.push(poly[i + 1]);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * OCR a full drawing-page image. Returns standardized per-line items.
 */
export async function analyzeDrawingPage(image, { pageNumber = 1, onStatus } = {}) {
  const svc = await getService(onStatus);
  if (onStatus) onStatus('Running PaddleOCR');
  const [result] = await svc.predict(image);
  const items = (result?.items || []).map((it) => ({
    text: it.text || '',
    page: pageNumber,
    ...polyToBbox(it.poly),
    confidence: typeof it.score === 'number' ? it.score : 0,
    orientation: 0,
    source: id,
  }));
  const avgConf = items.length
    ? items.reduce((s, i) => s + (i.confidence || 0), 0) / items.length
    : 0;
  return {
    items,
    text: items.map((i) => i.text).join('\n'),
    confidence: avgConf,
    metrics: result?.metrics,
  };
}

/**
 * OCR a single region crop. PaddleOCR runs detection + recognition on the crop;
 * recognized lines are merged into one standardized item positioned at
 * regionBbox in page coordinates.
 */
export async function analyzeRegion(image, { pageNumber = 1, regionBbox = null, onStatus } = {}) {
  const svc = await getService(onStatus);
  if (onStatus) onStatus('Running PaddleOCR');
  const [result] = await svc.predict(image);
  const lines = result?.items || [];
  const text = lines.map((it) => it.text || '').join(' ').trim();
  const confidence = lines.length
    ? lines.reduce((s, it) => s + (typeof it.score === 'number' ? it.score : 0), 0) / lines.length
    : 0;
  const item = {
    text,
    page: pageNumber,
    x: regionBbox?.x ?? 0,
    y: regionBbox?.y ?? 0,
    width: regionBbox?.w ?? image?.width ?? 0,
    height: regionBbox?.h ?? image?.height ?? 0,
    confidence,
    orientation: 0,
    source: id,
  };
  return { items: [item], text, confidence, orientation: 0 };
}

export default { id, analyzeDrawingPage, analyzeRegion };