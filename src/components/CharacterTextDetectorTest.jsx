import React, { useEffect, useRef, useState } from 'react';
import { Loader2, ChevronDown, ChevronRight, ScanText } from 'lucide-react';
import { loadPdf, renderPageToCanvas, HIGH_OCR_SCALE } from '@/lib/pdfOcrService';
import { detectTextRegions } from '@/lib/textRegionDetection';
import { detectCharacterTextRegions, cropRegionFromSource } from '@/lib/characterTextDetector';

const MAX_CANVAS_DIM = 4000;
const PREVIEW_W = 760;
const MAX_CROP_PREVIEWS = 24;

/**
 * Character-Based Engineering Text Detector (diagnostic). Runs the new
 * character-first detector AND the legacy detector on the same drawing so their
 * regions can be compared. Overlay layers can be toggled independently:
 *   - individual character candidates
 *   - grouped character candidates (assembled text lines)
 *   - final probable text-line regions (bbox + char-height padding)
 * A detector selector switches between Legacy Region Detector and
 * Character-Based Detector. No OCR / interpretation is performed here.
 */
export default function CharacterTextDetectorTest({ url }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [status, setStatus] = useState('');
  const [pages, setPages] = useState([]);
  const [detector, setDetector] = useState('character'); // 'character' | 'legacy'
  const [showCharacters, setShowCharacters] = useState(true);
  const [showGroups, setShowGroups] = useState(true);
  const [showRegions, setShowRegions] = useState(true);
  const sourceRefs = useRef(new Map());

  useEffect(() => {
    if (!url || !open) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(false);
      setLoadError(null);
      setPages([]);
      sourceRefs.current = new Map();
      setStatus('Loading PDF…');
      try {
        const pdf = await loadPdf(url);
        if (cancelled) return;
        const entries = [];
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          if (cancelled) return;
          const baseVp = page.getViewport({ scale: 1 });
          const maxDim = Math.max(baseVp.width, baseVp.height);
          const scale = Math.min(HIGH_OCR_SCALE, MAX_CANVAS_DIM / maxDim);
          setStatus(`Rendering page ${p} at ×${scale.toFixed(2)}`);
          const { canvas } = await renderPageToCanvas(page, scale);
          if (cancelled) return;
          sourceRefs.current.set(p, canvas);

          setStatus(`Detecting (legacy + character) page ${p}`);
          const legacy = detectTextRegions(canvas);
          const character = detectCharacterTextRegions(canvas);
          if (cancelled) return;

          // Downscaled page image for the overlay backdrop.
          const ds = Math.min(1, PREVIEW_W / canvas.width);
          const thumb = document.createElement('canvas');
          thumb.width = Math.max(1, Math.round(canvas.width * ds));
          thumb.height = Math.max(1, Math.round(canvas.height * ds));
          thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);

          // Crop previews (from the original high-res render) for each detector.
          const legacyCrops = legacy.regions.slice(0, MAX_CROP_PREVIEWS).map((r) =>
            cropRegionFromSource(canvas, r).canvas.toDataURL()
          );
          const charCrops = character.regions.slice(0, MAX_CROP_PREVIEWS).map((r) =>
            cropRegionFromSource(canvas, r).canvas.toDataURL()
          );

          entries.push({
            pageNum: p,
            img: thumb.toDataURL(),
            sourceW: canvas.width,
            sourceH: canvas.height,
            legacy: {
              regions: legacy.regions,
              components: legacy.components,
              stats: legacy.stats,
              crops: legacyCrops,
            },
            character: {
              components: character.components,
              groups: character.groups,
              regions: character.regions,
              sizeClasses: character.sizeClasses,
              stats: character.stats,
              crops: charCrops,
            },
          });
          setPages([...entries]);
        }
        setStatus('Detection complete');
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
    return () => { cancelled = true; };
  }, [url, open]);

  const charActive = detector === 'character';

  return (
    <div className="border border-slate-200 rounded-lg mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 rounded-t-lg hover:bg-slate-100 transition"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Character-Based Engineering Text Detector
          <span className="text-xs text-slate-400 font-normal">Experimental · legacy comparison (dev/test)</span>
        </span>
        {loading && status && (
          <span className="flex items-center gap-1 text-xs text-slate-500 max-w-[60%] truncate">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> <span className="truncate">{status}</span>
          </span>
        )}
      </button>

      {open && (
        <div className="p-4 space-y-4">
          {loading && pages.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> {status || 'Preparing…'}
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center justify-center py-8 text-slate-500">
              <ScanText className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm">Character-based detector failed.</p>
              <p className="text-xs text-slate-400">{loadError}</p>
            </div>
          )}

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
              <DetBtn active={detector === 'legacy'} onClick={() => setDetector('legacy')}>Legacy Region Detector</DetBtn>
              <DetBtn active={detector === 'character'} onClick={() => setDetector('character')}>Character-Based Detector</DetBtn>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <Toggle checked={showCharacters} onChange={setShowCharacters} color="#22c55e">Character candidates</Toggle>
              <Toggle checked={showGroups} onChange={setShowGroups} color="#f59e0b">Grouped lines</Toggle>
              <Toggle checked={showRegions} onChange={setShowRegions} color="#2563eb">Final regions</Toggle>
            </div>
          </div>

          {pages.map((pg) => {
            const data = charActive ? pg.character : pg.legacy;
            const stats = data.stats;
            return (
              <div key={pg.pageNum} className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 flex items-center justify-between flex-wrap gap-2">
                  <span>Page {pg.pageNum} — {charActive ? 'Character-Based' : 'Legacy'} Detector</span>
                  <span className="text-slate-400 font-normal">
                    {charActive
                      ? `${stats.charCandidates} candidates · ${stats.groups} lines (H ${stats.horizontalLines}/V ${stats.verticalLines}) · ${stats.regions} regions · ${stats.sizeClasses} size classes`
                      : `${stats.charComponents} components · ${stats.regions} regions · charH ${stats.medianCharH}`}
                  </span>
                </div>

                <div className="p-3 space-y-3">
                  <Overlay
                    img={pg.img}
                    sourceW={pg.sourceW}
                    sourceH={pg.sourceH}
                    data={data}
                    charActive={charActive}
                    showCharacters={showCharacters}
                    showGroups={showGroups}
                    showRegions={showRegions}
                  />

                  {charActive && data.sizeClasses.length > 0 && (
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      <span className="text-slate-400">Size classes (char height px):</span>
                      {data.sizeClasses.map((sc, i) => (
                        <span key={i} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
                          {sc.ref}px ×{sc.count}
                        </span>
                      ))}
                    </div>
                  )}

                  <div>
                    <div className="text-[11px] font-semibold text-slate-600 mb-1">
                      Final region crop previews (from original high-res render) — {data.regions.length} region(s)
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-72 overflow-y-auto">
                      {data.crops.length === 0 && (
                        <p className="text-xs text-slate-400 col-span-full">No regions.</p>
                      )}
                      {data.crops.map((c, i) => {
                        const r = data.regions[i];
                        return (
                          <div key={i} className="rounded border border-slate-200 overflow-hidden bg-white">
                            <img src={c} alt={`region ${i + 1}`} className="w-full max-h-20 object-contain" />
                            <div className="px-1.5 py-1 text-[10px] text-slate-500 font-mono">
                              #{i + 1} {charActive && r?.orientation ? `· ${r.orientation[0].toUpperCase()}` : ''} · {r ? `${Math.round(r.w)}×${Math.round(r.h)}` : ''}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {!loading && !error && pages.length === 0 && (
            <p className="text-sm text-slate-500">No pages processed.</p>
          )}

          {!loading && !error && (
            <p className="text-[11px] text-slate-400">
              The character-based detector keeps permissive character candidates, estimates multiple text-size classes, assembles horizontal then vertical text lines, and computes the region bbox only after the line is complete (with char-height padding). Toggle layers to verify: (1) characters detected, (2) correctly grouped, (3) the final region completely encloses the dimension. Compare against the legacy detector — production OCR is unchanged.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Overlay({ img, sourceW, sourceH, data, charActive, showCharacters, showGroups, showRegions }) {
  const stroke = Math.max(1.5, sourceW / 600);
  return (
    <div className="relative w-full">
      <img src={img} alt="page" className="w-full rounded border border-slate-200" />
      <svg viewBox={`0 0 ${sourceW} ${sourceH}`} className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid meet">
        {/* Character candidates */}
        {showCharacters && (
          <g>
            {data.components.map((c, i) => (
              <rect key={`c${i}`} x={c.x} y={c.y} width={c.w} height={c.h}
                fill="rgba(34,197,94,0.08)" stroke="#22c55e" strokeWidth={stroke} />
            ))}
          </g>
        )}
        {/* Grouped lines (character-based only) */}
        {charActive && showGroups && (
          <g>
            {data.groups.map((g, i) => (
              <rect key={`g${i}`} x={g.bbox.x} y={g.bbox.y} width={g.bbox.w} height={g.bbox.h}
                fill="none" stroke="#f59e0b" strokeWidth={stroke * 1.3}
                strokeDasharray={`${stroke * 3} ${stroke * 2}`} />
            ))}
          </g>
        )}
        {/* Final regions */}
        {showRegions && (
          <g>
            {data.regions.map((r, i) => (
              <rect key={`r${i}`} x={r.x} y={r.y} width={r.w} height={r.h}
                fill="rgba(37,99,235,0.07)" stroke={charActive ? '#2563eb' : '#ef4444'} strokeWidth={stroke * 1.6} />
            ))}
          </g>
        )}
      </svg>
      <div className="absolute top-2 left-2 flex flex-col gap-1 text-[10px] font-medium">
        {showCharacters && <Legend color="#22c55e">Characters</Legend>}
        {charActive && showGroups && <Legend color="#f59e0b">Groups</Legend>}
        {showRegions && <Legend color={charActive ? '#2563eb' : '#ef4444'}>Regions</Legend>}
      </div>
    </div>
  );
}

function Legend({ color, children }) {
  return (
    <span className="inline-flex items-center gap-1 bg-white/85 rounded px-1.5 py-0.5 shadow-sm">
      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
      {children}
    </span>
  );
}

function DetBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium transition ${active ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
    >
      {children}
    </button>
  );
}

function Toggle({ checked, onChange, color, children }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border transition ${checked ? 'border-slate-300 bg-slate-100 text-slate-700' : 'border-slate-200 bg-white text-slate-400'}`}
    >
      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: checked ? color : 'transparent', border: `1.5px solid ${color}` }} />
      {children}
    </button>
  );
}