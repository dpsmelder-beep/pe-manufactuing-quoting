import React, { useEffect, useRef, useState } from 'react';
import { Loader2, ChevronDown, ChevronRight, GitCompare, AlertCircle } from 'lucide-react';
import { loadPdf, renderPageToCanvas, DEFAULT_OCR_SCALE } from '@/lib/pdfOcrService';
import { getProvider, PROVIDERS } from '@/lib/ocrProviders';

// Per-provider accent color for the bounding-box overlay.
const STROKE = {
  tesseract: '#16a34a',
  paddleocr: '#2563eb',
};

export default function OcrEngineComparisonTest({ url }) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [thumb, setThumb] = useState(null); // { dataUrl, width, height }
  const [results, setResults] = useState({}); // { [id]: { items, text, timeMs, status, error } }

  const pageCanvasRef = useRef(null);

  // Reset when the document changes.
  useEffect(() => {
    if (!open) return;
    setThumb(null);
    setResults({});
    setError(null);
    setPageCount(0);
    (async () => {
      try {
        const pdf = await loadPdf(url);
        setPageCount(pdf.numPages);
      } catch (err) {
        setError(err?.message || String(err));
      }
    })();
  }, [url, open]);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResults({});
    setThumb(null);
    try {
      const pdf = await loadPdf(url);
      const page = await pdf.getPage(pageNum);
      const { canvas } = await renderPageToCanvas(page, DEFAULT_OCR_SCALE);
      pageCanvasRef.current = canvas;
      setThumb({
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
      });

      const out = {};
      for (const meta of PROVIDERS) {
        out[meta.id] = { label: meta.label, status: 'starting', items: [], text: '', timeMs: 0 };
        setResults({ ...out });
        const t0 = performance.now();
        try {
          const provider = getProvider(meta.id);
          const res = await provider.analyzeDrawingPage(canvas, {
            pageNumber: pageNum,
            onStatus: (s) => {
              out[meta.id] = { ...out[meta.id], status: s };
              setResults({ ...out });
            },
          });
          const t1 = performance.now();
          out[meta.id] = {
            label: meta.label,
            status: 'done',
            items: res.items || [],
            text: res.text || '',
            timeMs: t1 - t0,
            confidence: res.confidence,
          };
        } catch (err) {
          const t1 = performance.now();
          out[meta.id] = {
            label: meta.label,
            status: 'error',
            items: [],
            text: '',
            timeMs: t1 - t0,
            error: err?.message || String(err),
          };
        }
        setResults({ ...out });
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="border border-slate-200 rounded-lg mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 rounded-t-lg hover:bg-slate-100 transition"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <GitCompare className="w-4 h-4" />
          OCR Engine Comparison
          <span className="text-xs text-slate-400 font-normal">Side-by-side (dev/test)</span>
        </span>
        <span className="text-xs text-slate-400">{PROVIDERS.length} engines</span>
      </button>

      {open && (
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
            {pageCount > 1 && (
              <label className="flex items-center gap-2">
                <span className="text-slate-500">Page:</span>
                <select
                  value={pageNum}
                  onChange={(e) => setPageNum(parseInt(e.target.value, 10))}
                  className="border border-input rounded px-2 py-1 bg-white"
                  disabled={running}
                >
                  {Array.from({ length: pageCount }, (_, i) => (
                    <option key={i} value={i + 1}>{i + 1}</option>
                  ))}
                </select>
              </label>
            )}
            <button
              onClick={run}
              disabled={running}
              className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
            >
              {running ? 'Running…' : 'Run comparison'}
            </button>
            {running && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />}
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}

          {thumb && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {PROVIDERS.map((meta) => (
                <EngineColumn
                  key={meta.id}
                  meta={meta}
                  stroke={STROKE[meta.id] || '#475569'}
                  result={results[meta.id]}
                  thumb={thumb}
                />
              ))}
            </div>
          )}

          {!thumb && !running && !error && (
            <p className="text-xs text-slate-500">
              Click <b>Run comparison</b> to process this drawing page with every OCR engine and compare results side by side.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function EngineColumn({ meta, stroke, result, thumb }) {
  const status = result?.status;
  const items = result?.items || [];
  const avgConf =
    items.length > 0
      ? items.reduce((s, i) => s + (i.confidence || 0), 0) / items.length
      : result?.confidence ?? 0;

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">{meta.label}</span>
        <span className="text-[10px] text-slate-400">{meta.id}</span>
      </div>

      <div className="grid grid-cols-4 divide-x divide-slate-100 border-b border-slate-200">
        <Stat label="Regions" value={items.length} />
        <Stat label="Avg conf" value={items.length ? `${Math.round(avgConf * 100)}%` : '—'} />
        <Stat label="Time" value={result?.timeMs ? `${result.timeMs.toFixed(0)} ms` : '—'} />
        <Stat label="Status" value={status === 'done' ? 'done' : status === 'error' ? 'error' : status === 'starting' || status ? '…' : '—'} />
      </div>

      {result?.error && (
        <div className="px-3 py-2 text-xs text-red-600 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="break-words">{result.error}</span>
        </div>
      )}

      {/* Bounding-box overlay */}
      <div className="relative bg-slate-100 border-b border-slate-200">
        {thumb && (
          <>
            <img src={thumb.dataUrl} alt="page" className="w-full block" />
            <svg
              viewBox={`0 0 ${thumb.width} ${thumb.height}`}
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full"
            >
              {items.map((it, i) => (
                <rect
                  key={i}
                  x={it.x}
                  y={it.y}
                  width={it.width}
                  height={it.height}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={Math.max(1, thumb.width / 600)}
                  opacity={0.85}
                />
              ))}
            </svg>
          </>
        )}
      </div>

      {/* Recognized text */}
      <div className="max-h-56 overflow-auto">
        {items.length === 0 ? (
          <p className="px-3 py-2 text-xs text-slate-400">
            {status === 'done' ? 'No text regions detected.' : 'Waiting…'}
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-100 sticky top-0">
              <tr className="text-left text-slate-600">
                <th className="px-2 py-1.5">Text</th>
                <th className="px-2 py-1.5">Box</th>
                <th className="px-2 py-1.5">Conf</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className={i % 2 ? 'bg-slate-50' : 'bg-white'}>
                  <td className="px-2 py-1 font-mono whitespace-pre-wrap break-words max-w-[200px]">{it.text}</td>
                  <td className="px-2 py-1 font-mono text-[10px] text-slate-500">
                    {Math.round(it.x)},{Math.round(it.y)} · {Math.round(it.width)}×{Math.round(it.height)}
                  </td>
                  <td className="px-2 py-1 font-mono">{it.confidence != null ? `${Math.round(it.confidence * 100)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, running }) {
  return (
    <div className="px-2 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-800">{value}</div>
    </div>
  );
}