import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import { FileText, Loader2 } from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfjsWorker();

export default function PdfThumbnail({ url, className }) {
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let renderTask = null;

    const render = async () => {
      try {
        setLoading(true);
        setError(false);
        const loadingTask = pdfjsLib.getDocument({ url });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        const page = await pdf.getPage(1);
        if (cancelled) return;

        const targetWidth = 200;
        const viewport = page.getViewport({ scale: 1 });
        const scale = targetWidth / viewport.width;
        const scaledViewport = page.getViewport({ scale });

        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext('2d');
        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;

        renderTask = page.render({ canvasContext: context, viewport: scaledViewport });
        await renderTask.promise;
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
      if (renderTask) renderTask.cancel?.();
    };
  }, [url]);

  return (
    <div className={className}>
      {loading && (
        <div className="flex items-center justify-center h-28 w-36 bg-slate-100 rounded-lg">
          <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
        </div>
      )}
      {error && !loading && (
        <div className="flex items-center justify-center h-28 w-36 bg-slate-100 rounded-lg">
          <FileText className="w-6 h-6 text-slate-400" />
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={`rounded-lg border border-slate-200 shadow-sm ${loading || error ? 'hidden' : 'block'}`}
      />
    </div>
  );
}