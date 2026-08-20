import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * One parsed engineering entry: a summary line (primary + structured tags)
 * plus an expandable panel showing the original OCR text and extraction
 * metadata (raw text, source engine, confidence, page, bounding box).
 */
export default function ItemRow({ entry, primary, tags }) {
  const [open, setOpen] = useState(false);
  const conf = entry?.confidence;
  const bbox = entry?.bbox;

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 py-2 text-left hover:bg-slate-50"
      >
        <ChevronRight className={cn('w-4 h-4 shrink-0 text-slate-400 transition', open && 'rotate-90')} />
        <span className="font-medium text-sm">{primary}</span>
        <span className="ml-auto flex flex-wrap gap-1.5 justify-end">
          {tags.map((t) => (
            <span
              key={t.label}
              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
            >
              <span className="text-slate-400">{t.label}:</span> {t.value}
            </span>
          ))}
        </span>
      </button>
      {open && (
        <div className="pl-6 pb-3 text-xs text-slate-500 space-y-0.5">
          <div>
            <span className="text-slate-400">Original OCR:</span>{' '}
            {entry?.original_text || entry?.text || '—'}
          </div>
          <div>
            <span className="text-slate-400">Raw text:</span> {entry?.text || '—'}
          </div>
          <div>
            <span className="text-slate-400">Source:</span> {entry?.source || '—'} ·{' '}
            <span className="text-slate-400">Confidence:</span>{' '}
            {conf != null ? `${(conf * 100).toFixed(0)}%` : 'n/a'} ·{' '}
            <span className="text-slate-400">Page:</span> {entry?.page ?? '—'}
          </div>
          {bbox && (
            <div>
              <span className="text-slate-400">BBox:</span> x={bbox.x}, y={bbox.y}, w={bbox.width}, h={bbox.height}
            </div>
          )}
        </div>
      )}
    </div>
  );
}