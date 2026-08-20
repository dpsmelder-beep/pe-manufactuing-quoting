import React, { useEffect, useState } from 'react';
import { Loader2, ChevronDown, ChevronRight, ScanText } from 'lucide-react';
import {
  loadPdf,
  extractEmbeddedText,
  renderPageToCanvas,
  runOcrVersions,
  EMBEDDED_TEXT_THRESHOLD,
  HIGH_OCR_SCALE,
} from '@/lib/pdfOcrService';

/**
 * Diagnostic panel: for every page that requires OCR, render it at high
 * resolution and run Tesseract.js against three preprocessing variants
 * (original, grayscale+contrast, thresholded B&W). No version is chosen
 * automatically — the operator compares results.
 *
 * Runs only when expanded, and never touches the visible PDF viewer.
 */
export default function OcrPreprocessingTest({ url }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [pages, setPages] = useState([]); // [{ pageNum, ocr, versions, status, error? }]
  const [status, setStatus] = useState('');
  const [scannedCount, setScannedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);

  useEffect(() => {
    if (!url || !open) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(false);
      setLoadError(null);
      setPages([]);
      setStatus('Loading PDF…');
      let scanned = 0;
      let skipped = 0;
      try {
        const pdf = await loadPdf(url);
        if (cancelled) return;
        const entries = [];
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          if (cancelled) return;
          const { charCount } = await extractEmbeddedText(page, p);
          if (cancelled) return;
          const needsOcr = charCount < EMBEDDED_TEXT_THRESHOLD;
          const entry = { pageNum: p, ocr: needsOcr, versions: [], status: needsOcr ? 'rendering' : 'skipped' };
          entries.push(entry);
          setPages([...entries]);
          if (!needsOcr) { skipped++; continue; }
          scanned++;
          setStatus(`Rendering page ${p} at ×${HIGH_OCR_SCALE}`);
          const { canvas } = await renderPageToCanvas(page, HIGH_OCR_SCALE);
          if (cancelled) return;
          entry.status = 'ocr';
          setPages([...entries]);
          const versions = await runOcrVersions(canvas, p, {
            onStatus: (s) => setStatus(`${s} (page ${p})`),
          });
          if (cancelled) return;
          entry.versions = versions;
          entry.status = 'done';
          setPages([...entries]);
        }
        setScannedCount(scanned);
        setSkippedCount(skipped);
        setStatus('OCR preprocessing comparison complete');
      } catch (err) {
        if (!cancelled) { setError(true); setLoadError(err?.message || String(err)); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [url, open]);

  const ocrPages = pages.filter((p) => p.ocr);

  return (
    <div className="border border-slate-200 rounded-lg mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 rounded-t-lg hover:bg-slate-100 transition"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          OCR Preprocessing Test
          <span className="text-xs text-slate-400 font-normal">Diagnostic (dev/test)</span>
        </span>
        {loading && status && (
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> {status}
          </span>
        )}
      </button>

      {open && (
        <div className="p-4 space-y-4">
          {!loading && !error && (
            <div className="grid grid-cols-2 sm:grid-cols-3 rounded-lg border border-slate-200 overflow-hidden divide-x divide-slate-100">
              <Stat label="Pages Scanned (OCR)" value={scannedCount} />
              <Stat label="Pages Skipped (Embedded)" value={skippedCount} />
              <Stat label="Render Scale" value={`×${HIGH_OCR_SCALE}`} />
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> {status || 'Preparing…'}
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center justify-center py-8 text-slate-500">
              <ScanText className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm">Could not run OCR preprocessing test.</p>
              <p className="text-xs text-slate-400">{loadError}</p>
            </div>
          )}

          {!loading && !error && ocrPages.length === 0 && (
            <div className="py-6 px-4 bg-slate-50 rounded-lg text-sm text-slate-600">
              No pages required OCR — all pages had embedded text.
            </div>
          )}

          {!loading && !error && ocrPages.map((pg) => (
            <div key={pg.pageNum} className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 flex items-center justify-between">
                <span>Page {pg.pageNum}</span>
                <span className="text-slate-400 font-normal">
                  {pg.status === 'done' ? `${pg.versions.length} versions` : pg.status}
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {pg.versions.map((v) => (
                  <div key={v.key} className="p-3 space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <div className="text-sm font-medium text-slate-800 flex items-center gap-2 flex-wrap">
                          {v.label}
                          <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium text-[10px]">{v.ocrMethod}</span>
                        </div>
                        <div className="text-[11px] text-slate-500">{v.method}</div>
                      </div>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">{v.wordCount} words</span>
                        <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
                          {v.confidence != null ? `${Math.round(v.confidence)}% conf` : '— conf'}
                        </span>
                        <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
                          {v.processingMs != null ? `${v.processingMs} ms` : '— ms'}
                        </span>
                      </div>
                    </div>
                    {v.error ? (
                      <p className="text-xs text-red-600">{v.error}</p>
                    ) : (
                      <pre className="text-xs font-mono whitespace-pre-wrap break-words bg-slate-50 rounded p-2 text-slate-800 max-h-40 overflow-y-auto">
                        {v.text || '(no text recognized)'}
                      </pre>
                    )}
                  </div>
                ))}
                {pg.versions.length === 0 && pg.status !== 'done' && (
                  <div className="p-3 text-xs text-slate-400 flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> {pg.status}…
                  </div>
                )}
              </div>
            </div>
          ))}

          {!loading && !error && (
            <p className="text-[11px] text-slate-400">
              No version is chosen automatically — compare the text, confidence and word counts above to decide which preprocessing method works best for your drawings.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-lg font-semibold text-slate-800">{value}</div>
    </div>
  );
}