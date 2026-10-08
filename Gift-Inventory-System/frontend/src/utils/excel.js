/* =====================================================================
   Excel upload, parsing, templates and formatted export (same output as the original app).
   Uses SheetJS (loaded on demand, see utils/vendor.js):
     window.XLSX       SheetJS Community 0.20 — reads .xlsx / .xls / .csv
     window.XLSXStyle  SheetJS with cell styles — writes formatted .xlsx
   Exports have a title, filter line, bold coloured header row, borders,
   number formats, totals row, AutoFilter, frozen header and column widths.
   ===================================================================== */
import { fmt } from './format';
import { saveBlob } from '../services/api';
import ImportRules from './shared/import-rules';
import { ensureVendor } from './vendor';

const NAVY = '0D1626', BRAND = '1F4FD1', LINE = 'D9DEE7', ZEBRA = 'F6F8FB', TOTAL = 'E9EEF7', MUTED = '6B7A90';
const border = { top: { style: 'thin', color: { rgb: LINE } }, bottom: { style: 'thin', color: { rgb: LINE } }, left: { style: 'thin', color: { rgb: LINE } }, right: { style: 'thin', color: { rgb: LINE } } };
const ACCEPT = '.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv';

/* ------------------------------ Reading ------------------------------ */
/** Read the first sheet of an .xlsx / .xls / .csv file → { sheetName, sheetNames, aoa } */
async function readFile(file, sheetName) {
  if (!file) throw new Error('Choose a file');
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error('Please upload an Excel (.xlsx, .xls) or CSV file');
  if (file.size > 15 * 1024 * 1024) throw new Error('The file is too large (max 15 MB)');
  const data = new Uint8Array(await file.arrayBuffer());
  let wb;
  try { wb = window.XLSX.read(data, { type: 'array', cellDates: true, dense: false, codepage: 65001 }); } catch (e) { throw new Error('This file could not be read. Save it as .xlsx and try again.'); }
  const name = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames.find((n) => !/^(instructions|help|readme)$/i.test(n)) || wb.SheetNames[0];
  const ws = wb.Sheets[name];
  const aoa = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false })
    .map((r) => r.map((c) => (c instanceof Date ? isoDate(c) : typeof c === 'string' ? c.trim() : c)));
  return { sheetName: name, sheetNames: wb.SheetNames, aoa };
}
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* ------------------------------ Writing ------------------------------ */
const colLetter = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const textOf = (v) => (v === null || v === undefined ? '' : String(v));
/** Plain display value for a column (dates as local date/time text). */
function cellValue(c, r) {
  const v = typeof c.value === 'function' ? c.value(r) : r[c.key];
  if (v === null || v === undefined || v === '') return c.num ? null : '';
  if (c.date) { const d = fmt.toDate(v); return d && !isNaN(d) ? d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : textOf(v); }
  if (c.num) { const n = Number(v); return Number.isFinite(n) ? n : textOf(v); }
  return textOf(v);
}

/**
 * Build one formatted worksheet.
 * sheet: { title, subtitle, columns: [{ key, label, num, pct, dec, date, value(r) }], rows, totals, note }
 */
function buildSheet(sheet) {
  const XS = window.XLSXStyle;
  const cols = sheet.columns;
  const n = cols.length;
  const aoa = [[sheet.title || ''], [sheet.subtitle || ''], [], cols.map((c) => c.label)];
  for (const r of sheet.rows) aoa.push(cols.map((c) => cellValue(c, r)));
  const hasTotals = sheet.totals && Object.keys(sheet.totals).length && sheet.rows.length;
  if (hasTotals) aoa.push(cols.map((c, i) => (i === 0 ? `Total (${sheet.rows.length} rows)` : sheet.totals[c.key] !== undefined && sheet.totals[c.key] !== null ? Number(sheet.totals[c.key]) : '')));
  if (sheet.note) { aoa.push([]); aoa.push([sheet.note]); }
  const ws = XS.utils.aoa_to_sheet(aoa);
  const H = 3; // header row index (0-based)
  const last = H + sheet.rows.length; // last data row index
  const set = (r, c, s) => { const a = colLetter(c) + (r + 1); if (!ws[a]) ws[a] = { t: 's', v: '' }; ws[a].s = s; };
  // title + subtitle
  set(0, 0, { font: { bold: true, sz: 14, color: { rgb: NAVY } } });
  set(1, 0, { font: { italic: true, sz: 9, color: { rgb: MUTED } } });
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, n - 1) } }, { s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(0, n - 1) } }];
  // header
  cols.forEach((c, i) => set(H, i, { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: NAVY } }, alignment: { horizontal: c.num ? 'right' : 'left', vertical: 'center', wrapText: true }, border }));
  // body
  for (let r = H + 1; r <= last; r++) {
    const zebra = (r - H) % 2 === 0;
    cols.forEach((c, i) => {
      const s = { border, alignment: { horizontal: c.num ? 'right' : 'left', vertical: 'top' } };
      if (zebra) s.fill = { patternType: 'solid', fgColor: { rgb: ZEBRA } };
      if (c.num) s.numFmt = c.pct ? '0.0"%"' : c.dec ? '#,##0.0' : '#,##0';
      set(r, i, s);
    });
  }
  if (hasTotals) cols.forEach((c, i) => set(last + 1, i, { font: { bold: true }, fill: { patternType: 'solid', fgColor: { rgb: TOTAL } }, border: { ...border, top: { style: 'medium', color: { rgb: BRAND } } },
    alignment: { horizontal: c.num ? 'right' : 'left' }, numFmt: c.num ? (c.pct ? '0.0"%"' : c.dec ? '#,##0.0' : '#,##0') : undefined }));
  if (sheet.note) set(last + (hasTotals ? 3 : 2), 0, { font: { italic: true, sz: 9, color: { rgb: MUTED } } });
  // column widths from content
  ws['!cols'] = cols.map((c, i) => {
    let w = textOf(c.label).length + 2;
    for (let r = H + 1; r <= Math.min(last + 1, H + 400); r++) { const cell = ws[colLetter(i) + (r + 1)]; if (cell) w = Math.max(w, textOf(cell.v).length + (c.num ? 3 : 2)); }
    return { wch: Math.min(50, Math.max(c.num ? 9 : 10, w)) };
  });
  ws['!rows'] = [{ hpt: 22 }, { hpt: 14 }, { hpt: 6 }, { hpt: 30 }];
  if (sheet.rows.length) ws['!autofilter'] = { ref: `A${H + 1}:${colLetter(n - 1)}${last + 1}` };
  return { ws, freezeRow: H + 1 };
}

/** Freeze the header rows (SheetJS community cannot write panes, so patch the sheet XML). */
function freeze(out, panes) {
  const X = window.XLSX;
  try {
    const cfb = X.CFB.read(new Uint8Array(out), { type: 'array' });
    panes.forEach((rows, idx) => {
      if (!rows) return;
      const i = cfb.FullPaths.findIndex((p) => p.endsWith(`xl/worksheets/sheet${idx + 1}.xml`));
      if (i < 0) return;
      const f = cfb.FileIndex[i];
      const xml = new TextDecoder().decode(f.content).replace(/<sheetView workbookViewId="0"\/>/,
        `<sheetView workbookViewId="0"><pane ySplit="${rows}" topLeftCell="A${rows + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${rows + 1}" sqref="A${rows + 1}"/></sheetView>`);
      f.content = new TextEncoder().encode(xml); f.size = f.content.length;
    });
    return X.CFB.write(cfb, { fileType: 'zip', type: 'array' });
  } catch (_) { return out; }
}

const safeSheetName = (s, used) => {
  let n = String(s || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Sheet';
  let k = 2; const base = n.slice(0, 28);
  while (used.has(n)) n = `${base} ${k++}`;
  used.add(n);
  return n;
};
/** Save one or more formatted sheets as an .xlsx file. */
function exportWorkbook(sheets, filename) {
  const XS = window.XLSXStyle;
  if (!XS) throw new Error('Excel library not loaded');
  const wb = XS.utils.book_new();
  const used = new Set();
  const panes = [];
  for (const sh of sheets) {
    const { ws, freezeRow } = sh.aoa ? plainSheet(sh) : buildSheet(sh);
    XS.utils.book_append_sheet(wb, ws, safeSheetName(sh.sheetName || sh.title, used));
    panes.push(freezeRow);
  }
  wb.Props = { Title: sheets[0].title, Author: 'Gift Inventory & Shop Sales Management', CreatedDate: new Date() };
  const out = freeze(XS.write(wb, { type: 'array', bookType: 'xlsx', compression: true }), panes);
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return saveBlob(blob, filename.endsWith('.xlsx') ? filename : filename + '.xlsx');
}
/** Export a { columns, rows, totals } report. */
const exportReport = ({ title, subtitle, columns, rows, totals, filename, sheetName, note }) =>
  exportWorkbook([{ title, subtitle: subtitle || `Generated ${new Date().toLocaleString('en-GB')}`, columns, rows, totals, sheetName, note }], filename);

/** A simple sheet from an array of arrays: bold header row + widths (templates, instructions). */
function plainSheet({ aoa, widths, headerRow = 0, header = true }) {
  const XS = window.XLSXStyle;
  const ws = XS.utils.aoa_to_sheet(aoa);
  const n = Math.max(...aoa.map((r) => r.length));
  if (header) for (let i = 0; i < n; i++) {
    const a = colLetter(i) + (headerRow + 1);
    if (ws[a]) ws[a].s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: BRAND } }, border, alignment: { vertical: 'center' } };
  }
  ws['!cols'] = widths ? widths.map((w) => ({ wch: w })) : Array.from({ length: n }, (_, i) => ({ wch: Math.min(60, Math.max(12, ...aoa.map((r) => textOf(r[i]).length + 2))) }));
  return { ws, freezeRow: header ? headerRow + 1 : 0 };
}

/** Download the import template for a type (sheet "Data" + sheet "Instructions"). */
function template(type) {
  const T = ImportRules.TYPES[type];
  const head = T.columns.map((c) => c.label);
  const instructions = [['How to fill this template'], [T.help], [],
    ['Column', 'Required?', 'Notes'],
    ...T.columns.map((c) => [c.label, c.required ? 'Yes' : 'No', NOTES[type] && NOTES[type][c.key] ? NOTES[type][c.key] : '']),
    [], ['Keep the header row exactly as it is. Delete the example row before uploading. Accepted files: .xlsx, .xls, .csv']];
  return exportWorkbook([
    { aoa: [head, ...T.example], sheetName: 'Data' },
    { aoa: instructions, sheetName: 'Instructions', headerRow: 3, widths: [24, 12, 80] },
  ], `${type}-template.xlsx`);
}
const NOTES = {
  shops: { shop_id: 'Your shop code, e.g. PK413451. A new ID creates a new shop; an existing ID updates that shop. Leave blank for an automatic ID (SHP-0008). Blank ID + same shop name and market = update that shop.', promoter: 'Promoter ID (PRM-001), login email, or exact promoter name.', status: 'Active or Inactive (default Active).' },
  brands: { brand_code: 'Leave blank to create an ID like BR002.', status: 'Active or Inactive.' },
  models: { brand_code: 'Existing Brand ID. Or leave blank and give the Brand Name.', brand_name: 'A new brand is created when the name is new.', item_code: 'Unique model / item code, e.g. MOD001 or X6887 256+8.', status: 'Active or Inactive.' },
  gifts: { gift_id: 'Leave blank for a new gift (GFT-005 style ID is created).', total_quantity: 'Warehouse stock. Cannot be less than what is already allocated to shops.' },
  inventory: { shop_id: 'Must already exist.', gift_id: 'Gift ID, or leave blank and give the Gift Name.', quantity: 'Whole number. Taken from the gift warehouse stock.' },
  promoters: { user_code: 'Leave blank for a new promoter. Use an existing ID to update.', email: 'Login email. Must be unique.', password: 'Only for new promoters. At least 8 characters with letters and numbers. Default Promoter@123. Existing passwords are fixed.' },
};

/** Download the validation result as an error report. */
function errorReport(result, fileName) {
  const T = ImportRules.TYPES[result.type];
  const rows = result.rows.filter((r) => r.status !== 'ok').map((r) => ({
    __line: r.line, __type: r.status === 'error' ? 'Error' : 'Warning',
    __msg: r.messages.filter((m) => m.level !== 'info').map((m) => m.text).join(' | '),
    ...Object.fromEntries(T.columns.map((c) => [c.key, r.input ? r.input[c.key] : ''])),
  }));
  return exportReport({
    title: `${T.title} import — error report`, subtitle: `${fileName || ''} · Total ${result.total} · Valid ${result.valid} · Warnings ${result.warnings} · Errors ${result.errors}`,
    columns: [{ key: '__line', label: 'Row', num: true }, { key: '__type', label: 'Type' }, { key: '__msg', label: 'Problem' }, ...T.columns.map((c) => ({ key: c.key, label: c.label }))],
    rows, filename: `${result.type}-import-errors.xlsx`, sheetName: 'Errors',
  });
}


const ready = () => ensureVendor('xlsx');
export { ACCEPT, colLetter };
export async function readFileX(file, sheetName) { await ready(); return readFile(file, sheetName); }
export async function exportReportX(o) { await ready(); return exportReport(o); }
export async function exportWorkbookX(sheets, filename) { await ready(); return exportWorkbook(sheets, filename); }
export async function templateX(type) { await ready(); return template(type); }
export async function errorReportX(result, fileName) { await ready(); return errorReport(result, fileName); }

/** Excel.readFile(file), Excel.exportReport({...}), Excel.exportWorkbook(sheets, name), Excel.template(type), Excel.errorReport(result, name) */
const Excel = { ACCEPT, colLetter, readFile: readFileX, exportReport: exportReportX, exportWorkbook: exportWorkbookX, template: templateX, errorReport: errorReportX };
export default Excel;
