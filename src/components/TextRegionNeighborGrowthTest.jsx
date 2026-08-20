import React, { useEffect, useRef, useState } from 'react';
import { Loader2, ChevronDown, ChevronRight, Maximize2 } from 'lucide-react';
import { loadPdf, renderPageToCanvas, HIGH_OCR_SCALE } from '@/lib/pdfOcrService';
import { detectCharacterTextRegions, cropRegionFromSource } from '@/lib/characterTextDetector';
import { growRegion, padRegionBbox } from '@/lib/textRegionNeighborGrowth';

const MAX_CANVAS_DIM = 3000;
const PREVIEW_W = 760;
const CARD_CAP = 30;

/**
 * Text Region Neighbor Growth Test (experimental diagnostic).
 *
 * Starts from probable text regions detected on the ORIGINAL high-resolution
 * drawing and extends each region by absorbing compatible neighbor components
 * left/right (horizontal) or up/down (vertical). Final crops are always taken
 * from the original render. No OCR, no merge changes, no OpenCV, no
 * engineering interpretation.
 */
export default function TextRegionNeighborGrowthTest({ url }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [status, setStatus] = useState('');
  const [searchFactor, setSearchFactor] = useState(3);
  const [onlyGrown, setOnlyGrown] = useState(true);
  const [pages, setPages] = useState([]); // { pageNum, thumb, sourceW, sourceH, total }
  const [results, setResults] = useState([]); // per page { grownAll, cards, grownCount }
  const baseRef = useRef([]); // { originalCanvas, detect, pool }

  // Step 1: render + detect on the ORIGINAL render (cached, independent of slider).
  useEffect(() => {
    if (!url || !open) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(false);
      setLoadError(null);
      setPages([]);
      setResults([]);
      baseRef.current = [];
      setStatus('Loading PDF…');
      try {
        const pdf = await loadPdf(url);
        if (cancelled) return;
        const base = [];
        const meta = [];
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          if (cancelled) return;
          const baseVp = page.getViewport({ scale: 1 });
          const maxDim = Math.max(baseVp.width, baseVp.height);
          const scale = Math.min(HIGH_OCR_SCALE, MAX_CANVAS_DIM / maxDim);
          setStatus(`Page ${p}: rendering + character detection`);
          const { canvas } = await renderPageToCanvas(page, scale);
          if (cancelled) return;
          const detect = detectCharacterTextRegions(canvas);
          // Pool = candidates not already assigned to ANY group.
          const usedByAny = new Set();
          detect.groups.forEach((g) => g.indices.forEach((i) => usedByAny.add(i)));
          const pool = detect.components.map((c, i) => ({ c, i })).filter(({ i }) => !usedByAny.has(i));
          base.push({ originalCanvas: canvas, detect, pool });
          meta.push({
            pageNum: p,
            thumb: thumb(canvas),
            sourceW: canvas.width,
            sourceH: canvas.height,
            total: detect.groups.length,
          });
        }
        if (cancelled) return;
        baseRef.current = base;
        setPages(meta);
        setStatus('Growth complete');
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

  // Step 2: recompute growth (cheap) whenever the slider / filter changes.
  useEffect(() => {
    if (!baseRef.current.length) return;
    const out = baseRef.current.map((b) => {
      const bounds = { w: b.originalCanvas.width, h: b.originalCanvas.height };
      const grownAll = b.detect.groups.map((g) => {
        const grow = growRegion(g, b.pool, { searchFactor });
        const beforeRegion = b.detect.regions.find((r) => r.groupBbox === g.bbox) ||
          padRegionBbox(g.bbox, g.orientation, grow.charH, bounds);
        const afterRegion = padRegionBbox(grow.afterBbox, g.orientation, grow.charH, bounds);
        return { ...grow, beforeRegion, afterRegion };
      });
      const grownCount = grownAll.filter((r) => r.addedCount > 0).length;
      const filtered = onlyGrown ? grownAll.filter((r) => r.addedCount > 0) : grownAll;
      const cards = filtered.slice(0, CARD_CAP).map((r) => ({
        before: cropRegionFromSource(b.originalCanvas, r.beforeRegion).canvas.toDataURL(),
        after: cropRegionFromSource(b.originalCanvas, r.afterRegion).canvas.toDataURL(),
        orientation: r.orientation,
        beforeCount: r.beforeCount,
        addedCount: r.addedCount,
        afterCount: r.afterCount,
        startGrowth: r.startGrowth,
        endGrowth: r.endGrowth,
        beforeW: Math.round(r.beforeRegion.w),
        beforeH: Math.round(r.beforeRegion.h),
        afterW: Math.round(r.afterRegion.w),
        afterH: Math.round(r.afterRegion.h),
      }));
      return { grownAll, cards, grownCount };
    });
    setResults(out);
  }, [searchFactor, onlyGrown, pages]);

  return (
    <div className="border border-slate-200 rounded-lg mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 rounded-t-lg hover:bg-slate-100 transition"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Text Region Neighbor Growth Test
          <span className="text-xs text-slate-400 font-normal">Original render · experimental (dev/test)</span>
        </span>
        {loading && status && (
          <span className="flex items-center gap-1 text-xs text-slate-500 max-w-[60%] truncate">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> <span className="truncate">{status}</span>
          </span>
        )}
      </button>

      {open && (
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
            <label className="flex items-center gap-2">
              <span className="text-slate-500">Search distance = charH ×</span>
              <input
                type="range" min={1} max={8} step={0.5} value={searchFactor}
                onChange={(e) => setSearchFactor(parseFloat(e.target.value))}
                className="accent-primary"
              />
              <span className="font-mono font-semibold text-slate-800 w-8">{searchFactor}</span>
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={onlyGrown} onChange={(e) => setOnlyGrown(e.target.checked)} className="accent-primary" />
              Only show regions that grew
            </label>
          </div>

          {loading && pages.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> {status || 'Preparing…'}
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center justify-center py-8 text-slate-500">
              <Maximize2 className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm">Neighbor growth failed.</p>
              <p className="text-xs text-slate-400">{loadError}</p>
            </div>
          )}

          {pages.map((pg, pi) => {
            const res = results[pi];
            if (!res) return null;
            return (
              <div key={pg.pageNum} className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 flex items-center justify-between">
                  <span>Page {pg.pageNum}</span>
                  <span className="text-slate-400 font-normal">
                    {res.grownCount} / {pg.total} regions grew
                  </span>
                </div>

                {/* Full-page overlay: BEFORE (blue) vs AFTER (green) */}
                <div className="p-3">
                  <div className="text-[11px] text-slate-500 mb-1">
                    Region overlay — <span className="text-blue-600 font-medium">before</span> vs <span className="text-green-600 font-medium">after growth</span>
                  </div>
                  <div className="relative w-full">
                    {pg.thumb && <img src={pg.thumb} alt={`page ${pg.pageNum}`} className="w-full rounded border border-slate-200" />}
                    <svg viewBox={`0 0 ${pg.sourceW} ${pg.sourceH}`} className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid meet">
                      {res.grownAll.map((r, i) => (
                        <rect key={`b${i}`} x={r.beforeRegion.x} y={r.beforeRegion.y} width={r.beforeRegion.w} height={r.beforeRegion.h}
                          fill="rgba(37,99,235,0.04)" stroke="#2563eb" strokeWidth={Math.max(1, pg.sourceW / 700)} />
                      ))}
                      {res.grownAll.map((r, i) => (
                        <rect key={`a${i}`} x={r.afterRegion.x} y={r.afterRegion.y} width={r.afterRegion.w} height={r.afterRegion.h}
                          fill="rgba(22,163,74,0.05)" stroke="#16a34a" strokeWidth={Math.max(1, pg.sourceW / 700)} />
                      ))}
                    </svg>
                  </div>
                </div>

                {/* Per-region comparison cards */}
                <div className="px-3 pb-3">
                  <div className="text-[11px] font-semibold text-slate-600 mb-1">
                    Region comparisons {onlyGrown ? '(grown only)' : ''} — first {res.cards.length}
                  </div>
                  {res.cards.length === 0 && <p className="text-xs text-slate-400">No regions to display.</p>}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {res.cards.map((c, i) => (
                      <div key={i} className="rounded-lg border border-slate-200 overflow-hidden">
                        <div className="grid grid-cols-2 gap-px bg-slate-200">
                          <CropCell label="Before" src={c.before} />
                          <CropCell label="After (final)" src={c.after} accent="green" />
                        </div>
                        <div className="p-2 text-[10px] text-slate-600 grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono">
                          <span>components: <b className="text-slate-800">{c.beforeCount}</b> → <b className="text-slate-800">{c.afterCount}</b> (+{c.addedCount})</span>
                          <span>{c.orientation}</span>
                          <span>{c.orientation === 'horizontal' ? 'left' : 'top'} growth: {c.startGrowth}px</span>
                          <span>{c.orientation === 'horizontal' ? 'right' : 'bottom'} growth: {c.endGrowth}px</span>
                          <span>before: {c.beforeW}×{c.beforeH}px</span>
                          <span>final: {c.afterW}×{c.afterH}px</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CropCell({ label, src, accent }) {
  return (
    <div className="bg-white">
      <div className={`px-1.5 py-0.5 text-[10px] font-medium ${accent === 'green' ? 'text-green-700' : 'text-blue-700'}`}>{label}</div>
      {src ? <img src={src} alt={label} className="w-full max-h-28 object-contain bg-slate-50" /> : <div className="h-20 bg-slate-100" />}
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