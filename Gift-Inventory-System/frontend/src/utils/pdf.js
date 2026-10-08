/* Export { columns, rows, totals } as a PDF table (jsPDF + AutoTable, loaded on demand). */
import { fmt, nf } from './format';
import { saveBlob } from '../services/api';
import { ensureVendor } from './vendor';

export async function exportPdf({ title, subtitle, columns, rows, totals, filename }) {
  await ensureVendor('pdf');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(15, 26, 43);
  doc.text(title, 40, 44);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(107, 122, 144);
  doc.text(subtitle || '', 40, 60);
  doc.text(`Generated ${new Date().toLocaleString('en-GB')}`, W - 40, 44, { align: 'right' });
  const cell = (c, r) => {
    const v = r[c.key];
    if (c.date) return v ? fmt.dt(v) : '—';
    if (c.num) return v === null || v === undefined ? '—' : (c.pct || c.key.includes('rate') || c.key.includes('utilisation') ? `${Number(v).toFixed(1)}%` : nf.format(v));
    return v === null || v === undefined ? '' : String(v);
  };
  const foot = totals && Object.keys(totals).length
    ? [columns.map((c, i) => ({ content: i === 0 ? 'Total' : totals[c.key] !== undefined && totals[c.key] !== null ? (c.pct ? `${Number(totals[c.key]).toFixed(1)}%` : nf.format(totals[c.key])) : '', styles: { halign: c.num ? 'right' : 'left' } }))] : undefined;
  doc.autoTable({
    startY: 74,
    head: [columns.map((c) => c.label)],
    body: rows.map((r) => columns.map((c) => cell(c, r))),
    foot,
    styles: { fontSize: 8, cellPadding: 4, lineColor: [227, 232, 239], lineWidth: 0.5, textColor: [15, 26, 43] },
    headStyles: { fillColor: [13, 22, 38], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [241, 244, 248], textColor: [15, 26, 43], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 251, 253] },
    columnStyles: Object.fromEntries(columns.map((c, i) => [i, c.num ? { halign: 'right' } : {}])),
    margin: { left: 40, right: 40 },
    didDrawPage: () => {
      const h = doc.internal.pageSize.getHeight();
      doc.setFontSize(8); doc.setTextColor(150);
      doc.text(`Page ${doc.internal.getNumberOfPages()}`, W - 40, h - 20, { align: 'right' });
      doc.text('Gift Inventory & Shop Sales Management System', 40, h - 20);
    },
  });
  return saveBlob(doc.output('blob'), filename || 'report.pdf');
}
