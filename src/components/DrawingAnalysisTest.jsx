import React, { useEffect, useState } from 'react';
import { Loader2, ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { loadPdf, renderPageToCanvas, HIGH_OCR_SCALE } from '@/lib/pdfOcrService';
import { detectTextRegions, detectExclusionRegions } from '@/lib/textRegionDetection';

const MAX_CANVAS_DIM = 4000;
const OVERLAY_MAX_W = 800;

/**
 * Drawing Analysis (experimental): before dimension detection, identify the
 * outer drawing border and large tabular/title-block structures and exclude
 * them from the dimension text-region detector. Shows an overlay of the
 * drawing analysis region, excluded regions, and the remaining searched area,
 * with manual enable/disable toggles to verify the detector. No engineering
 * interpretation; the PDF is never modified.
 */
export default function DrawingAnalysisTest({ url }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [status, setStatus] = useState('');
  const [pages, setPages] = useState([]); // { pageNum, source, border, tables, regions, overlay }

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
          setStatus(`Analyzing page ${p}`);
          const { border, tables } = detectExclusionRegions(canvas);
          if (cancelled) return;
          const excluded = tables.filter((t) => t.enabled);
          const { regions } = detectTextRegions(canvas, { exclude: excluded });
          if (cancelled) return;
          const overlay = makeOverlay(canvas, border, tables, excluded, regions);
          pageEntries.push({ pageNum: p, source: canvas, border, tables, regions, overlay });
          setPages([...pageEntries]);
        }
        setStatus('Drawing analysis complete');
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

  const toggleTable = (pageIdx, tableId) => {
    setPages((prev) =>
      prev.map((pg, i) => {
        if (i !== pageIdx) return pg;
        const tables = pg.tables.map((t) => (t.id === tableId ? { ...t, enabled: !t.enabled } : t));
        const excluded = tables.filter((t) => t.enabled);
        const { regions } = detectTextRegions(pg.source, { exclude: excluded });
        const overlay = makeOverlay(pg.source, pg.border, tables, excluded, regions);
        return { ...pg, tables, regions, overlay };
      })
    );
  };

  return (
    <div className="border border-slate-200 rounded-lg mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 rounded-t-lg hover:bg-slate-100 transition"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Drawing Analysis Test
          <span className="text-xs text-slate-400 font-normal">Border + table exclusion (dev/test)</span>
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
              <Layers className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm">Drawing analysis failed.</p>
              <p className="text-xs text-slate-400">{loadError}</p>
            </div>
          )}

          {pages.map((pg, pi) => (
            <div key={pg.pageNum} className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 flex items-center justify-between">
                <span>Page {pg.pageNum}</span>
                <span className="text-slate-400 font-normal">
                  {pg.tables.length} structures · {pg.tables.filter((t) => t.enabled).length} excluded · {pg.regions.length} dimension regions
                </span>
              </div>

              <div className="p-3 space-y-3">
                <div>
                  <div className="text-[11px] font-semibold text-slate-600 mb-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="flex items-center gap-1"><span className="inline-block w-4 h-2 border-2 border-green-600 rounded-sm" /> Drawing Analysis Region</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-4 h-2 bg-red-500/30 border-2 border-red-500 rounded-sm" /> Excluded (title block / table)</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-4 h-2 border-2 border-slate-400 rounded-sm border-dashed" /> Detected but disabled</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-4 h-2 border-2 border-cyan-500 rounded-sm" /> Dimension text regions</span>
                  </div>
                  {pg.overlay ? (
                    <img src={pg.overlay} alt={`Page ${pg.pageNum} analysis`} className="w-full rounded border border-slate-200" />
                  ) : (
                    <p className="text-sm text-slate-500">Overlay unavailable.</p>
                  )}
                </div>

                {pg.tables.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold text-slate-600 mb-1">Detected Structures (toggle to verify)</div>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {pg.tables.map((t) => (
                        <label
                          key={t.id}
                          className="flex items-center gap-2 px-2 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={t.enabled}
                            onChange={() => toggleTable(pi, t.id)}
                            className="h-3.5 w-3.5"
                          />
                          <span className="text-xs font-medium text-slate-700 w-28">
                            #{t.id} · {t.type === 'title_block' ? 'Title Block' : 'Table'}
                          </span>
                          <span className="text-[11px] text-slate-400 font-mono">
                            {Math.round(t.w)}×{Math.round(t.h)} @ ({Math.round(t.x)}, {Math.round(t.y)})
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {!loading && !error && pages.length === 0 && (
            <p className="text-sm text-slate-500">No pages processed.</p>
          )}

          {!loading && !error && (
            <p className="text-[11px] text-slate-400">
              The outer border and large tabular structures are detected from long horizontal/vertical lines and excluded from the dimension text-region detector. Toggle structures off to verify the detector; the PDF itself is never modified and no engineering interpretation is performed.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function makeOverlay(source, border, tables, excluded, regions) {
  const scale = Math.min(1, OVERLAY_MAX_W / source.width);
  const dw = Math.max(1, Math.round(source.width * scale));
  const dh = Math.max(1, Math.round(source.height * scale));
  const out = document.createElement('canvas');
  out.width = dw;
  out.height = dh;
  const ctx = out.getContext('2d');
  ctx.drawImage(source, 0, 0, dw, dh);

  // Drawing analysis region (outer border).
  if (border) {
    ctx.strokeStyle = 'rgba(22,163,74,0.95)';
    ctx.lineWidth = 3;
    ctx.strokeRect(border.x * scale, border.y * scale, border.w * scale, border.h * scale);
  }

  // Detected structures: excluded (red fill) vs disabled (dashed).
  tables.forEach((t, i) => {
    const x = t.x * scale;
    const y = t.y * scale;
    const w = t.w * scale;
    const h = t.h * scale;
    if (t.enabled) {
      ctx.fillStyle = 'rgba(239,68,68,0.28)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(239,68,68,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
    } else {
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = 'rgba(148,163,184,0.9)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
    ctx.fillStyle = 'rgba(15,23,42,0.85)';
    ctx.font = 'bold 11px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(`${i + 1} ${t.type === 'title_block' ? 'TB' : 'T'}`, x + 3, y + 3);
  });

  // Remaining dimension text regions found after exclusion.
  ctx.strokeStyle = 'rgba(6,182,212,0.9)';
  ctx.lineWidth = 1.5;
  regions.forEach((r) =>
    ctx.strokeRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale)
  );

  return out.toDataURL();
}