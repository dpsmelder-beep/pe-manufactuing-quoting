import React, { useEffect, useState } from 'react';
import { Loader2, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  loadPdf,
  extractEmbeddedText,
  renderPageToCanvas,
  ocrCanvas,
  computeExtractionMode,
  EMBEDDED_TEXT_THRESHOLD,
  DEFAULT_OCR_SCALE,
} from '@/lib/pdfOcrService';

export default function PdfTextExtraction({ url }) {
  // Single standardized list consumed by all downstream UI — both PDF.js
  // embedded text and Tesseract.js OCR results land here in the same shape.
  const [extractedItems, setExtractedItems] = useState([]);
  const [rawCount, setRawCount] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [pageStats, setPageStats] = useState([]); // [{ page, charCount }]
  const [ocrRenders, setOcrRenders] = useState([]); // [{ page, status, message }]
  const [ocrStatus, setOcrStatus] = useState(''); // live status string
  const [ocrResults, setOcrResults] = useState([]); // [{ page, text, confidence, error? }]
  const [extractionMode, setExtractionMode] = useState(''); // 'PDF Embedded Text' | 'OCR' | 'Mixed'
  const [pagesPdf, setPagesPdf] = useState(0);
  const [pagesOcr, setPagesOcr] = useState(0);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('text'); // 'text' | 'table' | 'json'

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(false);
      setLoadError(null);
      setExtractedItems([]);
      setRawCount(0);
      setPageCount(0);
      setPageStats([]);
      setOcrRenders([]);
      setOcrStatus('');
      setOcrResults([]);
      setExtractionMode('');
      setPagesPdf(0);
      setPagesOcr(0);
      try {
        const pdf = await loadPdf(url);
        if (cancelled) return;
        setPageCount(pdf.numPages);
        // Step 1: attempt PDF.js embedded text extraction for every page.
        const perPagePdfItems = {}; // pageNum -> standardized items
        let raw = 0;
        const stats = [];
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          if (cancelled) return;
          const { items, charCount } = await extractEmbeddedText(page, pageNum);
          if (cancelled) return;
          raw += items.length;
          perPagePdfItems[pageNum] = items;
          stats.push({ page: pageNum, charCount });
        }
        if (cancelled) return;
        setRawCount(raw);
        setPageStats(stats);

        // Step 2-4: per page, use embedded text if sufficient, otherwise render + OCR.
        const unified = [];
        const ocrNeeded = stats.filter((s) => s.charCount < EMBEDDED_TEXT_THRESHOLD).map((s) => s.page);
        const embeddedPages = stats.length - ocrNeeded.length;
        setPagesPdf(embeddedPages);

        // Emit embedded-text items for sufficient pages right away.
        stats.forEach((s) => {
          if (s.charCount >= EMBEDDED_TEXT_THRESHOLD) unified.push(...perPagePdfItems[s.page]);
        });
        setExtractedItems([...unified]);

        // Render the OCR-required pages to off-screen canvases (service handles it).
        const renders = []; // [{ page, canvas }]
        for (const pageNum of ocrNeeded) {
          try {
            const page = await pdf.getPage(pageNum);
            if (cancelled) return;
            const { canvas } = await renderPageToCanvas(page, DEFAULT_OCR_SCALE);
            if (cancelled) return;
            renders.push({ page: pageNum, canvas });
          } catch (err) {
            renders.push({ page: pageNum, error: err?.message || String(err) });
          }
        }
        if (cancelled) return;
        setOcrRenders(
          renders.map((r) =>
            r.error
              ? { page: r.page, status: 'error', message: `Page ${r.page} render failed: ${r.error}` }
              : { page: r.page, status: 'success', message: `Page ${r.page} rendered successfully for OCR` }
          )
        );
        setLoading(false); // panels visible while OCR runs

        // Step 5: run OCR via the portable service and merge standardized items.
        const results = [];
        for (const r of renders) {
          if (cancelled) return;
          if (r.error) {
            results.push({ page: r.page, error: r.error });
            setOcrResults([...results]);
            continue;
          }
          setOcrStatus(`Reading page ${r.page}`);
          try {
            const { words, text, confidence } = await ocrCanvas(r.canvas, r.page, {
              scale: DEFAULT_OCR_SCALE,
              onStatus: setOcrStatus,
            });
            results.push({ page: r.page, text, confidence });
            if (words.length) {
              unified.push(...words);
              setExtractedItems([...unified]);
            }
          } catch (err) {
            results.push({ page: r.page, error: err?.message || String(err) });
          }
          setOcrResults([...results]);
        }
        if (cancelled) return;

        // Overall extraction mode across all pages (computed by the service).
        const ocrPages = renders.filter((r) => !r.error).length;
        setPagesOcr(ocrPages);
        setExtractionMode(computeExtractionMode(embeddedPages, ocrPages));
        setOcrStatus('OCR complete');
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
  }, [url]);

  // Readable order: by page, then top-to-bottom (high PDF y first), then left-to-right.
  const ordered = [...extractedItems].sort((a, b) =>
    a.page !== b.page ? a.page - b.page : b.y - a.y || a.x - b.x
  );

  // Grouped readable text, joined into lines respecting hasEOL where possible.
  const readableLines = [];
  ordered.forEach((it, idx) => {
    const prev = ordered[idx - 1];
    if (idx === 0 || prev.page !== it.page || prev.y !== it.y) {
      readableLines.push({ page: it.page, y: it.y, text: it.text });
    } else {
      readableLines[readableLines.length - 1].text += it.text;
    }
  });

  return (
    <div className="border border-slate-200 rounded-lg mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 rounded-t-lg hover:bg-slate-100 transition"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Drawing Extraction
          <span className="text-xs text-slate-400 font-normal">Diagnostic (dev/test)</span>
        </span>
        <span className="flex items-center gap-2">
          {extractionMode && (
            <span
              className={cn(
                'px-2 py-0.5 rounded-full text-xs font-medium',
                extractionMode === 'Mixed'
                  ? 'bg-violet-100 text-violet-700'
                  : extractionMode === 'OCR'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-emerald-100 text-emerald-700'
              )}
            >
              {extractionMode}
            </span>
          )}
          {ocrStatus && ocrStatus !== 'OCR complete' && (
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {ocrStatus}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="p-4 space-y-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Extracting text from PDF…
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center justify-center py-8 text-slate-500">
              <FileText className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm">Could not extract text from this PDF.</p>
              <p className="text-xs text-slate-400">{loadError || 'PDF.js failed to load the document.'}</p>
            </div>
          )}

          {!loading && !error && (
            <>
              {/* Extraction Summary */}
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
                  Extraction Summary
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-slate-100">
                  <SummaryStat label="Pages" value={pageCount} />
                  <SummaryStat label="Embedded Text" value={pagesPdf} />
                  <SummaryStat label="OCR" value={pagesOcr} />
                  <SummaryStat label="Text Items" value={extractedItems.length} />
                </div>
              </div>

              {extractedItems.length === 0 ? (
                <div className="py-6 px-4 bg-slate-50 rounded-lg space-y-2 text-sm text-slate-600">
                  <p className="font-medium text-slate-700">No text was found in this PDF.</p>
                  <p className="text-xs text-slate-500">
                    This usually means the drawing text is stored as vector outlines/paths or a rasterized scanned image rather than an embedded text layer, so OCR is required to recover it.
                  </p>
                </div>
              ) : (
                <>
                  {/* Extracted Text */}
                  <div className="rounded-lg border border-slate-200 overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
                      Extracted Text
                    </div>
                    <div className="max-h-64 overflow-y-auto bg-slate-50 p-3 text-sm font-mono space-y-1">
                      {readableLines.map((line, i) => (
                        <div key={i} className="flex gap-3">
                          <span className="text-slate-400 shrink-0 w-16">p{line.page}</span>
                          <span className="text-slate-800 whitespace-pre-wrap break-words">{line.text || '\u00A0'}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Recognized Items */}
                  <div className="rounded-lg border border-slate-200 overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
                      Recognized Items
                    </div>
                    <div className="max-h-80 overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-100 sticky top-0">
                          <tr className="text-left text-slate-600">
                            <th className="px-2 py-1.5">Text</th>
                            <th className="px-2 py-1.5">Page</th>
                            <th className="px-2 py-1.5">Source</th>
                            <th className="px-2 py-1.5">X</th>
                            <th className="px-2 py-1.5">Y</th>
                            <th className="px-2 py-1.5">Width</th>
                            <th className="px-2 py-1.5">Height</th>
                            <th className="px-2 py-1.5">Confidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {extractedItems.map((it, i) => (
                            <tr key={i} className={i % 2 ? 'bg-slate-50' : 'bg-white'}>
                              <td className="px-2 py-1 font-mono whitespace-pre-wrap break-words max-w-xs">{it.text}</td>
                              <td className="px-2 py-1">{it.page}</td>
                              <td className="px-2 py-1">
                                <span
                                  className={cn(
                                    'px-1.5 py-0.5 rounded-full font-medium',
                                    it.source === 'ocr' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                                  )}
                                >
                                  {it.source === 'ocr' ? 'OCR' : 'PDF Text'}
                                </span>
                              </td>
                              <td className="px-2 py-1 font-mono">{it.x}</td>
                              <td className="px-2 py-1 font-mono">{it.y}</td>
                              <td className="px-2 py-1 font-mono">{it.width}</td>
                              <td className="px-2 py-1 font-mono">{it.height}</td>
                              <td className="px-2 py-1 font-mono">{it.confidence != null ? `${it.confidence}%` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Raw JSON (expandable) */}
                  <div className="rounded-lg border border-slate-200 overflow-hidden">
                    <button
                      onClick={() => setView(view === 'json' ? 'text' : 'json')}
                      className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
                    >
                      <span className="flex items-center gap-2">
                        {view === 'json' ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        Raw JSON
                      </span>
                      <span className="text-xs text-slate-400 font-normal">{extractedItems.length} items</span>
                    </button>
                    {view === 'json' && (
                      <pre className="max-h-80 overflow-auto bg-slate-900 text-slate-100 p-3 text-xs font-mono">
                        {JSON.stringify(extractedItems, null, 2)}
                      </pre>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryStat({ label, value }) {
  return (
    <div className="px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-lg font-semibold text-slate-800">{value}</div>
    </div>
  );
}