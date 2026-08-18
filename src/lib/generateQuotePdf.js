import { jsPDF } from 'jspdf';

const LOGO_URL = 'https://media.base44.com/images/public/6a8369086a548f4cfcb1ce33/59a6c82a8_Asset202211.png';
const PRIMARY = [0, 77, 97];      // #004D61
const ACCENT  = [91, 209, 215];   // #5BD1D7

async function loadImageAsDataUrl(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

export async function generateQuotePdf(quote) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  let y = margin;

  // ---- Load logo ----
  let logoDataUrl = null;
  try { logoDataUrl = await loadImageAsDataUrl(LOGO_URL); } catch { /* skip */ }

  // ---- Header: logo + brand text ----
  const logoSize = 48;
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, 'PNG', margin, y - 6, logoSize, logoSize);
  }
  const textX = margin + (logoDataUrl ? logoSize + 10 : 0);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...PRIMARY);
  doc.text('PE MANUFACTURING', textX, y + 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(100, 100, 100);
  doc.text('QUOTATION', textX, y + 34);

  // Quote # / date on the right
  const today = new Date().toLocaleDateString();
  doc.setFontSize(12);
  doc.setTextColor(40, 40, 40);
  doc.text(`Quote #: ${quote.quote_number || '-'}`, pageW - margin, y + 10, { align: 'right' });
  doc.text(`Date: ${today}`, pageW - margin, y + 26, { align: 'right' });

  y += logoSize + 16;

  // Divider
  doc.setDrawColor(...PRIMARY);
  doc.setLineWidth(2);
  doc.line(margin, y, pageW - margin, y);
  y += 20;

  // ---- Customer info block (no "BILL TO" label) ----
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(40, 40, 40);
  const billLines = [
    quote.customer_name,
    quote.customer_contact,
    quote.customer_email,
  ].filter(Boolean);
  billLines.forEach((line) => { doc.text(line, margin, y); y += 16; });

  // RFQ + rep on the right (aligned to same block)
  let rightY = y - billLines.length * 16;
  if (quote.customer_rfq_number) {
    doc.text(`Customer RFQ #: ${quote.customer_rfq_number}`, pageW - margin, rightY, { align: 'right' });
    rightY += 16;
  }
  if (quote.sales_rep_name) {
    doc.text(`Sales Rep: ${quote.sales_rep_name}`, pageW - margin, rightY, { align: 'right' });
  }
  y += 16;

  // ---- Line Items Table (no "LINE ITEMS" heading) ----
  const tableX = margin;
  const tableW = pageW - margin * 2;
  // cols: part_number, qty, unit price, line total, notes
  const colPct = [0.28, 0.10, 0.16, 0.16, 0.30];
  const colX = colPct.map((_, i) =>
    tableX + colPct.slice(0, i).reduce((s, v) => s + v, 0) * tableW
  );

  // Header row
  doc.setFillColor(...PRIMARY);
  doc.rect(tableX, y, tableW, 22, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text('PART NUMBER', colX[0] + 6, y + 15);
  doc.text('QTY',         colX[1] + 6, y + 15);
  doc.text('UNIT PRICE',  colX[2] + 6, y + 15);
  doc.text('LINE TOTAL',  colX[3] + 6, y + 15);
  doc.text('NOTES',       colX[4] + 6, y + 15);
  y += 22;

  const items = quote.line_items || [];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(40, 40, 40);

  if (!items.length) {
    doc.text('No line items', tableX + 6, y + 15);
    y += 24;
  } else {
    items.forEach((it, idx) => {
      const rowH = 24;
      if (idx % 2 === 0) {
        doc.setFillColor(245, 247, 248);
        doc.rect(tableX, y, tableW, rowH, 'F');
      }
      const qty   = Number(it.quantity) || 0;
      const price = Number(it.price)    || 0;
      const lineTotal = qty * price;
      const noteLines = doc.splitTextToSize(it.notes || '', colPct[4] * tableW - 12);

      doc.setTextColor(40, 40, 40);
      doc.text(String(it.part_number || ''), colX[0] + 6, y + 16);
      doc.text(String(qty || ''),            colX[1] + 6, y + 16);
      doc.text(price ? `$${price.toFixed(2)}` : '', colX[2] + 6, y + 16);
      doc.text(lineTotal ? `$${lineTotal.toFixed(2)}` : '', colX[3] + 6, y + 16);
      doc.text(noteLines.slice(0, 2),        colX[4] + 6, y + 16);
      y += rowH;

      if (y > pageH - 120) { doc.addPage(); y = margin; }
    });
  }

  // ---- Grand Total ----
  y += 8;
  const grandTotal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.price) || 0), 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...PRIMARY);
  doc.text('TOTAL:', pageW - margin - 150, y);
  doc.text(`$${grandTotal.toFixed(2)}`, pageW - margin, y, { align: 'right' });
  y += 24;

  // ---- Sales Terms ----
  if (quote.sales_terms) {
    if (y > pageH - 100) { doc.addPage(); y = margin; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...PRIMARY);
    doc.text('TERMS', margin, y);
    y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setTextColor(60, 60, 60);
    const tLines = doc.splitTextToSize(quote.sales_terms, tableW);
    doc.text(tLines, margin, y);
    y += tLines.length * 14 + 8;
  }

  // ---- Notes ----
  if (quote.notes) {
    if (y > pageH - 100) { doc.addPage(); y = margin; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...PRIMARY);
    doc.text('NOTES', margin, y);
    y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setTextColor(60, 60, 60);
    const nLines = doc.splitTextToSize(quote.notes, tableW);
    doc.text(nLines, margin, y);
  }

  // ---- Footer ----
  doc.setDrawColor(...PRIMARY);
  doc.setLineWidth(1);
  doc.line(margin, pageH - 56, pageW - margin, pageH - 56);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(120, 120, 120);
  doc.text('PE Manufacturing  |  This quotation is valid for 30 days unless otherwise noted.', margin, pageH - 38);

  const safeName = (quote.quote_number || 'quote').replace(/[^a-z0-9_-]/gi, '_');
  doc.save(`${safeName}.pdf`);
}