import React, { useEffect, useState } from 'react';
import { Loader2, ChevronDown, ChevronRight, GitMerge } from 'lucide-react';
import { loadPdf, renderPageToCanvas, HIGH_OCR_SCALE } from '@/lib/pdfOcrService';
import {
  detectTextRegions,
  expandRegionForOcr,
  mergeExpandedRegions,
  cropBox,
} from '@/lib/textRegionDetection';
import { ocrCanvasOnce } from '@/lib/regionOcrService';

const MAX_CANVAS_DIM = 4000;
const OVERLAY_MAX_W = 700;

/**
 * Region Merging Test (diagnostic): merges operate on the grouped + expanded
 * text regions. For each merge group the final box is the union of BOTH complete
 * expanded regions plus additional character-height padding, then a NEW crop is
 * taken from the original high-resolution PDF render (never by stitching prior
 * crops). OCR runs against that merged crop. Constituent expanded regions are
 * OCR'd individually for comparison.
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
          const { regions: lines } = detectTextRegions(canvas);
          const bounds = { w: canvas.width, h: canvas.height };
          const expanded = lines.map((r) => expandRegionForOcr(r, bounds));
          const { merged, groups } = mergeExpandedRegions(expanded, bounds);
          if (cancelled) return;

          const overlay = makeOverlay(canvas, expanded, merged);
          if (cancelled) return;

          // OCR the constituent expanded regions first (each cropped from source).
          const constituentResults = [];
          for (let i = 0; i < expanded.length; i++) {
            if (cancelled) return;
            setStatus(`OCR p${p} expanded ${i + 1}/${expanded.length}`);
            const crop = cropBox(canvas, expanded[i]);
            const ocr = await ocrCanvasOnce(crop.canvas);
            constituentResults.push({
              index: i + 1,
              box: expanded[i],
              dataUrl: crop.canvas.toDataURL(),
              ocr,
            });
          }

          // OCR each merged group: crop the FINAL merged box from the source render.
          const mergedResults = [];
          for (let gi = 0; gi < groups.length; gi++) {
            if (cancelled) return;
            const m = merged[gi];
            setStatus(`OCR p${p} merged ${gi + 1}/${groups.length} (from source)`);
            const crop = cropBox(canvas, m);
            const ocr = await ocrCanvasOnce(crop.canvas);
            mergedResults.push({
              index: gi + 1,
              box: m,
              dataUrl: crop.canvas.toDataURL(),
              ocr,
              isMerge: groups[gi].length > 1,
              constituents: groups[gi].map((idx) => constituentResults[idx]),
            });
          }

          pageEntries.push({
            pageNum: p,
            overlay,
            expandedCount: expanded.length,
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

  const totalExpanded = pages.reduce((s, p) => s + p.expandedCount, 0);
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
          <span className="text-xs text-slate-400 font-normal">Expanded-region merge + source crop (dev/test)</span>
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
              <Stat label="Expanded Regions" value={totalExpanded} />
              <Stat label="Merged Regions" value={totalMerged} />
            </div>
          )}

          {pages.map((pg) => (
            <div key={pg.pageNum} className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 flex items-center justify-between">
                <span>Page {pg.pageNum}</span>
                <span className="text-slate-400 font-normal">{pg.expandedCount} expanded → {pg.mergedCount} merged</span>
              </div>

              <div className="p-3 space-y-3">
                <div>
                  <div className="text-[11px] font-semibold text-slate-600 mb-1 flex items-center gap-3">
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 border-2 border-red-500 rounded-sm" /> Expanded regions</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 border-2 border-blue-600 rounded-sm" /> Merged (union + padding, cropped from source)</span>
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
                      <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 flex items-center gap-2 flex-wrap">
                        Merged Region {m.index}
                        {m.isMerge && (
                          <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-medium">
                            merged from {m.constituents.length}
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400 font-normal font-mono">
                          charH {m.box.charH}px · pad L/R {Math.round(m.box.padding.left)} T/B {Math.round(m.box.padding.top)} · {Math.round(m.box.w)}×{Math.round(m.box.h)}
                        </span>
                      </div>
                      <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                        <CropResult title="Merged Crop (from source)" cropDataUrl={m.dataUrl} ocr={m.ocr} accent="blue" />
                        {m.constituents.length > 1 && (
                          <div className="space-y-2">
                            {m.constituents.map((c) => (
                              <CropResult
                                key={c.index}
                                title={`Expanded #${c.index}`}
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
              Merges run on the expanded text regions: a merged box is the union of BOTH complete expanded regions with extra character-height padding, then cropped fresh from the original high-resolution PDF render — prior crops are never stitched together. OCR runs against that merged crop.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function makeOverlay(sourceCanvas, expanded, merged) {
  const scale = Math.min(1, OVERLAY_MAX_W / sourceCanvas.width);
  const dw = Math.max(1, Math.round(sourceCanvas.width * scale));
  const dh = Math.max(1, Math.round(sourceCanvas.height * scale));
  const out = document.createElement('canvas');
  out.width = dw;
  out.height = dh;
  const ctx = out.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0, dw, dh);
  // Expanded regions: thin red.
  ctx.strokeStyle = 'rgba(239,68,68,0.75)';
  ctx.lineWidth = 1;
  for (const r of expanded) {
    ctx.strokeRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
  }
  // Merged final boxes: thicker blue + number.
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