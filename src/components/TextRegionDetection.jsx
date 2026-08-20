import React, { useEffect, useState } from 'react';
import { Loader2, ChevronDown, ChevronRight, ScanSearch } from 'lucide-react';
import { loadPdf, renderPageToCanvas, HIGH_OCR_SCALE } from '@/lib/pdfOcrService';
import { scaleCanvas } from '@/lib/imagePreprocessing';
import { detectTextRegions, drawExpansionOverlay, expandRegion, cropBox, EXPANSION_LEVELS } from '@/lib/textRegionDetection';

const DISPLAY_W = 1000;
const MAX_CANVAS_DIM = 4000; // avoid mobile canvas-size limits on large drawings

/**
 * Experimental diagnostic: "Text Region Detection". For each page, render at
 * high resolution, run browser-side connected-component + grouping analysis,
 * and overlay the candidate text regions (cyan rectangles) on a downscaled
 * copy of the drawing for visual inspection. No OCR or interpretation runs.
 */
export default function TextRegionDetection({ url }) {
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
        const entries = [];
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          if (cancelled) return;
          // Cap scale so the rendered canvas stays within mobile limits.
          const baseVp = page.getViewport({ scale: 1 });
          const maxDim = Math.max(baseVp.width, baseVp.height);
          const scale = Math.min(HIGH_OCR_SCALE, MAX_CANVAS_DIM / maxDim);
          setStatus(`Rendering page ${p} at ×${scale.toFixed(2)}`);
          const { canvas } = await renderPageToCanvas(page, scale);
          if (cancelled) return;
          setStatus(`Detecting text regions on page ${p}`);
          const { regions, stats } = detectTextRegions(canvas);
          if (cancelled) return;
          const dispScale = Math.min(1, DISPLAY_W / canvas.width);
          const displayBase = scaleCanvas(canvas, dispScale);
          const overlay = drawExpansionOverlay(displayBase, regions, dispScale, canvas.width, canvas.height);
          const crops = regions.map((r, i) => {
            const levels = EXPANSION_LEVELS.map((lvl) => {
              const box =
                lvl.factor === 0
                  ? { x: r.x, y: r.y, w: r.w, h: r.h }
                  : expandRegion(r, lvl.factor, { w: canvas.width, h: canvas.height });
              const crop = cropBox(canvas, box);
              return {
                key: lvl.key,
                label: lvl.label,
                color: lvl.color,
                x: crop.x,
                y: crop.y,
                width: crop.width,
                height: crop.height,
                url: crop.canvas.toDataURL('image/png'),
              };
            });
            return { index: i + 1, levels };
          });
          entries.push({ pageNum: p, overlayUrl: overlay.toDataURL('image/png'), regionCount: regions.length, stats, crops });
          setPages([...entries]);
        }
        setStatus('Text region detection complete');
      } catch (err) {
        if (!cancelled) { setError(true); setLoadError(err?.message || String(err)); }
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
          Text Region Detection
          <span className="text-xs text-slate-400 font-normal">Experimental (dev/test)</span>
        </span>
        {loading && status && (
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> {status}
          </span>
        )}
      </button>

      {open && (
        <div className="p-4 space-y-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> {status || 'Preparing…'}
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center justify-center py-8 text-slate-500">
              <ScanSearch className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm">Could not detect text regions.</p>
              <p className="text-xs text-slate-400">{loadError}</p>
            </div>
          )}

          {!loading && !error && pages.length === 0 && (
            <p className="text-sm text-slate-500">No pages processed.</p>
          )}

          {!loading && !error && pages.map((pg) => (
            <div key={pg.pageNum} className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 flex items-center justify-between">
                <span>Page {pg.pageNum}</span>
                <span className="text-slate-400 font-normal">
                  {pg.regionCount} candidate regions · {pg.stats.charComponents} char components
                </span>
              </div>
              <div className="p-2 bg-slate-100 overflow-x-auto">
                <img src={pg.overlayUrl} alt={`Text regions page ${pg.pageNum}`} className="w-full h-auto rounded" />
              </div>
              <div className="px-3 py-1.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                {EXPANSION_LEVELS.map((l) => (
                  <span key={l.key} className="flex items-center gap-1 text-slate-600">
                    <span className="inline-block w-3 h-3 rounded-sm border" style={{ borderColor: l.color, background: l.color + '22' }} />
                    {l.label}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-slate-100 text-center">
                <Mini label="Total Components" value={pg.stats.totalComponents} />
                <Mini label="Char Components" value={pg.stats.charComponents} />
                <Mini label="Regions" value={pg.stats.regions} />
                <Mini label="Median Char" value={`${pg.stats.medianCharW}×${pg.stats.medianCharH}px`} />
              </div>

              {pg.crops.length > 0 && (
                <div>
                  <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 text-xs font-semibold text-slate-700">
                    Expansion Crop Previews ({pg.crops.length})
                  </div>
                  <div className="max-h-96 overflow-y-auto p-2 space-y-2 bg-white">
                    {pg.crops.map((crop) => (
                      <div key={crop.index} className="border border-slate-200 rounded-lg p-2">
                        <div className="text-[11px] font-semibold text-slate-700 mb-1.5">Region #{crop.index} · p{pg.pageNum}</div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {crop.levels.map((lv) => (
                            <div key={lv.key} className="rounded border border-slate-200 overflow-hidden">
                              <div className="px-1.5 py-0.5 text-[10px] font-medium flex items-center gap-1" style={{ color: lv.color }}>
                                <span className="inline-block w-2 h-2 rounded-sm border" style={{ borderColor: lv.color, background: lv.color + '22' }} />
                                {lv.label}
                              </div>
                              <div className="bg-slate-100 p-1 flex items-center justify-center">
                                <img src={lv.url} alt={`${lv.label} region ${crop.index}`} className="max-h-24 w-auto object-contain" />
                              </div>
                              <div className="px-1.5 py-1 text-[10px] text-slate-500 grid grid-cols-2 gap-x-1">
                                <span>XY</span>
                                <span className="font-mono text-right">{lv.x},{lv.y}</span>
                                <span>Size</span>
                                <span className="font-mono text-right">{lv.width}×{lv.height}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          {!loading && !error && (
            <p className="text-[11px] text-slate-400">
              Cyan rectangles are candidate text regions (grouped character components). Inspect whether dimensions and notes are enclosed; large geometry should be excluded. No OCR or engineering interpretation is performed at this stage.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Mini({ label, value }) {
  return (
    <div className="px-2 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-800">{value}</div>
    </div>
  );
}