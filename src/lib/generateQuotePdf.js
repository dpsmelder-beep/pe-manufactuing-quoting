import { jsPDF } from 'jspdf';

// Builds a clean, text-based PDF quote and triggers a browser save dialog.
export function generateQuotePdf(quote) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 48;
  let y = margin;

  // ---- Header / Brand ----
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 77, 97); // #004D61
  doc.setFontSize(22);
  doc.text('PE MANUFACTURING', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  y += 14;
  doc.text('Quotation', margin, y);

  // Quote number / date on the right
  const today = new Date().toLocaleDateString();
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  doc.text(`Quote #: ${quote.quote_number || '-'}`, pageW - margin, y, { align: 'right' });
  y += 14;
  doc.text(`Date: ${today}`, pageW - margin, y, { align: 'right' });
  y += 24;

  doc.setDrawColor(0, 77, 97);
  doc.setLineWidth(2);
  doc.line(margin, y, pageW - margin, y);
  y += 20;

  // ---- Bill To ----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0, 77, 97);
  doc.text('BILL TO', margin, y);
  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  const billLines = [
    quote.customer_name || '',
    quote.customer_contact || '',
    quote.customer_email || '',
  ].filter(Boolean);
  billLines.forEach((line) => {
    doc.text(line, margin, y);
    y += 13;
  });

  // RFQ + rep on the right
  let rightY = y - billLines.length * 13;
  if (quote.customer_rfq_number) {
    doc.text(`Customer RFQ #: ${quote.customer_rfq_number}`, pageW - margin, rightY, { align: 'right' });
    rightY += 13;
  }
  if (quote.sales_rep_name) {
    doc.text(`Sales Rep: ${quote.sales_rep_name}`, pageW - margin, rightY, { align: 'right' });
  }
  y += 10;

  // ---- Line Items Table ----
  y += 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0, 77, 97);
  doc.text('LINE ITEMS', margin, y);
  y += 16;

  const tableX = margin;
  const tableW = pageW - margin * 2;
  const cols = [0.35, 0.15, 0.2, 0.3]; // part_number, qty, price, notes
  const colX = cols.map((c, i) =>
    tableX + cols.slice(0, i).reduce((s, v) => s + v, 0) * tableW
  );

  // header row
  doc.setFillColor(0, 77, 97);
  doc.rect(tableX, y, tableW, 20, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text('PART NUMBER', colX[0] + 6, y + 13);
  doc.text('QTY', colX[1] + 6, y + 13);
  doc.text('PRICE', colX[2] + 6, y + 13);
  doc.text('NOTES', colX[3] + 6, y + 13);
  y += 20;

  const items = quote.line_items || [];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(40, 40, 40);
  if (!items.length) {
    doc.text('No line items', tableX + 6, y + 13);
    y += 20;
  } else {
    items.forEach((it, idx) => {
      if (idx % 2 === 0) {
        doc.setFillColor(245, 247, 248);
        doc.rect(tableX, y, tableW, 22, 'F');
      }
      doc.text(String(it.part_number || ''), colX[0] + 6, y + 14);
      doc.text(String(it.quantity ?? ''), colX[1] + 6, y + 14);
      doc.text(it.price != null ? `$${Number(it.price).toFixed(2)}` : '', colX[2] + 6, y + 14);
      const noteLines = doc.splitTextToSize(it.notes || '', cols[3] * tableW - 12);
      doc.text(noteLines.slice(0, 2), colX[3] + 6, y + 14);
      y += 22;
      if (y > doc.internal.pageSize.getHeight() - 120) {
        doc.addPage();
        y = margin;
      }
    });
  }

  // ---- Totals ----
  y += 10;
  const subtotal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.price) || 0), 0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  doc.text('Subtotal:', pageW - margin - 140, y);
  doc.text(`$${subtotal.toFixed(2)}`, pageW - margin, y, { align: 'right' });
  y += 16;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(0, 77, 97);
  doc.text('TOTAL:', pageW - margin - 140, y);
  doc.text(`$${(quote.total ?? subtotal).toFixed(2)}`, pageW - margin, y, { align: 'right' });
  y += 24;

  // ---- Sales Terms ----
  if (quote.sales_terms) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 77, 97);
    doc.text('TERMS', margin, y);
    y += 13;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    const termsLines = doc.splitTextToSize(quote.sales_terms, tableW);
    doc.text(termsLines, margin, y);
    y += termsLines.length * 12 + 8;
  }

  // ---- Notes ----
  if (quote.notes) {
    if (y > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); y = margin; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 77, 97);
    doc.text('NOTES', margin, y);
    y += 13;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    const noteLines = doc.splitTextToSize(quote.notes, tableW);
    doc.text(noteLines, margin, y);
  }

  // ---- Footer ----
  const pageH = doc.internal.pageSize.getHeight();
  doc.setDrawColor(0, 77, 97);
  doc.setLineWidth(1);
  doc.line(margin, pageH - 56, pageW - margin, pageH - 56);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text('PE Manufacturing  |  This quotation is valid for 30 days unless otherwise noted.', margin, pageH - 40);

  const safeName = (quote.quote_number || 'quote').replace(/[^a-z0-9_-]/gi, '_');
  doc.save(`${safeName}.pdf`);
}