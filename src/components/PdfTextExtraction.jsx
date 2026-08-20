import React, { useEffect, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { recognize as tesseractRecognize } from 'tesseract.js';
import { Loader2, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fromPdfText, fromOcrWord, flattenOcrWords } from '@/lib/extractedItem';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

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
      try {
        const pdf = await pdfjsLib.getDocument({ url }).promise;
        if (cancelled) return;
        setPageCount(pdf.numPages);
        const all = [];
        let raw = 0;
        const stats = [];
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          if (cancelled) return;
          // includeMarkedContent keeps structure markers; we still filter display.
          const content = await page.getTextContent();
          if (cancelled) return;
          let pageChars = 0;
          content.items.forEach((it) => {
            raw++;
            const s = it.str ?? '';
            if (s.trim()) {
              all.push(fromPdfText(pageNum, it));
              pageChars += s.trim().length;
            }
          });
          stats.push({ page: pageNum, charCount: pageChars });
        }
        if (!cancelled) {
          setRawCount(raw);
          setExtractedItems(all);
          setPageStats(stats);

          // Render OCR-required pages to an off-screen canvas (white bg, scale 3.0).
          const renders = []; // [{ page, canvas }]
          for (const s of stats) {
            if (s.charCount >= 20) continue;
            try {
              const page = await pdf.getPage(s.page);
              if (cancelled) return;
              const viewport = page.getViewport({ scale: 3.0 });
              const canvas = document.createElement('canvas'); // off-screen, not attached
              canvas.width = Math.ceil(viewport.width);
              canvas.height = Math.ceil(viewport.height);
              const ctx = canvas.getContext('2d');
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              await page.render({ canvasContext: ctx, viewport }).promise;
              if (cancelled) return;
              renders.push({ page: s.page, canvas });
            } catch (err) {
              renders.push({ page: s.page, error: err?.message || String(err) });
            }
          }
          if (!cancelled) {
            setOcrRenders(
              renders.map((r) =>
                r.error
                  ? { page: r.page, status: 'error', message: `Page ${r.page} render failed: ${r.error}` }
                  : { page: r.page, status: 'success', message: `Page ${r.page} rendered successfully for OCR` }
              )
            );
            if (!cancelled) setLoading(false); // panels visible while OCR runs

            // Run Tesseract.js OCR on each rendered canvas (English only).
            const results = [];
            for (const r of renders) {
              if (cancelled) return;
              if (r.error) {
                results.push({ page: r.page, error: r.error });
                setOcrResults([...results]);
                continue;
              }
              setOcrStatus('Preparing page for OCR');
              setOcrStatus(`Reading page ${r.page}`);
              try {
                const { data } = await tesseractRecognize(r.canvas, 'eng', {
                  logger: (m) => {
                    if (m?.status === 'recognizing text') setOcrStatus('Recognizing text');
                  },
                });
                results.push({ page: r.page, text: data.text || '', confidence: data.confidence });
                // Word-level location capture, normalized to the standard item
                // shape and merged into the single extractedItems list.
                const scale = 3.0;
                const canvasH = r.canvas.height;
                const words = flattenOcrWords(data).map((w) => fromOcrWord(r.page, w, scale, canvasH));
                if (!cancelled && words.length) {
                  setExtractedItems((prev) => [...prev, ...words]);
                }
              } catch (err) {
                results.push({ page: r.page, error: err?.message || String(err) });
              }
              setOcrResults([...results]);
            }
            if (!cancelled) setOcrStatus('OCR complete');
          }
        }
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
          Drawing Extraction Test
          {!loading && !error && (
            <span className="text-xs text-slate-400 font-normal">
              ({extractedItems.length} text item{extractedItems.length === 1 ? '' : 's'} found · {rawCount} raw · {pageCount} page{pageCount === 1 ? '' : 's'})
            </span>
          )}
        </span>
        <span className="text-xs text-slate-400">PDF.js getTextContent() diagnostic</span>
      </button>

      {open && (
      <div className="p-4 space-y-3">
      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Extracting text from PDF…
        </div>
      )}

      {!loading && !error && pageStats.length > 0 && (
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
            Per-page embedded text check
          </div>
          <div className="divide-y divide-slate-100">
            {pageStats.map((s) => {
              const ocr = s.charCount < 20;
              return (
                <div key={s.page} className="flex items-center justify-between px-3 py-2 text-xs">
                  <span className="text-slate-600">Page {s.page}</span>
                  <span className="flex items-center gap-3">
                    <span className="font-mono text-slate-500">{s.charCount} chars</span>
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-full font-medium',
                        ocr
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-100 text-emerald-700'
                      )}
                    >
                      {ocr ? 'OCR Required' : 'Embedded Text'}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && !error && ocrRenders.length > 0 && (
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
            OCR render preview (off-screen, scale 3.0)
          </div>
          <div className="divide-y divide-slate-100">
            {ocrRenders.map((r) => (
              <div key={r.page} className="px-3 py-2 text-xs flex items-center gap-2">
                <span
                  className={cn(
                    'px-1.5 py-0.5 rounded font-mono',
                    r.status === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                  )}
                >
                  p{r.page}
                </span>
                <span className={cn('font-mono', r.status === 'success' ? 'text-emerald-700' : 'text-red-600')}>
                  {r.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !error && ocrRenders.length > 0 && (
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
            Tesseract.js OCR (English)
          </div>
          {ocrStatus && (
            <div className="px-3 py-2 flex items-center gap-2 text-xs text-slate-600 border-b border-slate-100">
              {ocrStatus !== 'OCR complete' && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
              <span className="font-mono">{ocrStatus}</span>
            </div>
          )}
          {ocrResults.length === 0 && !ocrStatus && (
            <div className="px-3 py-3 text-xs text-slate-400">No OCR-required pages.</div>
          )}
          <div className="divide-y divide-slate-100">
            {ocrResults.map((res) => (
              <div key={res.page} className="px-3 py-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">Page {res.page}</span>
                  {res.error ? (
                    <span className="text-red-600 font-mono">error</span>
                  ) : (
                    <span className="font-mono text-slate-500">
                      confidence {res.confidence != null ? `${Math.round(res.confidence)}%` : 'n/a'}
                    </span>
                  )}
                </div>
                {res.error ? (
                  <p className="text-xs text-red-600">{res.error}</p>
                ) : (
                  <pre className="text-xs font-mono whitespace-pre-wrap break-words bg-slate-50 rounded p-2 text-slate-800 max-h-64 overflow-y-auto">
                    {res.text || '(no text recognized)'}
                  </pre>
                )}
              </div>
            ))}
          </div>
          </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center justify-center py-8 text-slate-500">
              <FileText className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm">Could not extract text from this PDF.</p>
              <p className="text-xs text-slate-400">{loadError || 'PDF.js failed to load the document.'}</p>
            </div>
          )}

          {!loading && !error && extractedItems.length === 0 && (
            <div className="py-6 px-4 bg-slate-50 rounded-lg space-y-2 text-sm text-slate-600">
              <p className="font-medium text-slate-700">No text was found in this PDF.</p>
              <p className="text-xs text-slate-500">
                PDF.js returned <span className="font-mono">{rawCount}</span> raw text item(s) across <span className="font-mono">{pageCount}</span> page(s), but none contained actual text content.
              </p>
              <p className="text-xs text-slate-500">
                This usually means the drawing text is stored as <span className="font-medium">vector outlines/paths</span> (common with CAD-exported PDFs) or as a <span className="font-medium">rasterized scanned image</span>, rather than a real embedded text layer. PDF.js <span className="font-mono">getTextContent()</span> can only read actual text operators, not drawn shapes or pixels — so OCR would be required to recover the text.
              </p>
            </div>
          )}

          {!loading && !error && extractedItems.length > 0 && (
            <>
              <div className="flex gap-1 border-b border-slate-200">
                {[
                  ['text', 'Readable Text'],
                  ['table', 'Item Table'],
                  ['json', 'Raw JSON'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setView(key)}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium transition border-b-2 -mb-px',
                      view === key
                        ? 'border-primary text-primary'
                        : 'border-transparent text-slate-500 hover:text-slate-700'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {view === 'text' && (
                <div className="space-y-2 max-h-96 overflow-y-auto bg-slate-50 rounded-lg p-3 text-sm font-mono">
                  {readableLines.map((line, i) => (
                    <div key={i} className="flex gap-3">
                      <span className="text-slate-400 shrink-0 w-20">p{line.page} y{line.y}</span>
                      <span className="text-slate-800 whitespace-pre-wrap break-words">{line.text || '\u00A0'}</span>
                    </div>
                  ))}
                </div>
              )}

              {view === 'table' && (
                <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100 sticky top-0">
                      <tr className="text-left text-slate-600">
                        <th className="px-2 py-1.5">#</th>
                        <th className="px-2 py-1.5">Text</th>
                        <th className="px-2 py-1.5">Page</th>
                        <th className="px-2 py-1.5">X</th>
                        <th className="px-2 py-1.5">Y</th>
                        <th className="px-2 py-1.5">Width</th>
                        <th className="px-2 py-1.5">Height</th>
                        <th className="px-2 py-1.5">Source</th>
                        <th className="px-2 py-1.5">Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {extractedItems.map((it, i) => (
                        <tr key={i} className={i % 2 ? 'bg-slate-50' : 'bg-white'}>
                          <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                          <td className="px-2 py-1 font-mono whitespace-pre-wrap break-words max-w-md">{it.text}</td>
                          <td className="px-2 py-1">{it.page}</td>
                          <td className="px-2 py-1">{it.x}</td>
                          <td className="px-2 py-1">{it.y}</td>
                          <td className="px-2 py-1">{it.width}</td>
                          <td className="px-2 py-1">{it.height}</td>
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
                          <td className="px-2 py-1 font-mono">{it.confidence != null ? `${it.confidence}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {view === 'json' && (
                <pre className="max-h-96 overflow-auto bg-slate-900 text-slate-100 rounded-lg p-3 text-xs font-mono">
                  {JSON.stringify(extractedItems, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}