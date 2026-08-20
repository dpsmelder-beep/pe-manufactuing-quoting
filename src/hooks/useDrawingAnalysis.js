import { useState, useCallback } from 'react';
import { extractDrawingItems } from '@/lib/extractDrawingItems';
import { parseDrawingItems } from '@/lib/engineeringDrawingParser';

/**
 * Runs the PDF + OCR extraction pipeline and the deterministic engineering
 * drawing parser, exposing the categorized result for the Drawing Analysis
 * verification screen.
 */
export function useDrawingAnalysis() {
  const [parsed, setParsed] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');

  const run = useCallback(async (url) => {
    if (!url) return;
    setLoading(true);
    setError(null);
    setParsed(null);
    setItems([]);
    setStatus('Starting…');
    try {
      const res = await extractDrawingItems(url, { onStatus: setStatus });
      setItems(res.items);
      setParsed(parseDrawingItems(res.items));
      const mode =
        res.pagesOcr === 0
          ? 'embedded text'
          : res.pagesPdf === 0
            ? 'OCR'
            : 'mixed';
      setStatus(`Done — ${res.items.length} text items across ${res.numPages} page(s) [${mode}].`);
    } catch (e) {
      setError(e?.message || 'Analysis failed');
      setStatus('');
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setParsed(null);
    setItems([]);
    setError(null);
    setStatus('');
  }, []);

  return { parsed, items, loading, error, status, run, clear };
}