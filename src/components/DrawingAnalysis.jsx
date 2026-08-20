import React, { useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScanLine, Loader2, FileText } from 'lucide-react';
import { useDrawingAnalysis } from '@/hooks/useDrawingAnalysis';
import AnalysisSection from '@/components/drawingAnalysis/Section';
import ItemRow from '@/components/drawingAnalysis/ItemRow';
import {
  mapDimension,
  mapRadius,
  mapDiameter,
  mapQuantity,
  mapLimit,
  mapMaterial,
  mapFinish,
  mapSpecification,
  mapUnclassified,
} from '@/lib/drawingFormat';

/**
 * Production-oriented verification section: runs the PDF + PaddleOCR extraction
 * pipeline on a selected drawing, parses it with the deterministic engineering
 * drawing parser, and displays the structured results grouped by category.
 *
 * No pricing calculations — its sole purpose is to verify that raw OCR text is
 * being converted into correct structured engineering information. Every item
 * (including unclassified) is expandable to reveal its original OCR text.
 */
export default function DrawingAnalysis({ documents = [], selectedDoc, onSelectDoc }) {
  const { parsed, items, loading, error, status, run, clear } = useDrawingAnalysis();

  // Reset results whenever the selected source document changes.
  useEffect(() => {
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDoc?.url]);

  const fileUrl = selectedDoc?.url;

  const renderSection = (title, entries, mapper) => (
    <AnalysisSection title={title} items={entries}>
      {entries.map((e, i) => {
        const { primary, tags } = mapper(e);
        return <ItemRow key={i} entry={e} primary={primary} tags={tags} />;
      })}
    </AnalysisSection>
  );

  const finishSpec = parsed ? [...parsed.finishes, ...parsed.specifications] : [];

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <ScanLine className="w-5 h-5 text-primary" />
          <div className="flex-1 min-w-[200px]">
            <Select
              value={selectedDoc?.url || ''}
              onValueChange={(v) => onSelectDoc?.(documents.find((d) => d.url === v))}
              disabled={documents.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder={documents.length === 0 ? 'No PDF documents' : 'Select a PDF drawing'} />
              </SelectTrigger>
              <SelectContent>
                {documents.map((d, i) => (
                  <SelectItem key={i} value={d.url}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => run(fileUrl)} disabled={!fileUrl || loading}>
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ScanLine className="w-4 h-4 mr-2" />}
            {loading ? 'Analyzing…' : 'Run Analysis'}
          </Button>
        </div>
        {status && <p className="text-xs text-slate-500 mt-2">{status}</p>}
        {error && <p className="text-xs text-red-600 mt-2">Error: {error}</p>}
      </Card>

      {!parsed && !loading && (
        <div className="flex flex-col items-center justify-center text-slate-400 py-16">
          <FileText className="w-12 h-12 mb-2 opacity-30" />
          <p>{fileUrl ? 'Run analysis to parse the drawing.' : 'Select a PDF document to analyze.'}</p>
        </div>
      )}

      {loading && !parsed && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      )}

      {parsed && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">Parsed {items.length} extracted text items.</p>
          {renderSection('Dimensions', parsed.dimensions, mapDimension)}
          {renderSection('Radii', parsed.radii, mapRadius)}
          {renderSection('Diameters', parsed.diameters, mapDiameter)}
          {renderSection('Feature Callouts', parsed.quantities, mapQuantity)}
          {renderSection('Possible Limit Dimensions', parsed.possible_limit_dimensions, mapLimit)}
          {renderSection('Material', parsed.materials, mapMaterial)}
          {renderSection('Finish / Specifications', finishSpec, (e) => (e.label ? mapSpecification(e) : mapFinish(e)))}
          {renderSection('Unclassified OCR Text', parsed.unclassified, mapUnclassified)}
        </div>
      )}
    </div>
  );
}