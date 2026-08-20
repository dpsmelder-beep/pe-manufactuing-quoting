import React from 'react';
import { Card } from '@/components/ui/card';

export default function AnalysisSection({ title, items, children }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-xs rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400 py-2">No items.</p>
      ) : (
        <div>{children}</div>
      )}
    </Card>
  );
}