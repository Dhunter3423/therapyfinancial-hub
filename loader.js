/* ===== Load a month: read the P&L pack in the browser ===== */
const STATE_NAMES = { Colorado: 'CO', Texas: 'TX', Arizona: 'AZ', Idaho: 'NV_ID', Nevada: 'NV_ID' };
const B2A_TABS = { 'TX Therapy Total': 'TX', 'CO Therapy Total': 'CO', 'AZ Therapy Total': 'AZ', 'NV_ID Therapy Total': 'NV_ID', 'ABA Therapy': 'aba', 'SBS Therapy': 'sbs' };
const STORE_KEY = 'tpt_loaded_months_v1';
const RAW_COLS = ['aba_rev','aba_gp','aba_hours','therapy_rev','therapy_gp','therapy_visits','sbs_rev','sbs_gp','sbs_hours','other_rev','other_gp','ebitda','net_income']
  .concat(['CO','TX','AZ','NV_ID'].flatMap(s => ['rev','gp','ebitda','ni','visits'].map(k => `${s}_${k}`)));
const FIELD_LABELS = {
  aba_rev: 'ABA revenue', aba_gp: 'ABA gross profit', aba_hours: 'ABA hours',
  therapy_rev: 'Therapy revenue (TX + CO + AZ + NV/ID)', therapy_gp: 'Therapy gross profit', therapy_visits: 'Therapy visits',
  sbs_rev: 'SBS revenue', sbs_gp: 'SBS gross profit', sbs_hours: 'SBS hours',
  other_rev: 'Other revenue', other_gp: 'Other gross profit',
  ebitda: 'EBITDA (consolidated)', net_income: 'Net income (consolidated)',
};
let pendingMonth = null;   // { month, row, warnings, files }
let BACKEND = false, SHARED = {};   // /api/months on Netlify; SHARED mirrors the server document
const API_MONTHS = '/api/months';
async function apiMonths(opts) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 8000);
  try { return await fetch(API_MONTHS, { cache: 'no-store', signal: c.signal, headers: { 'content-type': 'application/json' }, ...opts }); }
  finally { clearTimeout(t); }
}
async function detectBackend() {
  if (location.protocol === 'file:') { BACKEND = false; setBadge(); return; }
  try {
    const r = await apiMonths({ method: 'GET' });
    const ct = r.headers.get('content-type') || '';
    if (r.ok && ct.includes('json')) { SHARED = await r.json() || {}; BACKEND = true; }
    else BACKEND = false;
  } catch (e) { BACKEND = false; }
  setBadge();
}
function setBadge() {
  const b = document.getElementById('storeBadge');
  if (b) { b.textContent = BACKEND ? 'Shared' : 'This browser'; b.className = 'store-badge ' + (BACKEND ? 'shared' : 'local'); b.title = BACKEND ? 'Months loaded here are saved on the site and visible to everyone with the link' : 'No shared storage here: months loaded stay in this browser'; }
}

const isNum = (v) => typeof v === 'number' && isFinite(v);
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
const normMonth = (t) => {
  if (!t) return null; t = String(t).trim();
  let m = t.match(/^([A-Za-z]{3})[a-z]*\s+(\d{4})$/); if (m) return m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase() + ' ' + m[2];
  m = t.match(/^(\d{4})-(\d{1,2})/); if (m) return monthKey(+m[1], +m[2] - 1);
  m = t.match(/^(\d{1,2})\/(\d{4})$/); if (m) return monthKey(+m[2], +m[1] - 1);
  return null;
};

/* Row-level JS mirror of refresh.py record() so loaded months behave like baked ones */
function recordFromRow(r) {
  const g = (k) => (r[k] == null || r[k] === '' ? null : +r[k]);
  const lines = {
    aba:     { rev: g('aba_rev') || 0,     gp: g('aba_gp') || 0,     vol: g('aba_hours') },
    therapy: { rev: g('therapy_rev') || 0, gp: g('therapy_gp') || 0, vol: g('therapy_visits') },
    sbs:     { rev: g('sbs_rev') || 0,     gp: g('sbs_gp') || 0,     vol: g('sbs_hours') },
    other:   { rev: g('other_rev') || 0,   gp: g('other_gp') || 0,   vol: null },
  };
  let states = null;
  if (['CO','TX','AZ','NV_ID'].some(s => g(`${s}_rev`) != null)) {
    states = {};
    ['CO','TX','AZ','NV_ID'].forEach(s => {
      if (g(`${s}_rev`) == null && g(`${s}_ni`) == null) return;
      states[s] = { rev: g(`${s}_rev`) || 0, gp: g(`${s}_gp`) || 0, ebitda: g(`${s}_ebitda`), ni: g(`${s}_ni`), vol: g(`${s}_visits`) };
    });
  }
  return { lines, ebitda: g('ebitda'), ni: g('net_income'), states };
}

/* ----- Income statement workbook ----- */
function parseIncomeStatement(wb, fileName) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const title = String((rows[1] || [])[0] || '');
  const month = normMonth((rows[3] || [])[0]);
  const line = /:\s*ABA/i.test(title) ? 'aba' : /:\s*Schools/i.test(title) ? 'sbs' : /:\s*Therapy/i.test(title) ? 'therapy' : null;
  const hi = rows.findIndex(r => r && r[0] === 'Financial Row');
  if (hi < 0 || !month || !line) return null;
  const hdr = rows[hi], sub = rows[hi + 1] || [];
  const width = Math.max(hdr.length, sub.length);
  // column groups from the header row; a group's figure is its "Total" sub column, or its only column
  const groups = [];
  for (let c = 1; c < width; c++) if (hdr[c] != null && String(hdr[c]).trim() !== '') groups.push({ name: String(hdr[c]).trim(), start: c });
  groups.forEach((gp, i) => {
    gp.end = i + 1 < groups.length ? groups[i + 1].start - 1 : width - 1;
    let col = gp.start;
    for (let c = gp.start; c <= gp.end; c++) if (String(sub[c] || '').trim() === 'Total') col = c;
    gp.col = col;
  });
  const byLabel = {};
  rows.slice(hi + 1).forEach(r => { if (r && r[0] != null) { const k = String(r[0]).trim(); if (!(k in byLabel)) byLabel[k] = r; } });
  const pick = (label, col) => { const r = byLabel[label]; return r && isNum(r[col]) ? r[col] : (r ? 0 : null); };
  const daLabel = Object.keys(byLabel).find(k => /^Total - (72000\.3000 - )?Depreciation & Amortization$/.test(k));
  const totalGrp = groups.find(g => g.name === 'Total') || groups[groups.length - 1];
  const out = { file: fileName, line, month, title, states: {}, total: {} };
  groups.forEach(gp => {
    const st = STATE_NAMES[gp.name];
    if (!st) return;
    const s = out.states[st] || (out.states[st] = { rev: 0, gp: 0, ni: 0, parts: [] });
    s.rev += pick('Total - Income', gp.col) || 0; s.gp += pick('Gross Profit', gp.col) || 0; s.ni += pick('Net Income', gp.col) || 0; s.parts.push(gp.name);
  });
  out.total = { rev: pick('Total - Income', totalGrp.col), gp: pick('Gross Profit', totalGrp.col), ni: pick('Net Income', totalGrp.col), da: daLabel ? (pick(daLabel, totalGrp.col) || 0) : 0 };
  return out;
}

/* ----- Budget to Actuals workbook ----- */
function parseB2A(wb, fileName) {
  const out = { file: fileName, tabs: {}, months: [] };
  Object.keys(B2A_TABS).forEach(name => {
    const ws = wb.Sheets[name]; if (!ws) return;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, cellDates: true });
    let section = null, dateRow = null; const tab = {};
    rows.forEach(r => {
      if (!r) return;
      if (r[1] === 'Budget' || r[1] === 'Budget + Actuals') { section = r[1]; return; }
      if (r.some(v => v instanceof Date)) { dateRow = r; return; }
      if (section !== 'Budget + Actuals' || !dateRow) return;
      const label = r[1];
      if (!['Therapy Visits', 'Therapy Hours', 'Revenue', 'Gross Profit'].includes(label)) return;
      dateRow.forEach((d, c) => { if (d instanceof Date && isNum(r[c])) { const m = monthKey(d.getFullYear(), d.getMonth()); (tab[m] = tab[m] || {})[label] = r[c]; if (!out.months.includes(m)) out.months.push(m); } });
    });
    out.tabs[B2A_TABS[name]] = tab;
  });
  return Object.keys(out.tabs).length ? out : null;
}

/* ----- Assemble one month from whatever was dropped ----- */
function assembleMonth(parsed, monthOverride) {
  const pnls = parsed.filter(p => p.kind === 'pnl').map(p => p.data);
  const b2a = parsed.find(p => p.kind === 'b2a');
  const months = [...new Set(pnls.map(p => p.month))];
  const month = monthOverride || months[0] || (b2a && b2a.data.months.slice().sort((a, b) => monthIndexAny(a) - monthIndexAny(b)).filter(m => b2a.data.tabs.CO && b2a.data.tabs.CO[m] && b2a.data.tabs.CO[m].Revenue).pop()) || null;
  const warnings = [];
  if (months.length > 1) warnings.push('The P&L files cover different months (' + months.join(', ') + '). Using ' + month + '.');
  const row = {}; RAW_COLS.forEach(k => row[k] = null);
  const src = {};
  const tab = (k) => (b2a && b2a.data.tabs[k] && b2a.data.tabs[k][month]) || null;

  // Therapy states from the therapy P&Ls (state columns, allocations excluded)
  const st = {};
  pnls.filter(p => p.line === 'therapy' && p.month === month).forEach(p => Object.entries(p.states).forEach(([k, v]) => { const s = st[k] || (st[k] = { rev: 0, gp: 0, ni: 0 }); s.rev += v.rev; s.gp += v.gp; s.ni += v.ni; }));
  ['CO','TX','AZ','NV_ID'].forEach(k => {
    const t = tab(k);
    if (st[k]) { row[`${k}_rev`] = r2(st[k].rev); row[`${k}_gp`] = r2(st[k].gp); row[`${k}_ni`] = r2(st[k].ni); row[`${k}_ebitda`] = r2(st[k].ni); src[k] = 'P&L'; }
    else if (t && isNum(t.Revenue)) { row[`${k}_rev`] = r2(t.Revenue); row[`${k}_gp`] = r2(t['Gross Profit']); src[k] = 'Budget to Actuals'; warnings.push(`${STATES[k].label}: no P&L file, revenue and gross profit taken from Budget to Actuals; net income and EBITDA left blank.`); }
    else warnings.push(`${STATES[k].label}: no figures found for ${month}.`);
    if (t && isNum(t['Therapy Visits'])) row[`${k}_visits`] = Math.round(t['Therapy Visits']);
  });
  const stRev = ['CO','TX','AZ','NV_ID'].map(k => row[`${k}_rev`]);
  if (stRev.every(v => v != null)) { row.therapy_rev = r2(stRev.reduce((a, b) => a + b, 0)); row.therapy_gp = r2(['CO','TX','AZ','NV_ID'].reduce((a, k) => a + (row[`${k}_gp`] || 0), 0)); }
  const stVis = ['CO','TX','AZ','NV_ID'].map(k => row[`${k}_visits`]);
  if (stVis.every(v => v != null)) row.therapy_visits = stVis.reduce((a, b) => a + b, 0); else warnings.push('Therapy visits: one or more state tabs missing in Budget to Actuals; consolidated visits left blank.');

  // ABA and SBS
  [['aba', 'ABA'], ['sbs', 'SBS']].forEach(([k, label]) => {
    const p = pnls.find(x => x.line === k && x.month === month), t = tab(k);
    if (p) { row[`${k}_rev`] = r2(p.total.rev); row[`${k}_gp`] = r2(p.total.gp); src[k] = 'P&L'; }
    else if (t && isNum(t.Revenue)) { row[`${k}_rev`] = r2(t.Revenue); row[`${k}_gp`] = r2(t['Gross Profit']); src[k] = 'Budget to Actuals'; warnings.push(`${label}: no P&L file, revenue and gross profit taken from Budget to Actuals.`); }
    else warnings.push(`${label}: no figures found for ${month}.`);
    if (t && isNum(t['Therapy Hours'])) row[`${k}_hours`] = r2(t['Therapy Hours']); else warnings.push(`${label} hours not found in Budget to Actuals.`);
  });
  row.other_rev = 0; row.other_gp = 0;

  // Consolidated NI and EBITDA need every department P&L (Total column, allocations included)
  const covered = new Set(); pnls.filter(p => p.month === month).forEach(p => { if (p.line === 'therapy') Object.keys(p.states).forEach(s => covered.add(s)); else covered.add(p.line); });
  const need = ['CO','TX','AZ','NV_ID','aba','sbs'], missing = need.filter(k => !covered.has(k));
  if (!missing.length) {
    const ni = pnls.filter(p => p.month === month).reduce((a, p) => a + (p.total.ni || 0), 0);
    const da = pnls.filter(p => p.month === month).reduce((a, p) => a + (p.total.da || 0), 0);
    row.net_income = r2(ni); row.ebitda = r2(ni + da);
  } else {
    const partial = pnls.filter(p => p.month === month).reduce((a, p) => a + (p.total.ni || 0), 0);
    warnings.push(`Consolidated net income and EBITDA left blank: missing P&L for ${missing.map(k => STATES[k] ? STATES[k].label : k.toUpperCase()).join(', ')}. Net income across the files on hand is ${fmtCurrency(partial)}.`);
  }
  if (!b2a) warnings.push('No Budget to Actuals workbook: visits and hours left blank.');
  return { month, row, warnings, src, files: parsed.map(p => p.file) };
}
function monthIndexAny(m) { return yearOf(m) * 12 + monOf(m); }

/* ----- UI ----- */
async function handleFiles(fileList) {
  const files = [...fileList].filter(f => /\.xlsx?$/i.test(f.name));
  const status = document.getElementById('loadStatus');
  if (!files.length) { status.textContent = 'Drop the .xlsx files from the monthly pack.'; return; }
  status.textContent = 'Reading ' + files.length + ' file(s)...';
  const parsed = [], ignored = [];
  for (const f of files) {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
      const b2a = wb.SheetNames.some(n => n in B2A_TABS) ? parseB2A(wb, f.name) : null;
      if (b2a) { parsed.push({ kind: 'b2a', file: f.name, data: b2a }); continue; }
      const pnl = parseIncomeStatement(wb, f.name);
      if (pnl) parsed.push({ kind: 'pnl', file: f.name, data: pnl }); else ignored.push(f.name);
    } catch (e) { ignored.push(f.name + ' (' + e.message + ')'); }
  }
  if (!parsed.length) { status.textContent = 'None of those files look like a COFK income statement or Budget to Actuals workbook.'; return; }
  pendingMonth = assembleMonth(parsed, null);
  if (ignored.length) pendingMonth.warnings.push('Not recognised, skipped: ' + ignored.join(', '));
  status.textContent = '';
  renderReview();
}

function renderReview() {
  const box = document.getElementById('loadReview');
  if (!pendingMonth || !pendingMonth.month) { box.innerHTML = '<div class="load-warn">Could not work out which month these files cover.</div>'; return; }
  const p = pendingMonth, exists = hasMonth(p.month);
  let h = `<div class="load-head"><div><span class="load-month">${esc(p.month)}</span> ${exists ? '<span class="load-pill warn">will replace the existing month</span>' : '<span class="load-pill">new month</span>'}</div><div class="load-files">${p.files.map(esc).join(' · ')}</div></div>`;
  if (p.warnings.length) h += '<ul class="load-warnlist">' + p.warnings.map(w => `<li>${esc(w)}</li>`).join('') + '</ul>';
  const inp = (k) => `<input class="load-input" data-key="${k}" value="${p.row[k] == null ? '' : p.row[k]}" onchange="pendingMonth.row['${k}'] = this.value === '' ? null : +this.value">`;
  h += '<div class="load-grid">';
  h += '<table><thead><tr><th>Service line</th><th>Revenue</th><th>Gross profit</th><th>Volume</th><th>Source</th></tr></thead><tbody>';
  [['aba','ABA Therapy','aba_hours'],['therapy','Therapy (OT / PT / SLP)','therapy_visits'],['sbs','School Based Services','sbs_hours'],['other','Other Services',null]].forEach(([k, label, vol]) => {
    h += `<tr><td>${label}</td><td>${inp(k + '_rev')}</td><td>${inp(k + '_gp')}</td><td>${vol ? inp(vol) : '–'}</td><td class="load-src">${esc(p.src[k] || (k === 'therapy' ? 'state columns' : ''))}</td></tr>`;
  });
  h += `<tr class="total-row"><td>Consolidated</td><td colspan="2">EBITDA ${inp('ebitda')} &nbsp; Net income ${inp('net_income')}</td><td colspan="2" class="load-src">Net income = sum of P&amp;L Total columns; EBITDA = net income + D&amp;A</td></tr>`;
  h += '</tbody></table>';
  h += '<table><thead><tr><th>Therapy state</th><th>Revenue</th><th>Gross profit</th><th>Net income</th><th>Visits</th><th>Source</th></tr></thead><tbody>';
  ['CO','TX','AZ','NV_ID'].forEach(k => { h += `<tr><td>${STATES[k].label}</td><td>${inp(k + '_rev')}</td><td>${inp(k + '_gp')}</td><td>${inp(k + '_ni')}</td><td>${inp(k + '_visits')}</td><td class="load-src">${esc(p.src[k] || '')}</td></tr>`; });
  h += '</tbody></table></div>';
  h += `<div class="load-actions"><button class="btn" onclick="commitMonth()">${exists ? 'Replace' : 'Add'} ${esc(p.month)} on this site</button><button class="btn btn-ghost" onclick="pendingMonth = null; renderReview()">Cancel</button><span class="picker-hint">Figures are editable before you add them. State EBITDA is set equal to state net income.</span></div>`;
  box.innerHTML = h;
}

function loadStore() {
  if (BACKEND) { const o = {}; Object.entries(SHARED).forEach(([m, r]) => { const { _updatedAt, ...row } = r; o[m] = row; }); return o; }
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (e) { return {}; }
}
function saveStore(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); return true; } catch (e) { return false; } }
function applyLoadedMonths() {
  const s = loadStore(); const ms = Object.keys(s);
  ms.forEach(m => { ['CO','TX','AZ','NV_ID'].forEach(k => { const r = s[m]; if (r[`${k}_ni`] != null && r[`${k}_ebitda`] == null) r[`${k}_ebitda`] = r[`${k}_ni`]; }); DATA[m] = recordFromRow(s[m]); if (!MONTHS.includes(m)) MONTHS.push(m); });
  MONTHS.sort((a, b) => monthIndexAny(a) - monthIndexAny(b));
  const tag = document.getElementById('loadedTag');
  if (tag) tag.textContent = ms.length ? `${ms.length} month${ms.length > 1 ? 's' : ''} loaded ${BACKEND ? 'on this site' : 'in this browser'}: ${ms.sort((a, b) => monthIndexAny(a) - monthIndexAny(b)).join(', ')}` : '';
  const dt = document.querySelector('.data-tag'); if (dt && MONTHS.length) dt.textContent = `Data: ${MONTHS[0]} – ${MONTHS[MONTHS.length - 1]}`;
}
async function commitMonth() {
  if (!pendingMonth) return;
  ['CO','TX','AZ','NV_ID'].forEach(k => { if (pendingMonth.row[`${k}_ni`] != null) pendingMonth.row[`${k}_ebitda`] = pendingMonth.row[`${k}_ni`]; });
  const month = pendingMonth.month, row = pendingMonth.row;
  const status = document.getElementById('loadStatus');
  if (BACKEND) {
    status.textContent = 'Saving ' + month + ' to the site...';
    try {
      const r = await apiMonths({ method: 'PUT', body: JSON.stringify({ month, row }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'The site refused the save.');
      const g = await apiMonths({ method: 'GET' }); SHARED = g.ok ? (await g.json() || {}) : { ...SHARED, [month]: row };
      status.textContent = month + ' saved on the site. Everyone with the link sees it now.';
    } catch (e) {
      status.textContent = 'Could not save to the site (' + e.message + '). Kept in this browser only.';
      const s = loadStore(); s[month] = row; saveStore(s); SHARED[month] = row;
    }
  } else {
    const s = loadStore(); s[month] = row;
    if (!saveStore(s)) alert('Could not save in this browser (storage blocked). The month is applied for this visit only.');
    status.textContent = month + ' loaded in this browser only.';
  }
  pendingMonth = null; document.getElementById('loadReview').innerHTML = '';
  applyLoadedMonths(); buildPicker(); applyPreset('latest');
}
async function clearLoadedMonths() {
  const ms = Object.keys(loadStore()); if (!ms.length) return;
  if (BACKEND) {
    const pick = prompt('Remove which month from the site? Type one of: ' + ms.join(', ') + '\nor type ALL to remove every loaded month (for everyone).');
    if (!pick) return;
    const q = pick.trim().toUpperCase() === 'ALL' ? '?all=1' : '?month=' + encodeURIComponent(pick.trim());
    if (pick.trim().toUpperCase() !== 'ALL' && !ms.includes(pick.trim())) { alert('No loaded month called "' + pick + '".'); return; }
    try { await fetch(API_MONTHS + q, { method: 'DELETE' }); } catch (e) { alert('Could not reach the site: ' + e.message); return; }
    location.reload(); return;
  }
  if (!confirm('Remove the months loaded in this browser and go back to the published data?')) return;
  try { localStorage.removeItem(STORE_KEY); } catch (e) {}
  location.reload();
}
function exportDataCsv() {
  const baked = loadStore();
  const lines = ['month,' + RAW_COLS.join(',')];
  MONTHS.forEach(m => {
    if (baked[m]) { lines.push([m].concat(RAW_COLS.map(k => baked[m][k] == null ? '' : baked[m][k])).join(',')); return; }
    const d = DATA[m], L = d.lines, S = d.states || {};
    const v = { aba_rev: L.aba.rev, aba_gp: L.aba.gp, aba_hours: L.aba.vol, therapy_rev: L.therapy.rev, therapy_gp: L.therapy.gp, therapy_visits: L.therapy.vol,
                sbs_rev: L.sbs.rev, sbs_gp: L.sbs.gp, sbs_hours: L.sbs.vol, other_rev: L.other.rev, other_gp: L.other.gp, ebitda: d.ebitda, net_income: d.ni };
    ['CO','TX','AZ','NV_ID'].forEach(k => { const s = S[k]; v[`${k}_rev`] = s ? s.rev : null; v[`${k}_gp`] = s ? s.gp : null; v[`${k}_ebitda`] = s ? s.ebitda : null; v[`${k}_ni`] = s ? s.ni : null; v[`${k}_visits`] = s ? s.vol : null; });
    lines.push([m].concat(RAW_COLS.map(k => v[k] == null ? '' : r2(v[k]))).join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'merged_data.csv'; document.body.appendChild(a); a.click(); a.remove();
}
function toggleLoadPanel() { const p = document.getElementById('loadPanel'); p.classList.toggle('open'); }
function initLoader() {
  const dz = document.getElementById('dropZone'); if (!dz) return;
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
  document.getElementById('fileInput').addEventListener('change', e => { handleFiles(e.target.files); e.target.value = ''; });
}
