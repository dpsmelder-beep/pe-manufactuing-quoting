// Pure formatting helpers for the Drawing Analysis section. Each mapper turns
// a parsed engineering-drawing entry (from src/lib/engineeringDrawingParser)
// into a uniform { primary, tags } shape for display. OCR metadata
// (original_text, raw text, source, confidence, page, bbox) is attached to the
// entry itself and surfaced by the expandable ItemRow.

const unitSuffix = (u) => (u ? ` ${u}` : '');

export function formatTolerance(e) {
  switch (e.tolerance_type) {
    case 'bilateral':
      return `±${e.plus_tolerance ?? 0}`;
    case 'unilateral':
      return `+${e.plus_tolerance ?? 0} / -${e.minus_tolerance ?? 0}`;
    case 'limit':
      return `${e.upper ?? '—'} / ${e.lower ?? '—'}`;
    case 'none':
      return '—';
    default:
      return e.tolerance_type || '—';
  }
}

export function mapDimension(e) {
  return {
    primary: `${e.nominal ?? '—'}${unitSuffix(e.unit)}`,
    tags: [
      { label: 'Tolerance', value: formatTolerance(e) },
      { label: 'Type', value: e.type || '—' },
    ],
  };
}

export function mapRadius(e) {
  return {
    primary: `${e.value ?? '—'}${unitSuffix(e.unit)}`,
    tags: [
      { label: 'Type', value: e.type || '—' },
      { label: 'Condition', value: e.condition || '—' },
    ],
  };
}

export function mapDiameter(e) {
  const tags = [
    { label: 'Tolerance', value: formatTolerance(e) },
    { label: 'Type', value: e.type || '—' },
  ];
  if (e.ocr_substitution) tags.push({ label: 'OCR', value: e.ocr_substitution });
  return {
    primary: `Ø${e.nominal ?? '—'}${unitSuffix(e.unit)}`,
    tags,
  };
}

export function mapQuantity(e) {
  if (e.type === 'feature_callout') {
    const tags = [
      { label: 'Feature', value: e.feature || '—' },
      { label: 'Size', value: e.size != null ? `${e.size}${unitSuffix(e.unit)}` : '—' },
      { label: 'Angle', value: e.angle != null ? `${e.angle}°` : '—' },
    ];
    if (e.remainder) tags.push({ label: 'Remainder', value: e.remainder });
    return { primary: `${e.quantity}X`, tags };
  }
  return {
    primary: `${e.value ?? '—'} ${e.unit || 'pcs'}`,
    tags: [{ label: 'Type', value: e.type || 'quantity' }],
  };
}

export function mapLimit(e) {
  return {
    primary: `${e.upper_limit ?? '—'} / ${e.lower_limit ?? '—'}${unitSuffix(e.unit)}`,
    tags: [
      { label: 'Status', value: e.status || '—' },
      { label: 'Members', value: (e.members || []).join(' / ') || '—' },
    ],
  };
}

export function mapMaterial(e) {
  return { primary: e.value || '—', tags: [{ label: 'Type', value: e.type || '—' }] };
}

export function mapFinish(e) {
  return { primary: e.value || '—', tags: [{ label: 'Type', value: e.type || '—' }] };
}

export function mapSpecification(e) {
  return {
    primary: e.value || '—',
    tags: [
      { label: 'Label', value: e.label || '—' },
      { label: 'Type', value: e.type || '—' },
    ],
  };
}

export function mapThread(e) {
  let thread;
  if (e.thread_system === 'metric') {
    thread = `M${e.nominal}${e.pitch != null ? ` x ${e.pitch}` : ''}`;
  } else {
    thread = `${e.nominal}-${e.threads_per_inch}${e.series ? ` ${e.series}` : ''}`;
  }
  return {
    primary: thread,
    tags: [
      { label: 'Quantity', value: e.quantity != null ? e.quantity : '—' },
      { label: 'Series', value: e.series || '—' },
      { label: 'Class', value: e.class || '—' },
      { label: 'Depth Type', value: e.depth_type || '—' },
      { label: 'Depth', value: e.depth != null ? e.depth : '—' },
    ],
  };
}

export function mapUnclassified(e) {
  return {
    primary: e.spec || e.original_text || e.text || '—',
    tags: [{ label: 'Type', value: e.type || '—' }],
  };
}