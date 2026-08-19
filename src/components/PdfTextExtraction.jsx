import React, { useEffect, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { Loader2, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

// One normalized record per text item found by PDF.js getTextContent().
// y is the PDF user-space Y (origin bottom-left); we also store a screen Y
// (top-left origin) to make the readable-order sort intuitive.
function buildItem(pageNum, item) {
  const tx = item.transform || [0, 0, 0, 0, 0, 0];
  const x = tx[4];
  const yPdf = tx[5];
  const height = Math.abs(item.height || 0);
  return {
    page: pageNum,
    text: item.str ?? '',
    x: Math.round((Number.isFinite(x) ? x : 0) * 100) / 100,
    y: Math.round((Number.isFinite(yPdf) ? yPdf : 0) * 100) / 100,
    width: Math.round((Number.isFinite(item.width) ? item.width : 0) * 100) / 100,
    height: Math.round(height * 100) / 100,
    hasEOL: !!item.hasEOL,
  };
}

export default function PdfTextExtraction({ url }) {
  const [items, setItems] = useState([]);
  const [rawCount, setRawCount] = useState(0);
  const [pageCount, setPageCount] = useState(0);
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
      setItems([]);
      setRawCount(0);
      setPageCount(0);
      try {
        const pdf = await pdfjsLib.getDocument({ url }).promise;
        if (cancelled) return;
        setPageCount(pdf.numPages);
        const all = [];
        let raw = 0;
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          if (cancelled) return;
          // includeMarkedContent keeps structure markers; we still filter display.
          const content = await page.getTextContent();
          if (cancelled) return;
          content.items.forEach((it) => {
            raw++;
            if (it.str && it.str.trim()) all.push(buildItem(pageNum, it));
          });
        }
        if (!cancelled) {
          setRawCount(raw);
          setItems(all);
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
  const ordered = [...items].sort((a, b) =>
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
              ({items.length} text item{items.length === 1 ? '' : 's'} found · {rawCount} raw · {pageCount} page{pageCount === 1 ? '' : 's'})
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
          {error && !loading && (
            <div className="flex flex-col items-center justify-center py-8 text-slate-500">
              <FileText className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm">Could not extract text from this PDF.</p>
              <p className="text-xs text-slate-400">{loadError || 'PDF.js failed to load the document.'}</p>
            </div>
          )}

          {!loading && !error && items.length === 0 && (
            <div className="py-6 px-4 bg-slate-50 rounded-lg space-y-2 text-sm text-slate-600">
              <p className="font-medium text-slate-700">No embedded text was found in this PDF.</p>
              <p className="text-xs text-slate-500">
                PDF.js returned <span className="font-mono">{rawCount}</span> raw text item(s) across <span className="font-mono">{pageCount}</span> page(s), but none contained actual text content.
              </p>
              <p className="text-xs text-slate-500">
                This usually means the drawing text is stored as <span className="font-medium">vector outlines/paths</span> (common with CAD-exported PDFs) or as a <span className="font-medium">rasterized scanned image</span>, rather than a real embedded text layer. PDF.js <span className="font-mono">getTextContent()</span> can only read actual text operators, not drawn shapes or pixels — so OCR would be required to recover the text.
              </p>
            </div>
          )}

          {!loading && !error && items.length > 0 && (
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
                        <th className="px-2 py-1.5">Page</th>
                        <th className="px-2 py-1.5">X</th>
                        <th className="px-2 py-1.5">Y</th>
                        <th className="px-2 py-1.5">Width</th>
                        <th className="px-2 py-1.5">Height</th>
                        <th className="px-2 py-1.5">Text</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, i) => (
                        <tr key={i} className={i % 2 ? 'bg-slate-50' : 'bg-white'}>
                          <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                          <td className="px-2 py-1">{it.page}</td>
                          <td className="px-2 py-1">{it.x}</td>
                          <td className="px-2 py-1">{it.y}</td>
                          <td className="px-2 py-1">{it.width}</td>
                          <td className="px-2 py-1">{it.height}</td>
                          <td className="px-2 py-1 font-mono whitespace-pre-wrap break-words max-w-md">{it.text}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {view === 'json' && (
                <pre className="max-h-96 overflow-auto bg-slate-900 text-slate-100 rounded-lg p-3 text-xs font-mono">
                  {JSON.stringify(items, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}