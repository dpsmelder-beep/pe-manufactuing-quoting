import React, { useEffect, useState } from 'react';
import { Loader2, ChevronDown, ChevronRight, ScanText } from 'lucide-react';
import { loadPdf, renderPageToCanvas, HIGH_OCR_SCALE } from '@/lib/pdfOcrService';
import { detectTextRegions, expandRegion, expandRegionDirectional, cropBox, EXPANSION_LEVELS } from '@/lib/textRegionDetection';
import { ocrCanvasOnce } from '@/lib/regionOcrService';

const MAX_CANVAS_DIM = 4000;

/**
 * Expansion OCR test: run Tesseract independently on each expansion version
 * (original, +15%, +30%, +50%) for every detected text region. Captures text,
 * confidence, character count, and word count for each version and displays
 * them side-by-side per region. No version is auto-selected — the goal is to
 * see whether crop size is limiting OCR accuracy.
 */
export default function ExpansionOcrTest({ url }) {
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
            const bounds = { w: canvas.width, h: canvas.height };
            const levels = [];
            for (const lvl of EXPANSION_LEVELS) {
              if (cancelled) return;
              setStatus(`OCR p${p} region ${i + 1}/${regions.length} — ${lvl.label}`);
              const box =
                lvl.factor === 0
                  ? { x: r.x, y: r.y, w: r.w, h: r.h }
                  : expandRegion(r, lvl.factor, bounds);
              const crop = cropBox(canvas, box);
              const { text, confidence, wordCount, charCount } = await ocrCanvasOnce(crop.canvas);
              levels.push({ key: lvl.key, label: lvl.label, color: lvl.color, text, confidence, wordCount, charCount });
            }
            // Directional crop: favors the text's long axis (rotated logic for vertical text).
            if (cancelled) return;
            setStatus(`OCR p${p} region ${i + 1}/${regions.length} — Directional`);
            const dBox = expandRegionDirectional(r, bounds);
            const dCrop = cropBox(canvas, dBox);
            const dRes = await ocrCanvasOnce(dCrop.canvas);
            levels.push({
              key: 'directional',
              label: `Directional · ${dBox.orientation}`,
              color: '#8b5cf6',
              text: dRes.text,
              confidence: dRes.confidence,
              wordCount: dRes.wordCount,
              charCount: dRes.charCount,
            });
            entry.results.push({ index: i + 1, levels });
            setPages([...pageEntries]);
          }
        }
        setStatus('Expansion OCR complete');
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
          Expansion OCR Test
          <span className="text-xs text-slate-400 font-normal">Crop-size comparison (dev/test)</span>
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
              <p className="text-sm">Expansion OCR failed.</p>
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
                <span className="text-slate-400 font-normal">{pg.results.length}/{pg.total} regions OCR’d</span>
              </div>

              {pg.results.length === 0 ? (
                <p className="px-3 py-3 text-sm text-slate-500">No candidate regions detected on this page.</p>
              ) : (
                <div className="max-h-[32rem] overflow-y-auto divide-y divide-slate-100">
                  {pg.results.map((res) => (
                    <div key={res.index} className="p-3">
                      <div className="text-xs font-semibold text-slate-700 mb-2">
                        Region {res.index} <span className="text-slate-400 font-normal">· p{pg.pageNum}</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {res.levels.map((lv) => (
                          <div key={lv.key} className="rounded-lg border border-slate-200 overflow-hidden">
                            <div className="px-2 py-1 text-[11px] font-medium flex items-center gap-1" style={{ color: lv.color, background: lv.color + '12' }}>
                              <span className="inline-block w-2 h-2 rounded-sm border" style={{ borderColor: lv.color, background: lv.color + '22' }} />
                              {lv.label}
                            </div>
                            <div className="p-2 space-y-1">
                              <div className="text-[10px] uppercase tracking-wide text-slate-400">OCR</div>
                              <pre className="text-xs font-mono text-slate-800 whitespace-pre-wrap break-words bg-slate-50 rounded p-1.5 min-h-[2.2rem]">
                                {lv.text || '(none)'}
                              </pre>
                              <div className="grid grid-cols-3 gap-1 text-[11px] text-slate-600">
                                <Metric label="Conf" value={`${lv.confidence}%`} />
                                <Metric label="Chars" value={lv.charCount} />
                                <Metric label="Words" value={lv.wordCount} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {!loading && !error && (
            <p className="text-[11px] text-slate-400">
              Each expansion version is OCR’d independently; results are shown side-by-side to judge whether crop size limits accuracy. No version is auto-selected and no engineering interpretation is performed.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="flex flex-col">
      <span className="text-slate-400 text-[10px]">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}