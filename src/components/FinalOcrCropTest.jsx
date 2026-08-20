import React, { useEffect, useState } from 'react';
import { Loader2, ChevronDown, ChevronRight, Crop } from 'lucide-react';
import { loadPdf, renderPageToCanvas, HIGH_OCR_SCALE } from '@/lib/pdfOcrService';
import { detectTextRegions, expandRegionForOcr, cropBox } from '@/lib/textRegionDetection';

const MAX_CANVAS_DIM = 4000;
const OVERLAY_MAX_W = 800;

/**
 * Final OCR Crop Test (diagnostic): generates the final OCR crop with padding
 * based on the detected region's estimated character height (1.0× left/right,
 * 0.40× top/bottom, rotated for vertical text), clamped to the page. Shows the
 * detected text region, the expanded OCR region, and the resulting crop preview.
 */
export default function FinalOcrCropTest({ url }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [status, setStatus] = useState('');
  const [pages, setPages] = useState([]);

  useEffect(() => {
    if (!url || !open) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(false);
      setLoadError(null);
      setPages([]);
      setStatus('Loading PDF…');
      try {
        const pdf = await loadPdf(url);
        if (cancelled) return;
        const pageEntries = [];
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          if (cancelled) return;
          const baseVp = page.getViewport({ scale: 1 });
          const maxDim = Math.max(baseVp.width, baseVp.height);
          const scale = Math.min(HIGH_OCR_SCALE, MAX_CANVAS_DIM / maxDim);
          setStatus(`Rendering page ${p} at ×${scale.toFixed(2)}`);
          const { canvas } = await renderPageToCanvas(page, scale);
          if (cancelled) return;
          setStatus(`Detecting regions on page ${p}`);
          const { regions } = detectTextRegions(canvas);
          const bounds = { w: canvas.width, h: canvas.height };
          const results = regions.map((r, i) => {
            const expanded = expandRegionForOcr(r, bounds);
            const crop = cropBox(canvas, expanded);
            return {
              index: i + 1,
              detected: r,
              expanded,
              dataUrl: crop.canvas.toDataURL(),
            };
          });
          if (cancelled) return;
          const overlay = makeOverlay(canvas, results);
          pageEntries.push({ pageNum: p, overlay, results });
          setPages([...pageEntries]);
        }
        setStatus('Final OCR crop complete');
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
    return () => {
      cancelled = true;
    };
  }, [url, open]);

  return (
    <div className="border border-slate-200 rounded-lg mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 rounded-t-lg hover:bg-slate-100 transition"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Final OCR Crop Test
          <span className="text-xs text-slate-400 font-normal">Height-based padding (dev/test)</span>
        </span>
        {loading && status && (
          <span className="flex items-center gap-1 text-xs text-slate-500 max-w-[60%] truncate">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> <span className="truncate">{status}</span>
          </span>
        )}
      </button>

      {open && (
        <div className="p-4 space-y-4">
          {loading && pages.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> {status || 'Preparing…'}
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center justify-center py-8 text-slate-500">
              <Crop className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm">Final OCR crop test failed.</p>
              <p className="text-xs text-slate-400">{loadError}</p>
            </div>
          )}

          {pages.map((pg) => (
            <div key={pg.pageNum} className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 flex items-center justify-between">
                <span>Page {pg.pageNum}</span>
                <span className="text-slate-400 font-normal">{pg.results.length} regions</span>
              </div>

              <div className="p-3 space-y-3">
                <div>
                  <div className="text-[11px] font-semibold text-slate-600 mb-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="flex items-center gap-1"><span className="inline-block w-4 h-2 border-2 border-red-500 rounded-sm" /> Detected text region</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-4 h-2 border-2 border-blue-600 rounded-sm" /> Expanded OCR region</span>
                  </div>
                  {pg.overlay ? (
                    <img src={pg.overlay} alt={`Page ${pg.pageNum} final crop`} className="w-full rounded border border-slate-200" />
                  ) : (
                    <p className="text-sm text-slate-500">Overlay unavailable.</p>
                  )}
                </div>

                <div className="max-h-[32rem] overflow-y-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {pg.results.map((res) => (
                    <div key={res.index} className="rounded-lg border border-slate-200 overflow-hidden">
                      <div className="px-2 py-1 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-700 flex items-center justify-between">
                        <span>Region {res.index}</span>
                        <span className="text-slate-400 font-normal">{res.expanded.orientation} · charH {res.expanded.charH}px</span>
                      </div>
                      <div className="p-2 space-y-1.5">
                        {res.dataUrl ? (
                          <img src={res.dataUrl} alt={`Crop ${res.index}`} className="w-full max-h-32 object-contain rounded border border-slate-200 bg-white" />
                        ) : (
                          <div className="w-full h-20 bg-slate-100 rounded" />
                        )}
                        <div className="text-[11px] text-slate-500 font-mono">
                          pad L/R {Math.round(res.expanded.padding.left)} · T/B {Math.round(res.expanded.padding.top)}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          detected {Math.round(res.detected.w)}×{Math.round(res.detected.h)} → crop {Math.round(res.expanded.w)}×{Math.round(res.expanded.h)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}

          {!loading && !error && pages.length === 0 && (
            <p className="text-sm text-slate-500">No pages processed.</p>
          )}

          {!loading && !error && (
            <p className="text-[11px] text-slate-400">
              Final OCR crops are padded by the region's estimated character height — 1.0× left/right and 0.40× top/bottom (rotated for vertical text) — and clamped to the page, to avoid clipping the first/last character of a dimension without collecting excessive geometry above/below.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function makeOverlay(source, results) {
  const scale = Math.min(1, OVERLAY_MAX_W / source.width);
  const dw = Math.max(1, Math.round(source.width * scale));
  const dh = Math.max(1, Math.round(source.height * scale));
  const out = document.createElement('canvas');
  out.width = dw;
  out.height = dh;
  const ctx = out.getContext('2d');
  ctx.drawImage(source, 0, 0, dw, dh);
  // Expanded OCR regions (blue) first, then detected (red) on top.
  ctx.strokeStyle = 'rgba(37,99,235,0.9)';
  ctx.lineWidth = 2;
  for (const r of results) {
    ctx.strokeRect(r.expanded.x * scale, r.expanded.y * scale, r.expanded.w * scale, r.expanded.h * scale);
  }
  ctx.strokeStyle = 'rgba(239,68,68,0.95)';
  ctx.lineWidth = 1.5;
  for (const r of results) {
    ctx.strokeRect(r.detected.x * scale, r.detected.y * scale, r.detected.w * scale, r.detected.h * scale);
  }
  return out.toDataURL();
}