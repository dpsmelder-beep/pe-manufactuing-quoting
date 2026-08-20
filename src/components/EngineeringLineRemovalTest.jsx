import React, { useEffect, useRef, useState } from 'react';
import { Loader2, ChevronDown, ChevronRight, Eraser } from 'lucide-react';
import { loadPdf, renderPageToCanvas, HIGH_OCR_SCALE } from '@/lib/pdfOcrService';
import { detectTextRegions } from '@/lib/textRegionDetection';
import { removeEngineeringLines } from '@/lib/engineeringLineRemoval';
import { loadOpenCV } from '@/lib/opencvLoader';

const MAX_CANVAS_DIM = 3000; // kept lower than other tests — OpenCV mats are heavy

/**
 * Engineering Line Removal Test (experimental preprocessing diagnostic).
 *
 * Builds a COPY of the high-resolution B&W drawing, uses OpenCV.js morphology to
 * detect long horizontal/vertical drawing lines (length > factor × estimated
 * character height) and removes them, then displays three images for visual
 * comparison:
 *   1. Original Analysis Image (the B&W drawing)
 *   2. Detected Drawing Lines (the long line structures to remove)
 *   3. Text Analysis Image (the B&W drawing after removal)
 *
 * The threshold (factor) is configurable. No OCR is run. The original PDF / PDF
 * viewer and the production OCR workflow are never modified.
 */
export default function EngineeringLineRemovalTest({ url }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [status, setStatus] = useState('');
  const [pages, setPages] = useState([]);
  const [factor, setFactor] = useState(5);
  const bwRef = useRef(new Map());
  const charHRef = useRef(new Map());

  // Initial load: render pages, run the legacy detector for a B&W copy + charH.
  useEffect(() => {
    if (!url || !open) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(false);
      setLoadError(null);
      setPages([]);
      bwRef.current = new Map();
      charHRef.current = new Map();
      setStatus('Loading PDF…');
      try {
        const pdf = await loadPdf(url);
        if (cancelled) return;
        const entries = [];
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          if (cancelled) return;
          const baseVp = page.getViewport({ scale: 1 });
          const maxDim = Math.max(baseVp.width, baseVp.height);
          const scale = Math.min(HIGH_OCR_SCALE, MAX_CANVAS_DIM / maxDim);
          setStatus(`Rendering page ${p} at ×${scale.toFixed(2)}`);
          const { canvas } = await renderPageToCanvas(page, scale);
          if (cancelled) return;
          setStatus(`Building B&W analysis image for page ${p}`);
          const det = detectTextRegions(canvas);
          const bw = det.thresholdCanvas;
          const charH = det.stats.medianCharH || Math.round(canvas.height * 0.02);
          bwRef.current.set(p, bw);
          charHRef.current.set(p, charH);
          entries.push({
            pageNum: p,
            originalDataUrl: bw.toDataURL(),
            medianCharH: charH,
            detectedDataUrl: null,
            textDataUrl: null,
            lineLen: null,
          });
          setPages([...entries]);
        }
        setStatus('Ready');
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

  // Recompute line removal whenever the factor changes (or after pages load).
  useEffect(() => {
    if (!open || pages.length === 0) return;
    let cancelled = false;
    const recompute = async () => {
      setComputing(true);
      try {
        setStatus('Loading OpenCV.js locally…');
        try {
          await loadOpenCV();
        } catch (err) {
          setError(true);
          setLoadError(err?.message || String(err));
          return;
        }
        setStatus('OpenCV.js loaded locally');
        const pageList = pages.map((pg) => pg.pageNum);
        for (const pageNum of pageList) {
          if (cancelled) return;
          const bw = bwRef.current.get(pageNum);
          const charH = charHRef.current.get(pageNum);
          if (!bw || !charH) continue;
          setStatus(`OpenCV line removal — page ${pageNum} (charH ${charH}px, factor ${factor}×)`);
          try {
            const { detectedDataUrl, textDataUrl, lineLen } = await removeEngineeringLines(bw, charH, factor);
            if (cancelled) return;
            setPages((prev) =>
              prev.map((pg) =>
                pg.pageNum === pageNum ? { ...pg, detectedDataUrl, textDataUrl, lineLen } : pg
              )
            );
          } catch (err) {
            if (cancelled) return;
            setError(true);
            setLoadError(err?.message || String(err));
            return;
          }
        }
        setStatus('Line removal complete');
      } finally {
        if (!cancelled) setComputing(false);
      }
    };
    recompute();
    return () => { cancelled = true; };
  }, [factor, open, pages.length]);

  return (
    <div className="border border-slate-200 rounded-lg mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 rounded-t-lg hover:bg-slate-100 transition"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Engineering Line Removal Test
          <span className="text-xs text-slate-400 font-normal">OpenCV.js · experimental (dev/test)</span>
        </span>
        {(loading || computing) && status && (
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
              <Eraser className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm">Engineering line removal failed.</p>
              <p className="text-xs text-slate-400">{loadError}</p>
              <p className="text-xs text-slate-400 mt-1">OpenCV.js is loaded from a CDN at runtime; if it is blocked, this diagnostic cannot run.</p>
            </div>
          )}

          {/* Configurable threshold */}
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3 bg-slate-50">
            <label className="text-xs font-medium text-slate-600">Line-length threshold</label>
            <input
              type="range"
              min={2}
              max={10}
              step={0.5}
              value={factor}
              onChange={(e) => setFactor(parseFloat(e.target.value))}
              className="flex-1 min-w-[160px] accent-slate-800"
            />
            <span className="text-xs font-mono text-slate-700 whitespace-nowrap">
              {factor.toFixed(1)}× charH
            </span>
            {pages[0]?.medianCharH ? (
              <span className="text-[11px] text-slate-400 font-mono">
                ≈ {Math.round(pages[0].medianCharH * factor)}px removal length
              </span>
            ) : null}
            <span className="text-[11px] text-slate-400">
              Only continuous runs longer than this are removed; short character strokes are kept.
            </span>
          </div>

          {pages.map((pg) => (
            <div key={pg.pageNum} className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 flex items-center justify-between flex-wrap gap-2">
                <span>Page {pg.pageNum}</span>
                <span className="text-slate-400 font-normal font-mono">charH {pg.medianCharH}px · removing lines ≥ {pg.lineLen ?? Math.round(pg.medianCharH * factor)}px</span>
              </div>
              <div className="p-3 grid grid-cols-1 xl:grid-cols-3 gap-3">
                <ImageCard label="1 · Original Analysis Image (B&W)" dataUrl={pg.originalDataUrl} />
                <ImageCard label="2 · Detected Drawing Lines (to remove)" dataUrl={pg.detectedDataUrl} placeholder="Detecting lines…" ready={computing && !error} />
                <ImageCard label="3 · Text Analysis Image (lines removed)" dataUrl={pg.textDataUrl} placeholder="Removing lines…" ready={computing && !error} />
              </div>
            </div>
          ))}

          {!loading && !error && pages.length === 0 && (
            <p className="text-sm text-slate-500">No pages processed.</p>
          )}

          {!loading && !error && (
            <p className="text-[11px] text-slate-400">
              Compare the three images: engineering text, decimal points, ±, diameter/degree symbols and letters should remain intact in the Text Analysis Image, while long dimension / extension / drawing lines should be substantially reduced. This is an isolated experiment — production OCR is unchanged.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ImageCard({ label, dataUrl, placeholder, ready = true }) {
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-2 py-1 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-700">
        {label}
      </div>
      <div className="p-2 bg-white">
        {dataUrl ? (
          <img src={dataUrl} alt={label} className="w-full rounded border border-slate-200" />
        ) : (
          <div className="h-40 flex items-center justify-center text-xs text-slate-400 bg-slate-50 rounded">
            {ready ? (
              <span className="flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {placeholder}</span>
            ) : (
              <span>{placeholder}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}