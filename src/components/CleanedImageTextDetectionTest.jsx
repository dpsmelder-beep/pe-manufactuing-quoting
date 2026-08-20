import React, { useEffect, useRef, useState } from 'react';
import { Loader2, ChevronDown, ChevronRight, ScanSearch } from 'lucide-react';
import { loadPdf, renderPageToCanvas, HIGH_OCR_SCALE, ocrCanvas } from '@/lib/pdfOcrService';
import { detectTextRegions } from '@/lib/textRegionDetection';
import { detectCharacterTextRegions, cropRegionFromSource } from '@/lib/characterTextDetector';
import { getCleanedCanvas } from '@/lib/engineeringLineRemoval';
import { loadOpenCV } from '@/lib/opencvLoader';

const MAX_CANVAS_DIM = 3000;
const PREVIEW_W = 760;
const OCR_CAP = 50;       // bound OCR-readability checks per method
const CROP_PREVIEW_CAP = 30;

/**
 * Cleaned Image Text Detection Test (experimental diagnostic).
 *
 * Workflow per page:
 *   original high-res PDF render
 *     -> OpenCV engineering line removal -> cleaned detection image
 *     -> Character-Based Engineering Text Detector (run on BOTH the original
 *        render and the cleaned image, with identical settings)
 *     -> character grouping -> probable text-line regions -> final coords
 *
 * The cleaned image is used ONLY for locating/grouping text. Final crops are
 * always generated from the ORIGINAL high-res render (with the detector's
 * existing char-height padding), so OpenCV line removal cannot damage
 * characters before OCR. No engineering interpretation; production OCR is
 * unchanged.
 */
export default function CleanedImageTextDetectionTest({ url }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [status, setStatus] = useState('');
  const [pages, setPages] = useState([]);
  const originalRef = useRef(new Map());

  useEffect(() => {
    if (!url || !open) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(false);
      setLoadError(null);
      setPages([]);
      originalRef.current = new Map();
      setStatus('Loading PDF…');
      try {
        await loadOpenCV();
        if (cancelled) return;
        const pdf = await loadPdf(url);
        if (cancelled) return;
        const entries = [];
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          if (cancelled) return;
          const baseVp = page.getViewport({ scale: 1 });
          const maxDim = Math.max(baseVp.width, baseVp.height);
          const scale = Math.min(HIGH_OCR_SCALE, MAX_CANVAS_DIM / maxDim);
          setStatus(`Page ${p}: rendering at ×${scale.toFixed(2)}`);
          const { canvas: originalCanvas } = await renderPageToCanvas(page, scale);
          if (cancelled) return;
          originalRef.current.set(p, originalCanvas);

          // B&W analysis image + estimated char height (legacy detector, stats only).
          setStatus(`Page ${p}: building B&W analysis image`);
          const det = detectTextRegions(originalCanvas);
          const bwCanvas = det.thresholdCanvas;
          const charH = det.stats.medianCharH || Math.round(originalCanvas.height * 0.02);

          // OpenCV line removal -> cleaned detection image (canvas).
          setStatus(`Page ${p}: OpenCV line removal`);
          const { cleanedCanvas } = await getCleanedCanvas(bwCanvas, charH, 5);
          if (cancelled) return;

          // Run the SAME character detector on both images (default settings).
          setStatus(`Page ${p}: character detection (original)`);
          const origDet = detectCharacterTextRegions(originalCanvas);
          if (cancelled) return;
          setStatus(`Page ${p}: character detection (cleaned)`);
          const cleanDet = detectCharacterTextRegions(cleanedCanvas);
          if (cancelled) return;

          // Final crops always from the ORIGINAL render.
          const origCrops = origDet.regions.map((r) => cropRegionFromSource(originalCanvas, r));
          const cleanCrops = cleanDet.regions.map((r) => cropRegionFromSource(originalCanvas, r));

          // OCR readability (bounded) for each method.
          setStatus(`Page ${p}: OCR readability check`);
          const origReadable = await countReadable(origCrops, p, (s) => !cancelled && setStatus(`Page ${p}: ${s} (original)`));
          if (cancelled) return;
          const cleanReadable = await countReadable(cleanCrops, p, (s) => !cancelled && setStatus(`Page ${p}: ${s} (cleaned)`));
          if (cancelled) return;

          entries.push({
            pageNum: p,
            sourceW: originalCanvas.width,
            sourceH: originalCanvas.height,
            originalThumb: thumb(originalCanvas),
            cleanedThumb: thumb(cleanedCanvas),
            original: {
              components: origDet.components.length,
              lines: origDet.groups.length,
              regions: origDet.regions.length,
              regionsData: origDet.regions,
              readable: origReadable.readable,
              ocrChecked: origReadable.checked,
              ocrResults: origReadable.results,
            },
            cleaned: {
              components: cleanDet.components.length,
              lines: cleanDet.groups.length,
              regions: cleanDet.regions.length,
              regionsData: cleanDet.regions,
              readable: cleanReadable.readable,
              ocrChecked: cleanReadable.checked,
              ocrResults: cleanReadable.results,
              crops: cleanCrops.slice(0, CROP_PREVIEW_CAP).map((c) => c.canvas.toDataURL()),
            },
          });
          setPages([...entries]);
        }
        setStatus('Complete');
      } catch (err) {
        if (!cancelled) {
          setError(true);
          setLoadError(err?.message || String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [url, open]);

  return (
    <div className="border border-slate-200 rounded-lg mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 rounded-t-lg hover:bg-slate-100 transition"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Cleaned Image Text Detection Test
          <span className="text-xs text-slate-400 font-normal">Original vs Cleaned · experimental (dev/test)</span>
        </span>
        {loading && status && (
          <span className="flex items-center gap-1 text-xs text-slate-500 max-w-[60%] truncate">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> <span className="truncate">{status}</span>
          </span>
        )}
      </button>

      {open && (
        <div className="p-4 space-y-4">
          <p className="text-[11px] text-slate-500">
            OpenCV.js loaded locally. Same Character-Based detector settings are used on the original render and the OpenCV-cleaned image; final crops are always taken from the original render.
          </p>

          {loading && pages.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> {status || 'Preparing…'}
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center justify-center py-8 text-slate-500">
              <ScanSearch className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm">Cleaned image text detection failed.</p>
              <p className="text-xs text-slate-400">{loadError}</p>
            </div>
          )}

          {pages.map((pg) => (
            <div key={pg.pageNum} className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
                Page {pg.pageNum}
              </div>

              <div className="p-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
                <DetectionCard
                  title="Original Image Detection"
                  badge="detected on original render"
                  badgeColor="#2563eb"
                  thumb={pg.originalThumb}
                  sourceW={pg.sourceW}
                  sourceH={pg.sourceH}
                  regions={pg.original.regionsData}
                  metrics={pg.original}
                />
                <DetectionCard
                  title="Cleaned Image Detection"
                  badge="detected on OpenCV-cleaned image"
                  badgeColor="#16a34a"
                  thumb={pg.cleanedThumb}
                  sourceW={pg.sourceW}
                  sourceH={pg.sourceH}
                  regions={pg.cleaned.regionsData}
                  metrics={pg.cleaned}
                />
              </div>

              {/* Cleaned detection crop previews — cropped from the ORIGINAL render */}
              <div className="px-3 pb-3">
                <div className="text-[11px] font-semibold text-slate-600 mb-1">
                  Cleaned-detection final crops (from original high-res render) — {pg.cleaned.regions} region(s)
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-96 overflow-y-auto">
                  {pg.cleaned.crops.length === 0 && (
                    <p className="text-xs text-slate-400 col-span-full">No regions.</p>
                  )}
                  {pg.cleaned.crops.map((c, i) => {
                    const ocr = pg.cleaned.ocrResults[i];
                    return (
                      <div key={i} className="rounded border border-slate-200 overflow-hidden bg-white">
                        <img src={c} alt={`region ${i + 1}`} className="w-full max-h-24 object-contain" />
                        <div className="px-1.5 py-1 text-[10px] text-slate-500 font-mono">
                          <div>#{i + 1}</div>
                          {ocr && ocr.text ? (
                            <div className="text-slate-700 break-words">{ocr.text.trim().slice(0, 28)}</div>
                          ) : (
                            <div className="text-slate-300">—</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}

          {!loading && !error && pages.length === 0 && (
            <p className="text-sm text-slate-500">No pages processed.</p>
          )}
        </div>
      )}
    </div>
  );
}

function DetectionCard({ title, badge, badgeColor, thumb, sourceW, sourceH, regions, metrics }) {
  const stroke = Math.max(1.5, sourceW / 600);
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">{title}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full text-white" style={{ background: badgeColor }}>{badge}</span>
      </div>
      <div className="p-3 space-y-2">
        <div className="relative w-full">
          {thumb ? (
            <img src={thumb} alt={title} className="w-full rounded border border-slate-200" />
          ) : (
            <div className="w-full h-40 bg-slate-100 rounded" />
          )}
          <svg viewBox={`0 0 ${sourceW} ${sourceH}`} className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid meet">
            <g>
              {regions.map((r, i) => (
                <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h}
                  fill="rgba(37,99,235,0.06)" stroke={badgeColor} strokeWidth={stroke} />
              ))}
            </g>
          </svg>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-slate-100 rounded border border-slate-200 text-center">
          <Stat label="Char candidates" value={metrics.components} />
          <Stat label="Probable lines" value={metrics.lines} />
          <Stat label="Final regions" value={metrics.regions} />
          <Stat label="OCR-readable" value={`${metrics.readable}/${metrics.ocrChecked}`} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-800">{value}</div>
    </div>
  );
}

function thumb(canvas) {
  const ds = Math.min(1, PREVIEW_W / canvas.width);
  const t = document.createElement('canvas');
  t.width = Math.max(1, Math.round(canvas.width * ds));
  t.height = Math.max(1, Math.round(canvas.height * ds));
  t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
  return t.toDataURL();
}

async function countReadable(crops, pageNum, onStatus) {
  const list = crops.slice(0, OCR_CAP);
  const results = [];
  let readable = 0;
  for (let i = 0; i < list.length; i++) {
    onStatus?.(`OCR ${i + 1}/${list.length}`);
    try {
      const { text, confidence } = await ocrCanvas(list[i].canvas, pageNum, { scale: 1 });
      const t = (text || '').trim();
      const ok = t.length >= 2 && (confidence == null || confidence >= 40);
      if (ok) readable++;
      results.push({ text: t, confidence });
    } catch {
      results.push({ text: '', confidence: 0 });
    }
  }
  return { readable, checked: list.length, results };
}