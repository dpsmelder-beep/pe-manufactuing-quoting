import { base44 } from '@/api/base44Client';

// Format: MMDDYYYY-REPINIT-CUSKEY-SEQ
// REPINIT: first+last name initials of logged-in user (uppercase), fallback 'XX'
// CUSKEY:  first 3 alphanumeric chars of account name uppercased, padded/truncated to 3
// SEQ:     zero-padded 3-digit sequence, max+1 among existing quotes sharing the same
//          date+rep+customer prefix for today, starting at 001

export function formatDateCode(date = new Date()) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return `${mm}${dd}${yyyy}`;
}

export function getInitialsFromName(fullName) {
  if (!fullName) return 'XX';
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'XX';
  if (parts.length === 1) return (parts[0][0] || 'X').toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function getCustomerKey(name) {
  if (!name) return 'CUS';
  const letters = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (letters + 'CUS').slice(0, 3);
}

export async function getRepInitials() {
  try {
    const user = await base44.auth.me();
    return getInitialsFromName(user?.full_name || user?.name);
  } catch {
    return 'XX';
  }
}

export async function generateQuoteNumber(customerName) {
  const dateCode = formatDateCode();
  const repInit = await getRepInitials();
  const cusKey = getCustomerKey(customerName);
  const prefix = `${dateCode}-${repInit}-${cusKey}`;

  let seq = 1;
  try {
    const existing = await base44.entities.Quote.filter({
      quote_number: { $regex: `^${prefix}-` },
    });
    const seqs = (existing || [])
      .map((q) => {
        const m = (q.quote_number || '').match(/-(\d{3})$/);
        return m ? parseInt(m[1], 10) : 0;
      })
      .filter((n) => !Number.isNaN(n));
    if (seqs.length) seq = Math.max(...seqs) + 1;
  } catch {
    // ignore — start at 001
  }

  const seqStr = String(seq).padStart(3, '0');
  return `${prefix}-${seqStr}`;
}