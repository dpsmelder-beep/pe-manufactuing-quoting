import React, { useEffect, useState } from 'react';
import { Loader2, ChevronDown, ChevronRight, ScanText } from 'lucide-react';
import { loadPdf, renderPageToCanvas, HIGH_OCR_SCALE } from '@/lib/pdfOcrService';
import { detectTextRegions, cropRegion } from '@/lib/textRegionDetection';
import { ocrRegionOrientations } from '@/lib/regionOcrService';

const MAX_CANVAS_DIM = 4000;
const REGION_PADDING = 15;

/**
 * Region OCR test with orientation handling. For every detected candidate
 * text crop it OCRs the original, 90° CW, and 90° CCW orientations, compares
 * confidence and recognized-text amount, and keeps the strongest. No
 * engineering interpretation is performed.
 */
export default function RegionOcrTest({ url }) {
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
          setStatus(`Detecting text regions on page ${p}`);
          const { regions } = detectTextRegions(canvas);
          if (cancelled) return;
          const entry = { pageNum: p, total: regions.length, results: [] };
          pageEntries.push(entry);
          setPages([...pageEntries]);

          for (let i = 0; i < regions.length; i++) {
            if (cancelled) return;
            const r = regions[i];
            const crop = cropRegion(canvas, r, REGION_PADDING);
            const previewUrl = crop.canvas.toDataURL('image/png');
            setStatus(`OCR p${p} region ${i + 1}/${regions.length} — comparing orientations`);
            const { selected, variants } = await ocrRegionOrientations(crop.canvas, (o) =>
              setStatus(`OCR p${p} region ${i + 1}/${regions.length} — ${o}`)
            );
            if (cancelled) return;
            entry.results.push({
              index: i + 1,
              x: crop.x,
              y: crop.y,
              width: crop.width,
              height: crop.height,
              previewUrl,
              selected: {
                orientation: selected.orientation,
                text: selected.text,
                confidence: selected.confidence,
                wordCount: selected.wordCount,
              },
              variants,
            });
            setPages([...pageEntries]);
          }
        }
        setStatus('Region OCR complete');
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
          Region OCR Test
          <span className="text-xs text-slate-400 font-normal">Orientation comparison (dev/test)</span>
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
              <ScanText className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm">Region OCR failed.</p>
              <p className="text-xs text-slate-400">{loadError}</p>
            </div>
          )}

          {!loading && !error && pages.length === 0 && (
            <p className="text-sm text-slate-500">No pages processed.</p>
          )}

          {pages.map((pg) => (
            <div key={pg.pageNum} className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 flex items-center justify-between">
                <span>Page {pg.pageNum}</span>
                <span className="text-slate-400 font-normal">
                  {pg.results.length}/{pg.total} regions OCR’d
                </span>
              </div>

              {pg.results.length === 0 ? (
                <p className="px-3 py-3 text-sm text-slate-500">No candidate regions detected on this page.</p>
              ) : (
                <div className="max-h-[28rem] overflow-y-auto divide-y divide-slate-100">
                  {pg.results.map((res) => (
                    <div key={res.index} className="p-3 flex gap-3">
                      <img
                        src={res.previewUrl}
                        alt={`Crop ${res.index} page ${pg.pageNum}`}
                        className="w-20 h-20 object-contain bg-slate-100 rounded border border-slate-200 shrink-0"
                      />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-slate-700">#{res.index} · p{pg.pageNum}</span>
                          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-cyan-100 text-cyan-700 font-medium">
                            {res.selected.orientation}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            conf {res.selected.confidence}% · {res.selected.wordCount} words
                          </span>
                        </div>
                        <div className="grid grid-cols-4 gap-1 text-[11px] text-slate-500">
                          <Meta label="X" value={`${res.x}px`} />
                          <Meta label="Y" value={`${res.y}px`} />
                          <Meta label="W" value={`${res.width}px`} />
                          <Meta label="H" value={`${res.height}px`} />
                        </div>
                        <div className="text-[10px] text-slate-400 flex flex-wrap gap-x-3">
                          {res.variants.map((v) => (
                            <span key={v.orientation}>
                              {v.orientation}: {v.confidence}% · {v.wordCount}w
                            </span>
                          ))}
                        </div>
                        <pre className="max-h-20 overflow-auto bg-slate-50 border border-slate-200 rounded p-1.5 text-xs font-mono text-slate-700 whitespace-pre-wrap break-words">
                          {res.selected.text || '(no text recognized)'}
                        </pre>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {!loading && !error && (
            <p className="text-[11px] text-slate-400">
              Each detected crop is OCR’d in three orientations; the orientation with the most recognized text (tie-broken by confidence) is kept. No engineering interpretation is performed.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Meta({ label, value }) {
  return (
    <div className="flex justify-between bg-slate-50 rounded px-1.5 py-0.5">
      <span className="text-slate-400">{label}</span>
      <span className="font-mono text-slate-600">{value}</span>
    </div>
  );
}