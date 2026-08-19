import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { Loader2, FileText } from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export default function PdfViewer({ url, height = 600 }) {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const renderTasks = [];

    const render = async () => {
      try {
        setLoading(true);
        setError(false);
        const container = containerRef.current;
        if (container) container.innerHTML = '';

        const pdf = await pdfjsLib.getDocument({ url }).promise;
        if (cancelled) return;
        setPageCount(pdf.numPages);

        // Use the parent's width (always visible) — the scroll container may be hidden.
        const measured = container?.parentElement?.clientWidth || container?.clientWidth || 600;
        const targetWidth = Math.min(measured, 800);
        if (targetWidth <= 0) throw new Error('No width');

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          if (cancelled) return;
          const viewport = page.getViewport({ scale: 1 });
          const scale = targetWidth / viewport.width;
          const scaledViewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          canvas.className = 'block rounded-lg shadow-sm border border-slate-200 mx-auto';
          canvas.style.marginBottom = '12px';
          const context = canvas.getContext('2d');
          canvas.width = scaledViewport.width;
          canvas.height = scaledViewport.height;
          container.appendChild(canvas);

          const task = page.render({ canvasContext: context, viewport: scaledViewport });
          renderTasks.push(task);
          await task.promise;
          if (cancelled) return;
        }
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      }
    };

    render();
    return () => {
      cancelled = true;
      renderTasks.forEach((t) => t.cancel?.());
    };
  }, [url]);

  return (
    <div>
      <div
        ref={containerRef}
        className="overflow-y-auto bg-slate-50 rounded-lg p-3 flex flex-col items-center gap-3"
        style={{ maxHeight: `${height}px` }}
      >
        {loading && (
          <div className="flex items-center justify-center py-12 text-slate-500 w-full">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading PDF...
          </div>
        )}
        {error && !loading && (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500 w-full">
            <FileText className="w-10 h-10 mb-2 opacity-40" />
            <p>Could not load PDF preview. <a href={url} target="_blank" rel="noreferrer" className="text-primary underline">Open in new tab</a></p>
          </div>
        )}
      </div>
      {!loading && !error && pageCount > 0 && (
        <p className="text-xs text-slate-400 mt-1 text-center">{pageCount} page(s)</p>
      )}
    </div>
  );
}