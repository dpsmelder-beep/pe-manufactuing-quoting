import React, { useEffect, useState } from 'react';
import { Loader2, ChevronDown, ChevronRight, GitMerge } from 'lucide-react';
import { loadPdf, renderPageToCanvas, HIGH_OCR_SCALE } from '@/lib/pdfOcrService';
import { detectTextRegions, mergeRegions, cropBox } from '@/lib/textRegionDetection';
import { ocrCanvasOnce } from '@/lib/regionOcrService';

const MAX_CANVAS_DIM = 4000;
const OVERLAY_MAX_W = 700;

/**
 * Region Merging Test (diagnostic): proposes merges of adjacent detected
 * regions, then OCRs both the original individual regions and the merged
 * region so results can be compared. Shows the page with original (red) and
 * proposed merged (blue) boxes, plus merged-crop previews. Originals are
 * never discarded — merged groups reference their source indices.
 */
export default function RegionMergingTest({ url }) {
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
          const { regions: originals } = detectTextRegions(canvas);
          const { merged, groups } = mergeRegions(originals);
          if (cancelled) return;

          const overlay = makeOverlay(canvas, originals, merged);
          if (cancelled) return;

          // OCR the original regions first (constituents), then the merged ones.
          const origResults = [];
          for (let i = 0; i < originals.length; i++) {
            if (cancelled) return;
            setStatus(`OCR p${p} original ${i + 1}/${originals.length}`);
            const crop = cropBox(canvas, originals[i]);
            const ocr = await ocrCanvasOnce(crop.canvas);
            origResults.push({
              index: i + 1,
              box: originals[i],
              dataUrl: crop.canvas.toDataURL(),
              ocr,
            });
          }

          const mergedResults = [];
          for (let gi = 0; gi < groups.length; gi++) {
            if (cancelled) return;
            const m = merged[gi];
            setStatus(`OCR p${p} merged ${gi + 1}/${groups.length}`);
            const crop = cropBox(canvas, m);
            const ocr = await ocrCanvasOnce(crop.canvas);
            mergedResults.push({
              index: gi + 1,
              box: m,
              dataUrl: crop.canvas.toDataURL(),
              ocr,
              isMerge: groups[gi].length > 1,
              constituents: groups[gi].map((idx) => origResults[idx]),
            });
          }

          pageEntries.push({
            pageNum: p,
            overlay,
            originalCount: originals.length,
            mergedCount: merged.length,
            mergedResults,
          });
          setPages([...pageEntries]);
        }
        setStatus('Region merging complete');
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

  const totalOriginal = pages.reduce((s, p) => s + p.originalCount, 0);
  const totalMerged = pages.reduce((s, p) => s + p.mergedCount, 0);

  return (
    <div className="border border-slate-200 rounded-lg mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 rounded-t-lg hover:bg-slate-100 transition"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Region Merging Test
          <span className="text-xs text-slate-400 font-normal">Merge + OCR comparison (dev/test)</span>
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
              <GitMerge className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm">Region merging test failed.</p>
              <p className="text-xs text-slate-400">{loadError}</p>
            </div>
          )}

          {pages.length > 0 && (
            <div className="grid grid-cols-3 divide-x divide-slate-100 rounded-lg border border-slate-200">
              <Stat label="Pages" value={pages.length} />
              <Stat label="Original Regions" value={totalOriginal} />
              <Stat label="Merged Regions" value={totalMerged} />
            </div>
          )}

          {pages.map((pg) => (
            <div key={pg.pageNum} className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 flex items-center justify-between">
                <span>Page {pg.pageNum}</span>
                <span className="text-slate-400 font-normal">{pg.originalCount} original → {pg.mergedCount} merged</span>
              </div>

              <div className="p-3 space-y-3">
                <div>
                  <div className="text-[11px] font-semibold text-slate-600 mb-1 flex items-center gap-3">
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 border-2 border-red-500 rounded-sm" /> Original regions</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 border-2 border-blue-600 rounded-sm" /> Proposed merged regions</span>
                  </div>
                  {pg.overlay ? (
                    <img src={pg.overlay} alt={`Page ${pg.pageNum} overlay`} className="w-full rounded border border-slate-200" />
                  ) : (
                    <p className="text-sm text-slate-500">Overlay unavailable.</p>
                  )}
                </div>

                <div className="max-h-[32rem] overflow-y-auto space-y-2">
                  {pg.mergedResults.map((m) => (
                    <div key={m.index} className="rounded-lg border border-slate-200">
                      <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 flex items-center gap-2">
                        Merged Region {m.index}
                        {m.isMerge && (
                          <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-medium">
                            merged from {m.constituents.length}
                          </span>
                        )}
                      </div>
                      <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                        <CropResult title="Merged Crop" cropDataUrl={m.dataUrl} ocr={m.ocr} accent="blue" />
                        {m.constituents.length > 1 && (
                          <div className="space-y-2">
                            {m.constituents.map((c) => (
                              <CropResult
                                key={c.index}
                                title={`Original #${c.index}`}
                                cropDataUrl={c.dataUrl}
                                ocr={c.ocr}
                                accent="red"
                                compact
                              />
                            ))}
                          </div>
                        )}
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
              Merges are proposed when neighbors share a baseline (or column for vertical text), overlap substantially, have similar sizes, and their gap is &lt; ~1.5× the average text height/width. Original regions are retained and OCR’d individually for comparison.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function makeOverlay(sourceCanvas, originals, merged) {
  const scale = Math.min(1, OVERLAY_MAX_W / sourceCanvas.width);
  const dw = Math.max(1, Math.round(sourceCanvas.width * scale));
  const dh = Math.max(1, Math.round(sourceCanvas.height * scale));
  const out = document.createElement('canvas');
  out.width = dw;
  out.height = dh;
  const ctx = out.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0, dw, dh);
  // Original regions: thin red.
  ctx.strokeStyle = 'rgba(239,68,68,0.75)';
  ctx.lineWidth = 1;
  for (const r of originals) {
    ctx.strokeRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
  }
  // Proposed merged regions: thicker blue + number.
  ctx.strokeStyle = 'rgba(37,99,235,0.95)';
  ctx.lineWidth = 2.5;
  ctx.fillStyle = 'rgba(37,99,235,1)';
  ctx.font = 'bold 12px sans-serif';
  ctx.textBaseline = 'bottom';
  for (let i = 0; i < merged.length; i++) {
    const m = merged[i];
    ctx.strokeRect(m.x * scale, m.y * scale, m.w * scale, m.h * scale);
    ctx.fillText(`${i + 1}`, m.x * scale + 3, Math.max(12, m.y * scale - 2));
  }
  return out.toDataURL();
}

function Stat({ label, value }) {
  return (
    <div className="px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-lg font-semibold text-slate-800">{value}</div>
    </div>
  );
}

function CropResult({ title, cropDataUrl, ocr, accent = 'blue', compact = false }) {
  const accentClass = accent === 'blue' ? 'text-blue-700' : 'text-red-600';
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-2 py-1 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-700 flex items-center justify-between">
        <span className={accentClass}>{title}</span>
      </div>
      <div className="p-2 flex gap-2">
        {cropDataUrl ? (
          <img src={cropDataUrl} alt={title} className={compact ? 'max-h-14 rounded border border-slate-200' : 'max-h-24 rounded border border-slate-200'} />
        ) : (
          <div className="w-20 h-14 bg-slate-100 rounded" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">OCR</div>
          <pre className="text-xs font-mono text-slate-800 whitespace-pre-wrap break-words bg-slate-50 rounded p-1.5 min-h-[1.6rem]">
            {ocr?.text || '(none)'}
          </pre>
          <div className="flex gap-3 mt-1 text-[11px] text-slate-600">
            <span><span className="text-slate-400">Conf </span>{ocr?.confidence ?? 0}%</span>
            <span><span className="text-slate-400">Chars </span>{ocr?.charCount ?? 0}</span>
            <span><span className="text-slate-400">Words </span>{ocr?.wordCount ?? 0}</span>
          </div>
        </div>
      </div>
    </div>
  );
}