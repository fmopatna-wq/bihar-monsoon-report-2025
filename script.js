/* script.js - Shared utilities for all pages */

const DATA_PATH = 'data/'; // relative path to CSVs
const MONTH_FILES = {
  june: 'june.csv',
  july: 'july.csv',
  august: 'august.csv',
  september: 'september.csv',
  overall_monsoon: 'overall_monsoon.csv'
};

/* ---------- CSV Fetch & Parse (simple) ---------- */
async function fetchCSV(filename) {
  const url = `${DATA_PATH}${filename}?t=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('CSV load failed: ' + url);
  const text = await res.text();
  return parseCSV(text);
}

function parseCSV(text){
  // Removes BOM, CR, trailing lines
  text = text.replace(/^\uFEFF/, '').replace(/\r/g, '');
  const lines = text.split('\n').map(l=>l.trim()).filter(l=>l !== '');
  if(lines.length === 0) return { headers:[], data:[] };
  const headers = lines[0].split(',').map(h=>h.trim());
  const data = lines.slice(1).map(line => {
    const cols = line.split(',').map(c=>c.trim());
    const obj = {};
    headers.forEach((h,i) => obj[h] = cols[i] !== undefined ? cols[i] : '');
    return obj;
  });
  return { headers, data };
}

/* ---------- Utilities ---------- */
function toNumberSafe(v){ const n = parseFloat(String(v).replace(/[^0-9\.\-]/g,'')); return isNaN(n)?0:n; }
function formatNum(n){ return Number.isFinite(n) ? n.toLocaleString('en-IN') : n; }

/* ---------- Table rendering & features ---------- */
class DistrictTable {
  constructor(opts){
    this.container = opts.container; // tbody element
    this.headers = opts.headers;
    this.rawData = opts.data; // array of objects
    this.perPage = opts.perPage || 15;
    this.page = 1;
    this.filtered = [...this.rawData];
    this.sortKey = null;
    this.sortDir = -1; // -1 desc, 1 asc
  }

  renderPage(){
    const start = (this.page-1)*this.perPage;
    const chunk = this.filtered.slice(start, start+this.perPage);
    const rowsHtml = chunk.map(row => {
      // assuming headers include District & metrics; adjust label keys when creating table
      const cells = this.headers.map(h => {
        const v = row[h] !== undefined ? row[h] : '';
        return `<td>${escapeHtml(v)}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    this.container.innerHTML = rowsHtml || `<tr><td colspan="${this.headers.length}">कोई रिकॉर्ड नहीं मिला</td></tr>`;
  }

  filter(q){
    if(!q) this.filtered = [...this.rawData];
    else {
      const s = q.toLowerCase();
      this.filtered = this.rawData.filter(r => {
        return this.headers.some(h => (r[h]||'').toString().toLowerCase().includes(s));
      });
    }
    this.page = 1;
    this.renderPage();
  }

  sortBy(key){
    if(this.sortKey === key) this.sortDir = -this.sortDir;
    else { this.sortKey = key; this.sortDir = -1; }
    this.filtered.sort((a,b)=>{
      const A = toNumberSafe(a[key]) || 0;
      const B = toNumberSafe(b[key]) || 0;
      return (A - B) * this.sortDir;
    });
    this.renderPage();
  }

  goToPage(p){
    const max = Math.ceil(this.filtered.length/this.perPage) || 1;
    this.page = Math.min(max, Math.max(1, p));
    this.renderPage();
  }

  exportCSV(filename='export.csv'){
    const rows = [this.headers.join(',')];
    this.filtered.forEach(r => {
      const line = this.headers.map(h => `"${(r[h]||'').toString().replace(/"/g,'""')}"`).join(',');
      rows.push(line);
    });
    const blob = new Blob([rows.join('\n')], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    a.remove(); URL.revokeObjectURL(url);
  }
}

/* ---------- escapeHtml ---------- */
function escapeHtml(s){
  if(s===null||s===undefined) return '';
  return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
}

/* ---------- Summary Calculations ---------- */
function computeSummary(data){
  // Expect columns: District, Total_Rainfall_mm, Normal_Rainfall_mm, Departure_Percent (or similar)
  // We'll compute average of totals, average normal, average departure and count districts
  if(!data || !data.length) return {};
  let sumTotal=0, sumNormal=0, sumDep=0, count=0;
  data.forEach(r=>{
    const total = toNumberSafe(r['Total_Rainfall_mm'] ?? r['Total'] ?? r['वास्तविक वर्षा (मिमी)'] ?? r['वास्तविक वर्षा']);
    const normal = toNumberSafe(r['Normal_Rainfall_mm'] ?? r['Normal'] ?? r['सामान्य वर्षा (मिमी)'] ?? r['सामान्य वर्षा']);
    const dep = toNumberSafe(r['Departure_Percent'] ?? r['Departure'] ?? r['विचलन (%)'] ?? r['विचलन']);
    if(!isNaN(total)){ sumTotal += total; }
    if(!isNaN(normal)){ sumNormal += normal; }
    if(!isNaN(dep)){ sumDep += dep; }
    count++;
  });
  return {
    avgTotal: sumTotal / count,
    avgNormal: sumNormal / count,
    avgDeparture: sumDep / count,
    districtCount: count
  };
}

/* ---------- Top10 chart (horizontal bar) using Chart.js ---------- */
async function renderTop10Chart(csvFile, canvasEl, valueKey){
  const parsed = await fetchCSV(csvFile);
  // valueKey guess if not provided
  const headers = parsed.headers;
  const data = parsed.data;
  // choose numeric column: try common names
  const numericCandidates = ['Total_Rainfall_mm','Total','वास्तविक वर्षा (मिमी)','वास्तविक वर्षा','Total_Rainfall'];
  let col = valueKey || headers.find(h => numericCandidates.includes(h)) || headers[1];
  // create sorted list by numeric col
  const sorted = [...data].sort((a,b)=> toNumberSafe(b[col]) - toNumberSafe(a[col]));
  const top10 = sorted.slice(0,10).reverse(); // reverse for horizontal bars (small->big)
  const labels = top10.map(r => r[headers[0]] || r['District'] || r['district'] || Object.values(r)[0]);
  const values = top10.map(r => toNumberSafe(r[col]));
  // create chart
  if(window._topChart) window._topChart.destroy();
  window._topChart = new Chart(canvasEl.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'दिन',
        data: values,
        backgroundColor: labels.map((_,i) => `rgba(14,116,144,${0.6 + i*0.03})`),
        borderRadius: 6,
        barThickness: 18
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      scales: {
        x: { grid: {color: 'rgba(0,0,0,0.03)'} },
        y: { ticks: { font: {size:12} } }
      },
      plugins: { legend:{display:false}, tooltip:{mode:'nearest'} }
    }
  });
}

/* ---------- Exports for pages ---------- */
window.__utils = {
  fetchCSV, parseCSV, DistrictTable, computeSummary, renderTop10Chart, MONTH_FILES
};
