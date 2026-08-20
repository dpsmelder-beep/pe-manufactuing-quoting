import React, { useEffect, useRef, useState } from 'react';
import { Loader2, ChevronDown, ChevronRight, ClipboardCheck } from 'lucide-react';
import { loadPdf, renderPageToCanvas, HIGH_OCR_SCALE } from '@/lib/pdfOcrService';
import { detectCharacterTextRegions, cropRegionFromSource } from '@/lib/characterTextDetector';
import { growRegion, padRegionBbox } from '@/lib/textRegionNeighborGrowth';
import { ocrRegionOrientations } from '@/lib/regionOcrService';

const MAX_CANVAS_DIM = 3000;
const SEARCH_FACTOR = 3; // matches the Text Region Neighbor Growth Test default

/**
 * Neighbor-Grown Region OCR Test (experimental diagnostic).
 *
 * Uses ONLY the final regions produced by the Text Region Neighbor Growth Test.
 * For each final region, crops from the ORIGINAL high-res render and runs the
 * existing Tesseract.js OCR (original / 90° CW / 90° CCW, strongest kept). Each
 * crop is shown for manual Correct / Partially Correct / Incorrect review with
 * an optional Expected Text field. Manual review — not OCR confidence — is the
 * accuracy measurement. No automatic interpretation; nothing upstream is changed.
 */
export default function NeighborGrownRegionOcrTest({ url }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [error, setError] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [status, setStatus] = useState('');
  const [maxRegions, setMaxRegions] = useState(50);
  const [baseReady, setBaseReady] = useState(false);
  const [pages, setPages] = useState([]); // { pageNum }
  const [results, setResults] = useState([]); // per page { pageNum, regions: [{idx, cropDataUrl, text, confidence, orientation, variants}] }
  const [reviews, setReviews] = useState({}); // { `${pageNum}-${idx}`: { rating, expectedText } }
  const baseRef = useRef([]); // [{ pageNum, originalCanvas, regions: [afterRegion...] }]

  // Step 1: render + detect + neighbor-grow (cached, independent of maxRegions).
  useEffect(() => {
    if (!url || !open) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(false);
      setLoadError(null);
      setBaseReady(false);
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
          setStatus(`Page ${p}: rendering + neighbor growth`);
          const { canvas } = await renderPageToCanvas(page, scale);
          if (cancelled) return;
          const detect = detectCharacterTextRegions(canvas);
          const usedByAny = new Set();
          detect.groups.forEach((g) => g.indices.forEach((i) => usedByAny.add(i)));
          const pool = detect.components.map((c, i) => ({ c, i })).filter(({ i }) => !usedByAny.has(i));
          const bounds = { w: canvas.width, h: canvas.height };
          const regions = detect.groups.map((g) => {
            const grow = growRegion(g, pool, { searchFactor: SEARCH_FACTOR });
            return padRegionBbox(grow.afterBbox, g.orientation, grow.charH, bounds);
          });
          base.push({ pageNum: p, originalCanvas: canvas, regions });
          meta.push({ pageNum: p });
        }
        if (cancelled) return;
        baseRef.current = base;
        setPages(meta);
        setBaseReady(true);
        setStatus('Regions ready');
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

  // Step 2: OCR the first maxRegions final crops (from original render) sequentially.
  useEffect(() => {
    if (!baseReady) return;
    let cancelled = false;
    const run = async () => {
      setOcrRunning(true);
      setError(false);
      const flat = [];
      baseRef.current.forEach((p, pi) =>
        p.regions.forEach((r, ri) => flat.push({ pi, pageNum: p.pageNum, ri, region: r, canvas: p.originalCanvas }))
      );
      const slice = flat.slice(0, maxRegions);
      const out = baseRef.current.map((p) => ({ pageNum: p.pageNum, regions: [] }));
      setResults(out);
      setStatus(`OCR 0 / ${slice.length}`);
      for (let k = 0; k < slice.length; k++) {
        if (cancelled) return;
        const item = slice[k];
        setStatus(`OCR ${k + 1} / ${slice.length} (page ${item.pageNum}, region ${item.ri + 1})`);
        try {
          const crop = cropRegionFromSource(item.canvas, item.region);
          const { selected } = await ocrRegionOrientations(crop.canvas, (o) => !cancelled && setStatus(`OCR ${k + 1} / ${slice.length} · ${o}`));
          if (cancelled) return;
          out[item.pi].regions.push({
            idx: item.ri,
            cropDataUrl: crop.canvas.toDataURL(),
            text: selected.text,
            confidence: selected.confidence,
            orientation: selected.orientation,
          });
          setResults([...out]);
        } catch (err) {
          out[item.pi].regions.push({
            idx: item.ri,
            cropDataUrl: '',
            text: '',
            confidence: 0,
            orientation: 'Original',
            error: err?.message || String(err),
          });
          setResults([...out]);
        }
      }
      if (!cancelled) setStatus('OCR complete');
    };
    run().catch((err) => { if (!cancelled) { setError(true); setLoadError(err?.message || String(err)); } })
      .finally(() => { if (!cancelled) setOcrRunning(false); });
    return () => { cancelled = true; };
  }, [baseReady, maxRegions]);

  // Summary from manual reviews — crop classification + OCR classification (independent).
  const allEntries = results.flatMap((p) => p.regions.map((r) => ({ ...r, pageNum: p.pageNum, id: `${p.pageNum}-${r.idx}` })));
  const total = allEntries.length;

  // STEP 1 — Crop quality
  const completeCount = allEntries.filter((e) => reviews[e.id]?.cropClass === 'complete').length;
  const partialCount = allEntries.filter((e) => reviews[e.id]?.cropClass === 'partial').length;
  const nonTextCount = allEntries.filter((e) => reviews[e.id]?.cropClass === 'non-text').length;
  const multipleCount = allEntries.filter((e) => reviews[e.id]?.cropClass === 'multiple').length;
  const cropReviewed = completeCount + partialCount + nonTextCount + multipleCount;
  const validCropRate = total ? (completeCount / total) * 100 : 0;
  const textDetectionRate = total ? ((completeCount + partialCount) / total) * 100 : 0;

  // STEP 2 — OCR quality (ONLY complete-text crops)
  const completeReviewed = allEntries.filter((e) => reviews[e.id]?.cropClass === 'complete' && reviews[e.id]?.ocrClass);
  const ocrReviewed = completeReviewed.length;
  const ocrCorrect = completeReviewed.filter((e) => reviews[e.id].ocrClass === 'correct').length;
  const ocrPartial = completeReviewed.filter((e) => reviews[e.id].ocrClass === 'partial').length;
  const ocrIncorrect = completeReviewed.filter((e) => reviews[e.id].ocrClass === 'incorrect').length;
  const ocrExact = ocrReviewed ? (ocrCorrect / ocrReviewed) * 100 : 0;
  const ocrUsable = ocrReviewed ? ((ocrCorrect + ocrPartial) / ocrReviewed) * 100 : 0;

  const setCropClass = (id, cropClass) =>
    setReviews((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        cropClass: prev[id]?.cropClass === cropClass ? null : cropClass,
        // switching away from "complete" invalidates OCR classification
        ocrClass: (cropClass === 'complete') ? (prev[id]?.ocrClass || null) : null,
      },
    }));
  const setOcrClass = (id, ocrClass) =>
    setReviews((prev) => ({ ...prev, [id]: { ...prev[id], ocrClass: prev[id]?.ocrClass === ocrClass ? null : ocrClass } }));
  const setExpected = (id, expectedText) =>
    setReviews((prev) => ({ ...prev, [id]: { ...prev[id], expectedText } }));

  return (
    <div className="border border-slate-200 rounded-lg mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 rounded-t-lg hover:bg-slate-100 transition"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Neighbor-Grown Region OCR Test
          <span className="text-xs text-slate-400 font-normal">Manual accuracy review · experimental (dev/test)</span>
        </span>
        {(loading || ocrRunning) && status && (
          <span className="flex items-center gap-1 text-xs text-slate-500 max-w-[60%] truncate">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> <span className="truncate">{status}</span>
          </span>
        )}
      </button>

      {open && (
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
            <label className="flex items-center gap-2">
              <span className="text-slate-500">Regions to OCR:</span>
              <input
                type="number" min={1} max={500} value={maxRegions}
                onChange={(e) => setMaxRegions(Math.max(1, Math.min(500, parseInt(e.target.value || '0', 10))))}
                className="w-20 border border-input rounded px-2 py-1"
              />
            </label>
          </div>

          {/* Summary — Region detection / crop quality */}
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">Region Detection / Crop Quality</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 divide-x divide-slate-100">
              <Stat label="Total Regions" value={total} />
              <Stat label="Complete Text" value={completeCount} color="text-green-600" />
              <Stat label="Partial Text" value={partialCount} color="text-amber-600" />
              <Stat label="Non-Text / Geometry" value={nonTextCount} color="text-slate-500" />
              <Stat label="Multiple / Mixed" value={multipleCount} color="text-violet-600" />
              <Stat label="Valid Crop Rate" value={total ? `${validCropRate.toFixed(0)}%` : '—'} color="text-green-700" />
              <Stat label="Text Detection Rate" value={total ? `${textDetectionRate.toFixed(0)}%` : '—'} color="text-emerald-700" />
            </div>
            <div className="px-3 py-1.5 text-[10px] text-slate-400">
              Valid Crop Rate = Complete Text / Total · Text Detection Rate = (Complete + Partial) / Total
            </div>
          </div>

          {/* Summary — OCR quality (complete-text crops only) */}
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">OCR Quality (Complete Text crops only)</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-slate-100">
              <Stat label="Complete reviewed by OCR" value={ocrReviewed} />
              <Stat label="OCR Correct" value={ocrCorrect} color="text-green-600" />
              <Stat label="OCR Partial" value={ocrPartial} color="text-amber-600" />
              <Stat label="OCR Incorrect" value={ocrIncorrect} color="text-red-600" />
              <Stat label="Exact OCR Accuracy" value={ocrReviewed ? `${ocrExact.toFixed(0)}%` : '—'} color="text-green-700" />
              <Stat label="Usable OCR Accuracy" value={ocrReviewed ? `${ocrUsable.toFixed(0)}%` : '—'} color="text-emerald-700" />
            </div>
            <div className="px-3 py-1.5 text-[10px] text-slate-400">
              Exact = OCR Correct / Complete reviewed · Usable = (OCR Correct + OCR Partial) / Complete reviewed · Non-text, partial & multiple crops excluded.
            </div>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> {status || 'Preparing…'}
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center justify-center py-8 text-slate-500">
              <ClipboardCheck className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm">OCR test failed.</p>
              <p className="text-xs text-slate-400">{loadError}</p>
            </div>
          )}

          {pages.map((pg, pi) => {
            const res = results[pi];
            if (!res || res.regions.length === 0) return null;
            return (
              <div key={pg.pageNum} className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
                  Page {pg.pageNum} — {res.regions.length} region(s)
                </div>
                <div className="divide-y divide-slate-100">
                  {res.regions.map((r) => {
                    const id = `${pg.pageNum}-${r.idx}`;
                    const rv = reviews[id] || {};
                    const cropClass = rv.cropClass;
                    const ocrClass = rv.ocrClass;
                    const ocrEnabled = cropClass === 'complete';
                    return (
                      <div key={r.idx} className="p-3 grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
                        {/* STEP 1 — crop image (prominent) */}
                        <div className="lg:col-span-4">
                          <div className="text-[10px] text-slate-400 mb-1 font-semibold">CROP #{r.idx + 1}</div>
                          {r.cropDataUrl ? (
                            <img src={r.cropDataUrl} alt={`crop ${r.idx + 1}`} className="w-full max-h-32 object-contain bg-white border border-slate-300 rounded" />
                          ) : (
                            <div className="h-28 bg-slate-100 rounded border border-slate-200" />
                          )}
                        </div>

                        {/* STEP 1 — crop classification */}
                        <div className="lg:col-span-4 space-y-1.5">
                          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">Step 1 · Crop Classification</div>
                          {[
                            { k: 'complete', label: 'Complete Text', color: 'green' },
                            { k: 'partial', label: 'Partial Text', color: 'amber' },
                            { k: 'non-text', label: 'Non-Text / Geometry', color: 'slate' },
                            { k: 'multiple', label: 'Multiple / Mixed', color: 'violet' },
                          ].map((b) => (
                            <button
                              key={b.k}
                              onClick={() => setCropClass(id, b.k)}
                              className={`block w-full text-left px-2.5 py-1 rounded text-xs font-medium border transition ${
                                cropClass === b.k
                                  ? b.color === 'green' ? 'bg-green-600 text-white border-green-600'
                                    : b.color === 'amber' ? 'bg-amber-500 text-white border-amber-500'
                                      : b.color === 'violet' ? 'bg-violet-600 text-white border-violet-600'
                                        : 'bg-slate-600 text-white border-slate-600'
                                  : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              {b.label}
                            </button>
                          ))}
                        </div>

                        {/* STEP 2 — OCR classification (only when Complete Text) */}
                        <div className="lg:col-span-4 space-y-1.5">
                          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">Step 2 · OCR Classification</div>
                          {!ocrEnabled ? (
                            <p className="text-[11px] text-slate-400 italic px-1 py-2">
                              Enabled only for “Complete Text” crops.
                            </p>
                          ) : (
                            <>
                              <div className="text-[10px] text-slate-400">OCR result</div>
                              <div className="text-sm font-mono text-slate-800 break-words min-h-[2rem] bg-slate-50 rounded border border-slate-200 px-2 py-1">
                                {r.text || <span className="text-slate-300">(no text)</span>}
                              </div>
                              <div className="flex gap-3 text-[10px] text-slate-500">
                                <span>orientation: <b className="text-slate-700">{r.orientation}</b></span>
                                <span>confidence: <b className="text-slate-700">{r.confidence}</b></span>
                                {r.error && <span className="text-red-500">error: {r.error}</span>}
                              </div>
                              <div className="flex gap-1.5 flex-wrap">
                                {[
                                  { k: 'correct', label: 'OCR Correct', cls: 'bg-green-600 text-white border-green-600' },
                                  { k: 'partial', label: 'OCR Partial', cls: 'bg-amber-500 text-white border-amber-500' },
                                  { k: 'incorrect', label: 'OCR Incorrect', cls: 'bg-red-600 text-white border-red-600' },
                                ].map((b) => (
                                  <button
                                    key={b.k}
                                    onClick={() => setOcrClass(id, b.k)}
                                    className={`px-2 py-1 rounded text-xs font-medium border transition ${
                                      ocrClass === b.k ? b.cls : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                                    }`}
                                  >
                                    {b.label}
                                  </button>
                                ))}
                              </div>
                              <input
                                type="text"
                                placeholder="Expected text (optional)"
                                value={rv.expectedText || ''}
                                onChange={(e) => setExpected(id, e.target.value)}
                                className="w-full border border-input rounded px-2 py-1 text-xs"
                              />
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className="px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-lg font-semibold ${color || 'text-slate-800'}`}>{value}</div>
    </div>
  );
}