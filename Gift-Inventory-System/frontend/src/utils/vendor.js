/* =====================================================================
   Large browser libraries are loaded only when a screen needs them
   (files in /public/vendor, the same versions as the original app):
     chart → Chart.js 4      pdf → jsPDF + AutoTable
     xlsx  → SheetJS (reading) + SheetJS with styles (formatted exports)
     jsqr  → jsQR (QR code scanning on the promoter app)
   ===================================================================== */
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
const LIBS = {
  chart: ['vendor/chart.umd.min.js'],
  pdf: ['vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js'],
  // order matters: the styled build first (saved as window.XLSXStyle), then the reader as window.XLSX
  xlsx: ['vendor/xlsx-style.min.js', 'vendor/xlsx-alias.js', 'vendor/xlsx.core.min.js'],
  jsqr: ['vendor/jsQR.js'],
};
const loaded = new Map();

function script(src) {
  if (loaded.has(src)) return loaded.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = BASE + src; s.async = false;
    s.onload = () => resolve();
    s.onerror = () => { loaded.delete(src); reject(new Error('Could not load ' + src + '. Check your internet connection and reload the page.')); };
    document.head.appendChild(s);
  });
  loaded.set(src, p);
  return p;
}

let chartDefaults = false;
function setChartDefaults() {
  if (chartDefaults || !window.Chart) return;
  chartDefaults = true;
  const C = window.Chart;
  C.defaults.font.family = getComputedStyle(document.body).fontFamily;
  C.defaults.font.size = 12;
  C.defaults.color = '#6b7a90';
  C.defaults.borderColor = '#edf0f5';
  C.defaults.plugins.legend.labels.boxWidth = 10;
  C.defaults.plugins.legend.labels.boxHeight = 10;
  C.defaults.plugins.tooltip.backgroundColor = '#0f1a2b';
  C.defaults.plugins.tooltip.padding = 10;
  C.defaults.maintainAspectRatio = false;
}

/** await ensureVendor('chart', 'pdf') */
export async function ensureVendor(...names) {
  for (const n of names) for (const f of LIBS[n] || []) await script(f); // in order
  if (names.includes('chart')) setChartDefaults();
}
export const vendorReady = (name) => (name === 'chart' ? !!window.Chart : name === 'pdf' ? !!(window.jspdf && window.jspdf.jsPDF) : name === 'xlsx' ? !!(window.XLSX && window.XLSXStyle) : name === 'jsqr' ? !!window.jsQR : false);
