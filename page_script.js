/* ===== Data (injected by refresh.py) ===== */
const DATA = __DATA__;
let MONTHS = __MONTHS__;
const WEEKLY = __WEEKLY__;   // { 'YYYY-MM-DD': { lines:{key:{rev,gp,vol}}, states:{key:{rev,gp,vol}} } }
const WEEKS = __WEEKS__;     // sorted week-ending dates

/* ===== Entity metadata ===== */
const LINES = {
  aba:     { label: 'ABA Therapy',             color: '#F9A513', volLabel: 'Hours',  unit: 'Hour'  },
  therapy: { label: 'Therapy (OT / PT / SLP)', color: '#0020F0', volLabel: 'Visits', unit: 'Visit' },
  sbs:     { label: 'School Based Services',   color: '#59D9BC', volLabel: 'Hours',  unit: 'Hour'  },
  other:   { label: 'Other Services',          color: '#D47BFB', volLabel: null,     unit: null    },
};
const STATES = {
  CO:    { label: 'Colorado',        color: '#0020F0', volLabel: 'Visits', unit: 'Visit' },
  TX:    { label: 'Texas',           color: '#F9A513', volLabel: 'Visits', unit: 'Visit' },
  AZ:    { label: 'Arizona',         color: '#D47BFB', volLabel: 'Visits', unit: 'Visit' },
  NV_ID: { label: 'Nevada / Idaho',  color: '#59D9BC', volLabel: 'Visits', unit: 'Visit' },
};
const YEAR_COLORS = ['#9aa5b5', '#D47BFB', '#F9A513', '#0020F0', '#59D9BC', '#1a2580'];
const METRICS = {
  rev:           { label: 'Revenue',                 fmt: 'currency', ratio: false },
  gp:            { label: 'Gross Profit',            fmt: 'currency', ratio: false },
  gm:            { label: 'Gross Margin %',          fmt: 'pct',      ratio: true  },
  ebitda:        { label: 'EBITDA',                  fmt: 'currency', ratio: false },
  ebitda_margin: { label: 'EBITDA Margin %',         fmt: 'pct',      ratio: true  },
  vol:           { label: 'Volume',                  fmt: 'count',    ratio: false },
  rpu:           { label: 'Revenue per Visit / Hour', fmt: 'rpu',     ratio: true  },
};

/* ===== State ===== */
let mode = 'line';
let currentView = 'summary';
let range = 'picker';
let activeLines = { aba: true, therapy: true, sbs: true, other: true };
let activeStates = { CO: true, TX: true, AZ: true, NV_ID: true };
let periods = [];          // [{label, months:[...]}]
let activePreset = null;
let chartType = 'line';

/* ===== Helpers ===== */
const monthIndex = (m) => MONTHS.indexOf(m);
const yearOf = (m) => parseInt(m.slice(-4), 10);
const monOf = (m) => ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m.slice(0, 3));
const monthKey = (y, mi) => ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][mi] + ' ' + y;
const hasMonth = (m) => DATA[m] != null;

const fmtCurrency = (v) => {
  if (v == null || v === 0) return '–';
  const neg = v < 0;
  return (neg ? '(' : '') + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 }) + (neg ? ')' : '');
};
const fmtPct = (v) => (v == null ? '–' : (v * 100).toFixed(1) + '%');
const fmtCount = (v) => (v == null || v === 0 ? '–' : Math.round(v).toLocaleString('en-US'));
const fmtRPU = (v) => (v == null || v === 0 ? '–' : '$' + v.toFixed(2));
const fmtBy = (v, fmt) => fmt === 'pct' ? fmtPct(v) : fmt === 'count' ? fmtCount(v) : fmt === 'rpu' ? fmtRPU(v) : fmtCurrency(v);
const fmtAxis = (v, fmt) => {
  if (fmt === 'pct') return (v * 100).toFixed(0) + '%';
  if (fmt === 'rpu') return '$' + v.toFixed(0);
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  const n = a >= 1e6 ? (a / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'K' : a.toFixed(0);
  return s + (fmt === 'count' ? n : '$' + n);
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function variance(curr, prev, fmt) {
  if (curr == null || prev == null || (fmt !== 'pct' && (curr === 0 || prev === 0))) return '<span class="variance-flat">–</span>';
  const diff = curr - prev;
  if (fmt === 'pct') {
    const cls = Math.abs(diff) < 0.0005 ? 'variance-flat' : (diff >= 0 ? 'variance-pos' : 'variance-neg');
    return `<span class="${cls}">${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(1)} pts</span>`;
  }
  const pct = diff / Math.abs(prev);
  const flat = fmt === 'count' ? Math.abs(diff) < 1 : fmt === 'rpu' ? Math.abs(diff) < 0.005 : Math.abs(diff) < 0.5;
  const cls = flat ? 'variance-flat' : (diff >= 0 ? 'variance-pos' : 'variance-neg');
  const sign = diff >= 0 ? '+' : '−';
  const body = fmt === 'count' ? Math.round(Math.abs(diff)).toLocaleString('en-US')
             : fmt === 'rpu' ? '$' + Math.abs(diff).toFixed(2)
             : '$' + Math.abs(diff).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const pctStr = isFinite(pct) ? ((pct >= 0 ? '+' : '') + (pct * 100).toFixed(1) + '%') : '';
  return `<span class="${cls}">${sign}${body}<span class="pct">${pctStr}</span></span>`;
}

/* ===== Scope ===== */
function activeEntities() {
  const src = mode === 'line' ? LINES : STATES;
  const act = mode === 'line' ? activeLines : activeStates;
  return Object.keys(src).filter(k => act[k]);
}
function entityMeta(k) { return mode === 'line' ? LINES[k] : STATES[k]; }
function allLinesActive() { return Object.values(activeLines).every(Boolean); }

/* Raw monthly record for one entity: {rev, gp, ebitda, ni, vol} (nulls where not reported) */
function entityMonth(m, k) {
  const d = DATA[m];
  if (!d) return null;
  if (mode === 'line') {
    const e = d.lines[k];
    return { rev: e.rev, gp: e.gp, ebitda: null, ni: null, vol: e.vol };
  }
  const s = d.states && d.states[k];
  if (!s) return null;
  return { rev: s.rev, gp: s.gp, ebitda: s.ebitda, ni: s.ni, vol: s.vol };
}

/* Aggregate one entity over a list of months */
function aggEntity(months, k) {
  const out = { rev: 0, gp: 0, ebitda: 0, ni: 0, vol: 0, n: 0, volMonths: 0, revWithVol: 0, ebitdaOk: true, volOk: false, present: false };
  months.forEach(m => {
    const e = entityMonth(m, k);
    if (!e) return;
    out.present = true; out.n++;
    out.rev += e.rev || 0; out.gp += e.gp || 0;
    if (e.ebitda == null) out.ebitdaOk = false; else { out.ebitda += e.ebitda; out.ni += e.ni || 0; }
    if (e.vol != null && e.vol > 0) { out.vol += e.vol; out.volOk = true; out.volMonths++; out.revWithVol += e.rev || 0; }
  });
  if (!out.present) return null;
  if (!out.ebitdaOk) { out.ebitda = null; out.ni = null; }
  if (!out.volOk) out.vol = null;
  out.volPartial = out.volOk && out.volMonths < out.n;   // volume covers only some of the period's months
  out.gm = out.rev ? out.gp / out.rev : null;
  out.ebitda_margin = (out.ebitda != null && out.rev) ? out.ebitda / out.rev : null;
  // revenue per unit only over the months that actually have volume, so partial coverage never inflates the rate
  out.rpu = (out.vol && out.revWithVol) ? out.revWithVol / out.vol : null;
  return out;
}

/* Aggregate the whole active scope over months */
function aggScope(months) {
  const ents = activeEntities();
  const parts = ents.map(k => aggEntity(months, k)).filter(Boolean);
  const t = { rev: 0, gp: 0, vol: 0, volOk: false, ebitda: null, ni: null, revWithVol: 0, volPartial: false, volMonths: 0, n: 0 };
  parts.forEach(p => { t.rev += p.rev; t.gp += p.gp; t.n = Math.max(t.n, p.n); if (p.vol != null) { t.vol += p.vol; t.volOk = true; t.revWithVol += p.revWithVol; t.volMonths = Math.max(t.volMonths, p.volMonths); if (p.volPartial) t.volPartial = true; } });
  if (!t.volOk) t.vol = null;
  if (mode === 'line') {
    if (allLinesActive()) {
      let e = 0, n = 0, ok = true, any = false;
      months.forEach(m => { const d = DATA[m]; if (!d) return; any = true; if (d.ebitda == null) ok = false; else { e += d.ebitda; n += d.ni || 0; } });
      if (any && ok) { t.ebitda = e; t.ni = n; }
    }
  } else if (parts.length) {
    if (parts.every(p => p.ebitda != null)) { t.ebitda = parts.reduce((s, p) => s + p.ebitda, 0); t.ni = parts.reduce((s, p) => s + p.ni, 0); }
  }
  t.gm = t.rev ? t.gp / t.rev : null;
  t.ebitda_margin = (t.ebitda != null && t.rev) ? t.ebitda / t.rev : null;
  t.rpu = (t.vol && t.revWithVol) ? t.revWithVol / t.vol : null;
  return t;
}

/* Metric for one entity in one month (charts) */
function metricValue(agg, metric) {
  if (!agg) return null;
  const v = agg[metric];
  return (v == null || (metric !== 'gm' && metric !== 'ebitda_margin' && metric !== 'rpu' && metric !== 'ebitda' && metric !== 'ni' && v === 0)) ? null : v;
}

/* ===== Periods and presets ===== */
function buildPicker() {
  const row = document.getElementById('pickerRow');
  let html = '';
  for (let i = 0; i < 4; i++) {
    html += `<select class="month-select" data-slot="${i}" onchange="pickerChanged()"><option value="">${i < 2 ? 'Select month' : 'Optional'}</option>`;
    MONTHS.forEach(m => { html += `<option value="${m}">${m}</option>`; });
    html += '</select>';
  }
  html += '<button class="btn btn-ghost" onclick="clearPeriods()">Clear</button>';
  row.innerHTML = html;
}
function pickerChanged() {
  activePreset = null;
  periods = [...document.querySelectorAll('.month-select[data-slot]')].map(s => s.value).filter(Boolean).map(m => ({ label: m, months: [m] }));
  render();
}
function setPickerValues(vals) {
  document.querySelectorAll('.month-select[data-slot]').forEach((s, i) => { s.value = vals[i] || ''; });
}
function clearPeriods() { activePreset = null; periods = []; setPickerValues([]); render(); }

function monthsBetween(y, m0, m1) { const out = []; for (let mi = m0; mi <= m1; mi++) { const k = monthKey(y, mi); if (hasMonth(k)) out.push(k); } return out; }
function shortRange(months) {
  if (months.length === 1) return months[0];
  return months[0].slice(0, 3) + ' to ' + months[months.length - 1].slice(0, 3) + ' ' + yearOf(months[0]);
}
function applyPreset(p) {
  const last = MONTHS[MONTHS.length - 1], ly = yearOf(last), lm = monOf(last);
  let out = [];
  if (p === 'latest') {
    const prior = MONTHS[MONTHS.length - 2];
    const sameLY = monthKey(ly - 1, lm);
    out = [prior, last, sameLY].filter(hasMonth).map(m => ({ label: m, months: [m] }));
    // order: last year, prior month, latest
    out = [sameLY, prior, last].filter(hasMonth).map(m => ({ label: m, months: [m] }));
    setPickerValues(out.map(o => o.months[0]));
  } else if (p === 'ytd') {
    for (let y = ly - 2; y <= ly; y++) { const ms = monthsBetween(y, 0, lm); if (ms.length === lm + 1) out.push({ label: `YTD ${y}`, sub: shortRange(ms), months: ms }); }
    setPickerValues([]);
  } else if (p === 't12') {
    const n = MONTHS.length;
    if (n >= 24) out = [{ label: 'Prior 12', sub: MONTHS[n - 24] + ' to ' + MONTHS[n - 13], months: MONTHS.slice(n - 24, n - 12) },
                         { label: 'Trailing 12', sub: MONTHS[n - 12] + ' to ' + MONTHS[n - 1], months: MONTHS.slice(n - 12) }];
    setPickerValues([]);
  } else if (p === 'qtr') {
    const q0 = Math.floor(lm / 3) * 3, qn = Math.floor(lm / 3) + 1;
    for (let y = ly - 2; y <= ly; y++) { const ms = monthsBetween(y, q0, y === ly ? lm : q0 + 2); if (ms.length) out.push({ label: `Q${qn} ${y}`, sub: shortRange(ms), months: ms }); }
    setPickerValues([]);
  }
  periods = out; activePreset = p; render();
}

/* ===== Controls ===== */
function setMode(m) {
  mode = m;
  document.getElementById('modeLine').classList.toggle('active', m === 'line');
  document.getElementById('modeState').classList.toggle('active', m === 'state');
  document.getElementById('lineBlock').style.display = m === 'line' ? '' : 'none';
  document.getElementById('stateBlock').style.display = m === 'state' ? '' : 'none';
  render();
}
function toggleLine(k) { activeLines[k] = !activeLines[k]; syncChips(); render(); }
function toggleState(k) { activeStates[k] = !activeStates[k]; syncChips(); render(); }
function setAllLines(v) { Object.keys(activeLines).forEach(k => activeLines[k] = v); syncChips(); render(); }
function setAllStates(v) { Object.keys(activeStates).forEach(k => activeStates[k] = v); syncChips(); render(); }
function syncChips() {
  document.querySelectorAll('.chip[data-line]').forEach(c => c.classList.toggle('active', !!activeLines[c.dataset.line]));
  document.querySelectorAll('.chip[data-state]').forEach(c => c.classList.toggle('active', !!activeStates[c.dataset.state]));
}
function setView(v) {
  currentView = v;
  ['Summary', 'Detail', 'Trend', 'Yoy', 'Wow'].forEach(n => document.getElementById('view' + n).classList.toggle('active', v === n.toLowerCase()));
  render();
}
function setChartType(t) {
  chartType = t;
  document.getElementById('typeLine').classList.toggle('active', t === 'line');
  document.getElementById('typeBar').classList.toggle('active', t === 'bar');
  render();
}
function setRange(r) {
  range = r;
  document.getElementById('rangePicker').classList.toggle('active', r === 'picker');
  document.getElementById('rangeAll').classList.toggle('active', r === 'all');
  render();
}

/* ===== Render ===== */
function render() {
  TIPS.length = 0; hideTip();
  document.querySelectorAll('#presetRow .toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.preset === activePreset));
  renderBanner();
  const isChart = currentView === 'trend' || currentView === 'yoy' || currentView === 'wow';
  document.getElementById('chartCard').style.display = isChart ? '' : 'none';
  document.getElementById('compareCard').style.display = isChart ? 'none' : '';
  document.getElementById('rangeToggle').style.display = currentView === 'trend' ? '' : 'none';
  document.getElementById('chartTypeToggle').style.display = (currentView === 'yoy' || currentView === 'wow') ? '' : 'none';
  document.getElementById('weeksSelect').style.display = currentView === 'wow' ? '' : 'none';
  // EBITDA is monthly only
  const ebOpts = [...document.getElementById('metricSelect').options].filter(o => o.value === 'ebitda' || o.value === 'ebitda_margin');
  ebOpts.forEach(o => { o.disabled = currentView === 'wow'; });
  if (currentView === 'wow' && ebOpts.some(o => o.selected)) document.getElementById('metricSelect').value = 'rev';
  if (currentView === 'trend') renderTrend();
  else if (currentView === 'yoy') renderYoy();
  else if (currentView === 'wow') renderWeekly();
  else renderTable();
}

function renderBanner() {
  const el = document.getElementById('scopeBanner');
  const ents = activeEntities();
  const notes = [];
  if (mode === 'state') notes.push('Showing the Therapy line of business (OT / PT / SLP) by state. ABA and SBS are not allocated to states and are excluded. State detail begins Jan 2024.');
  if (mode === 'line' && !allLinesActive() && ents.length) notes.push('EBITDA and net income are reported for Therapy+ consolidated only, so they show a dash while a service line is filtered out. Switch to State for Therapy EBITDA by state.');
  if (ents.length === 0) notes.push('No ' + (mode === 'line' ? 'service lines' : 'states') + ' selected.');
  if (mode === 'line' && ents.length && !allLinesActive()) notes.push('Scope: ' + ents.map(k => LINES[k].label).join(', ') + '.');
  if (mode === 'state' && ents.length && ents.length < 4) notes.push('Scope: ' + ents.map(k => STATES[k].label).join(', ') + '.');
  el.innerHTML = notes.length ? `<div class="scope-banner">${notes.join(' ')}</div>` : '';
}

function periodHeader(p) {
  return `<th class="month-col">${esc(p.label)}${p.sub ? `<span class="period-label">${esc(p.sub)}</span>` : ''}</th>`;
}

function renderTable() {
  const card = document.getElementById('compareCard');
  const ents = activeEntities();
  if (periods.length < 2) { card.innerHTML = '<div class="empty">Select at least 2 periods, or use a preset, to view the comparison.</div>'; return; }
  if (!ents.length) { card.innerHTML = '<div class="empty">Select at least one ' + (mode === 'line' ? 'service line' : 'state') + '.</div>'; return; }

  const aggs = periods.map(p => ({ scope: aggScope(p.months), ents: Object.fromEntries(ents.map(k => [k, aggEntity(p.months, k)])) }));
  const cols = periods.length + (periods.length - 1) + 1;

  let html = '<table><thead><tr><th>Metric</th>';
  periods.forEach(p => { html += periodHeader(p); });
  for (let i = 1; i < periods.length; i++) html += `<th>Δ vs ${esc(periods[0].label)}</th>`;
  html += '</tr></thead><tbody>';

  const row = (label, getter, fmt, opts = {}) => {
    let cls = opts.total ? 'total-row' : opts.grand ? 'grand-total-row' : '';
    if (opts.indent) cls += ' indent';
    let h = `<tr class="${cls}"><td>${label}</td>`;
    const vals = aggs.map(a => getter(a));
    vals.forEach((v, i) => {
      let note = '';
      if (opts.cover) { const c = opts.cover(aggs[i]); if (c && c.volPartial) note = `<span class="cover-note" title="Volume is reported for ${c.volMonths} of the ${c.n} months in this period; revenue per unit uses only those months">${c.volMonths} of ${c.n} mo</span>`; }
      h += `<td>${fmtBy(v, fmt)}${note}</td>`;
    });
    for (let i = 1; i < vals.length; i++) h += `<td class="variance-cell">${variance(vals[i], vals[0], fmt)}</td>`;
    return h + '</tr>';
  };
  const section = (label) => `<tr class="section-header"><td colspan="${cols}">${label}</td></tr>`;
  const dim = mode === 'line' ? 'Service Line' : 'State';
  const volEnts = ents.filter(k => entityMeta(k).volLabel);

  if (currentView === 'summary') {
    html += section('Revenue by ' + dim);
    ents.forEach(k => { html += row(entityMeta(k).label, a => a.ents[k] ? a.ents[k].rev : null, 'currency'); });
    html += row('Total Revenue', a => a.scope.rev, 'currency', { total: true });
    if (volEnts.length) {
      html += section('Volume by ' + dim);
      volEnts.forEach(k => { const mt = entityMeta(k); html += row(`${mt.label} <span class="period-label" style="display:inline">(${mt.volLabel})</span>`, a => a.ents[k] ? a.ents[k].vol : null, 'count', { cover: a => a.ents[k] }); });
      if (mode === 'state') html += row('Total Therapy Visits', a => a.scope.vol, 'count', { total: true, cover: a => a.scope });
    }
    html += section('Profitability');
    html += row('Gross Profit', a => a.scope.gp, 'currency');
    html += row('Gross Margin %', a => a.scope.gm, 'pct');
    html += row('EBITDA', a => a.scope.ebitda, 'currency');
    html += row('EBITDA Margin %', a => a.scope.ebitda_margin, 'pct');
    html += row('Net Income', a => a.scope.ni, 'currency');
  } else {
    ents.forEach(k => {
      const mt = entityMeta(k);
      html += section(mt.label);
      html += row('Revenue', a => a.ents[k] ? a.ents[k].rev : null, 'currency', { indent: true });
      if (mt.volLabel) {
        html += row(mt.volLabel, a => a.ents[k] ? a.ents[k].vol : null, 'count', { indent: true, cover: a => a.ents[k] });
        html += row('Revenue per ' + mt.unit, a => a.ents[k] ? a.ents[k].rpu : null, 'rpu', { indent: true, cover: a => a.ents[k] });
      }
      html += row('Gross Profit', a => a.ents[k] ? a.ents[k].gp : null, 'currency', { indent: true });
      html += row('Gross Margin %', a => a.ents[k] ? a.ents[k].gm : null, 'pct', { indent: true });
      if (mode === 'state') {
        html += row('EBITDA', a => a.ents[k] ? a.ents[k].ebitda : null, 'currency', { indent: true });
        html += row('EBITDA Margin %', a => a.ents[k] ? a.ents[k].ebitda_margin : null, 'pct', { indent: true });
        html += row('Net Income', a => a.ents[k] ? a.ents[k].ni : null, 'currency', { indent: true });
      }
    });
    html += section(mode === 'line' ? (allLinesActive() ? 'Therapy+ Total' : 'Selected Lines Total') : 'Selected States Total');
    html += row('Total Revenue', a => a.scope.rev, 'currency', { grand: true });
    html += row('Total Gross Profit', a => a.scope.gp, 'currency', { grand: true });
    html += row('Blended Gross Margin %', a => a.scope.gm, 'pct', { grand: true });
    html += row('EBITDA', a => a.scope.ebitda, 'currency', { grand: true });
    html += row('EBITDA Margin %', a => a.scope.ebitda_margin, 'pct', { grand: true });
    html += row('Net Income', a => a.scope.ni, 'currency', { grand: true });
  }
  html += '</tbody></table>';
  card.innerHTML = html;
}

/* ===== Charts ===== */
/* ===== Hover tooltip shared by the charts ===== */
const TIPS = [];   // per-chart arrays of tooltip HTML, one entry per x position
function tipHtml(xLabel, series, i, fmt, compare) {
  let h = `<div class="tip-title">${esc(xLabel)}</div>`;
  const rows = series.map(s => ({ s, v: s.values[i] })).filter(r => r.v != null);
  if (!rows.length) return h + '<div class="tip-row"><span>No data</span></div>';
  rows.forEach(r => { h += `<div class="tip-row"><span class="tip-swatch" style="background:${r.s.color}${r.s.muted ? ';opacity:.45' : ''}"></span><span class="tip-label">${esc(r.s.label)}</span><span class="tip-val">${fmtBy(r.v, fmt)}</span></div>`; });
  if (compare && rows.length >= 2) {
    const a = rows[rows.length - 1], b = rows[rows.length - 2];
    h += `<div class="tip-row tip-delta"><span class="tip-label">${esc(a.s.label)} vs ${esc(b.s.label)}</span><span class="tip-val">${variance(a.v, b.v, fmt)}</span></div>`;
  }
  return h;
}
function registerTips(series, xLabels, fmt, compare) {
  TIPS.push(xLabels.map((l, i) => tipHtml(l, series, i, fmt, compare)));
  return TIPS.length - 1;
}
function showTip(evt, chartId, i) {
  let el = document.getElementById('chartTip');
  if (!el) { el = document.createElement('div'); el.id = 'chartTip'; el.className = 'chart-tip'; document.body.appendChild(el); }
  el.innerHTML = TIPS[chartId][i];
  el.style.display = 'block';
  const pad = 14, r = el.getBoundingClientRect();
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - pad;
  el.style.left = (x + window.scrollX) + 'px';
  el.style.top = (y + window.scrollY) + 'px';
}
function hideTip() { const el = document.getElementById('chartTip'); if (el) el.style.display = 'none'; }
function hoverZones(chartId, n, xStart, slotW, padT, innerH) {
  let z = '';
  for (let i = 0; i < n; i++) z += `<rect class="hover-zone" x="${(xStart + slotW * i).toFixed(1)}" y="${padT}" width="${slotW.toFixed(1)}" height="${innerH}" fill="transparent" onmousemove="showTip(event, ${chartId}, ${i})" onmouseleave="hideTip()"/>`;
  return z;
}

function svgLineChart({ series, xLabels, fmt, height = 300, valueLabels = false, zoom = true, compare = false }) {
  const w = 1100, padL = 70, padR = 20, padT = 20, padB = 44;
  const innerW = w - padL - padR, innerH = height - padT - padB;
  const vals = series.flatMap(s => s.values).filter(v => v != null);
  if (!vals.length) return '<div class="chart-empty">No data for this selection.</div>';
  let maxV = Math.max(...vals), minV = Math.min(...vals);
  // Zoom the axis to the data when every value is positive and the band is narrow; otherwise anchor at zero
  const zoomed = zoom && minV > 0 && (maxV - minV) / maxV < 0.6;
  if (!zoomed) { maxV = Math.max(maxV, 0); minV = Math.min(minV, 0); }
  if (maxV === minV) maxV = minV + 1;
  const span = maxV - minV, mag = Math.pow(10, Math.floor(Math.log10(span))), step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => span / x <= 6) || mag * 10;
  const sub = step / 5;
  const niceMax = Math.ceil(maxV / step) * step, niceMin = Math.floor(minV / sub) * sub;
  const n = xLabels.length;
  const xAt = (i) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v) => padT + innerH - ((v - niceMin) / (niceMax - niceMin)) * innerH;
  let svg = `<svg class="chart-svg" viewBox="0 0 ${w} ${height}" preserveAspectRatio="xMidYMid meet">`;
  for (let v = Math.ceil(niceMin / step - 1e-9) * step; v <= niceMax + 1e-9; v += step) {
    const y = yAt(v);
    svg += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="${Math.abs(v) < 1e-9 ? '#c8ccd3' : '#eef0f3'}" stroke-width="1"/>`;
    svg += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#9aa5b5">${fmtAxis(v, fmt)}</text>`;
  }
  const every = Math.max(1, Math.ceil(n / 14));
  xLabels.forEach((l, i) => { if (i % every === 0 || i === n - 1) svg += `<text x="${xAt(i)}" y="${height - padB + 18}" text-anchor="middle" font-size="11" fill="#5a6878">${esc(l)}</text>`; });
  series.forEach(s => {
    let d = '', pen = false;
    s.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? ' L' : ' M') + xAt(i).toFixed(1) + ' ' + yAt(v).toFixed(1); pen = true; });
    svg += `<path d="${d.trim()}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.5}" ${s.dashed ? 'stroke-dasharray="6 4"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
    s.values.forEach((v, i) => {
      if (v == null) return;
      svg += `<circle cx="${xAt(i)}" cy="${yAt(v)}" r="3.5" fill="${s.color}"/>`;
      if (valueLabels) svg += `<text x="${xAt(i)}" y="${yAt(v) - 9}" text-anchor="middle" font-size="10" fill="${s.color}" font-weight="600">${fmtAxis(v, fmt)}</text>`;
    });
  });
  { const chartId = registerTips(series, xLabels, fmt, compare); const slot = n === 1 ? innerW : innerW / (n - 1); svg += hoverZones(chartId, n, padL - slot / 2, slot, padT, innerH); }
  svg += '</svg>';
  let legend = '<div class="chart-legend">';
  series.forEach(s => { legend += `<div class="legend-item"><div class="swatch" style="background:${s.color}${s.dashed ? ';opacity:.6' : ''}"></div>${esc(s.label)}${s.note ? ` <span style="color:#9aa5b5">${esc(s.note)}</span>` : ''}</div>`; });
  if (zoomed) legend += `<div class="legend-item" style="color:#9aa5b5">Axis starts at ${fmtAxis(niceMin, fmt)}, not zero</div>`;
  legend += '</div>';
  return `<div class="chart-svg-wrap">${svg}</div>${legend}`;
}

/* Grouped bar chart: one group per x label, one bar per series */
function svgBarChart({ series, xLabels, fmt, height = 320, valueLabels = false, compare = false }) {
  const w = 1100, padL = 70, padR = 20, padT = 24, padB = 44;
  const innerW = w - padL - padR, innerH = height - padT - padB;
  const vals = series.flatMap(s => s.values).filter(v => v != null);
  if (!vals.length) return '<div class="chart-empty">No data for this selection.</div>';
  let maxV = Math.max(...vals, 0), minV = Math.min(...vals, 0);
  if (maxV === minV) maxV = minV + 1;
  const span = maxV - minV, mag = Math.pow(10, Math.floor(Math.log10(span))), step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => span / x <= 6) || mag * 10;
  const niceMax = Math.ceil(maxV / step) * step, niceMin = Math.floor(minV / (step / 5)) * (step / 5);
  const n = xLabels.length, k = series.length;
  const groupW = innerW / n, barW = Math.max(2, (groupW * 0.72) / k), gap = groupW * 0.14;
  const yAt = (v) => padT + innerH - ((v - niceMin) / (niceMax - niceMin)) * innerH;
  const y0 = yAt(0);
  let svg = `<svg class="chart-svg" viewBox="0 0 ${w} ${height}" preserveAspectRatio="xMidYMid meet">`;
  for (let v = Math.ceil(niceMin / step - 1e-9) * step; v <= niceMax + 1e-9; v += step) {
    const y = yAt(v);
    svg += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="${Math.abs(v) < 1e-9 ? '#c8ccd3' : '#eef0f3'}" stroke-width="1"/>`;
    svg += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#9aa5b5">${fmtAxis(v, fmt)}</text>`;
  }
  const every = Math.max(1, Math.ceil(n / 14));
  xLabels.forEach((l, i) => { if (i % every === 0 || i === n - 1) svg += `<text x="${padL + groupW * (i + 0.5)}" y="${height - padB + 18}" text-anchor="middle" font-size="11" fill="#5a6878">${esc(l)}</text>`; });
  series.forEach((s, si) => {
    s.values.forEach((v, i) => {
      if (v == null) return;
      const x = padL + groupW * i + gap + si * barW, y = yAt(v);
      const top = Math.min(y, y0), h = Math.max(1, Math.abs(y - y0));
      svg += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${(barW - 1).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${s.color}" opacity="${s.muted ? 0.45 : 1}"/>`;
      if (valueLabels && k === 1) svg += `<text x="${(x + barW / 2).toFixed(1)}" y="${(v >= 0 ? top - 5 : top + h + 12).toFixed(1)}" text-anchor="middle" font-size="10" fill="#5a6878" font-weight="600">${fmtAxis(v, fmt)}</text>`;
    });
  });
  { const chartId = registerTips(series, xLabels, fmt, compare); svg += hoverZones(chartId, n, padL, groupW, padT, innerH); }
  svg += '</svg>';
  let legend = '<div class="chart-legend">';
  series.forEach(s => { legend += `<div class="legend-item"><div class="swatch" style="background:${s.color}${s.muted ? ';opacity:.45' : ''}"></div>${esc(s.label)}${s.note ? ` <span style="color:#9aa5b5">${esc(s.note)}</span>` : ''}</div>`; });
  legend += '</div>';
  return `<div class="chart-svg-wrap">${svg}</div>${legend}`;
}

function chartMonths() {
  if (range === 'all' || periods.length === 0) return MONTHS.slice();
  const idx = periods.flatMap(p => p.months.map(monthIndex));
  let lo = Math.min(...idx), hi = Math.max(...idx);
  if (hi - lo < 11) lo = Math.max(0, hi - 11);          // never narrower than 12 months
  return MONTHS.slice(lo, hi + 1);
}

function renderTrend() {
  const metric = document.getElementById('metricSelect').value, M = METRICS[metric];
  const ents = activeEntities(), months = chartMonths();
  document.getElementById('chartTitle').textContent = M.label + ' Trend by ' + (mode === 'line' ? 'Service Line' : 'State');
  document.getElementById('chartSubtitle').textContent = `${months[0]} to ${months[months.length - 1]} · ${months.length} months · linear scale`;
  const area = document.getElementById('chartArea');
  if (!ents.length) { area.innerHTML = '<div class="chart-empty">Select at least one ' + (mode === 'line' ? 'service line' : 'state') + '.</div>'; return; }
  const series = ents.map(k => ({ label: entityMeta(k).label, color: entityMeta(k).color, values: months.map(m => metricValue(aggEntity([m], k), metric)) }));
  // EBITDA by service line is not reported; explain instead of drawing an empty chart
  if (mode === 'line' && (metric === 'ebitda' || metric === 'ebitda_margin')) {
    if (!allLinesActive()) { area.innerHTML = '<div class="chart-empty">EBITDA is reported for Therapy+ consolidated (all service lines) and by Therapy state. Select all service lines, or switch to State.</div>'; return; }
    const total = { label: 'Therapy+ consolidated', color: '#1a2580', values: months.map(m => metricValue(aggScope([m]), metric)) };
    area.innerHTML = svgLineChart({ series: [total], xLabels: months, fmt: M.fmt });
    return;
  }
  if (!M.ratio && ents.length > 1) series.push({ label: mode === 'line' ? (allLinesActive() ? 'Therapy+ total' : 'Selected total') : 'Selected states total', color: '#1a2580', dashed: true, width: 2, values: months.map(m => metricValue(aggScope([m]), metric)) });
  area.innerHTML = svgLineChart({ series, xLabels: months, fmt: M.fmt, height: 320 });
}

function renderYoy() {
  const metric = document.getElementById('metricSelect').value, M = METRICS[metric];
  const ents = activeEntities();
  const scopeLabel = mode === 'line' ? (allLinesActive() ? 'Therapy+ consolidated' : ents.map(k => LINES[k].label).join(', ')) : ents.map(k => STATES[k].label).join(', ') + ' (Therapy)';
  document.getElementById('chartTitle').textContent = M.label + ' by Month, Year over Year';
  document.getElementById('chartSubtitle').textContent = scopeLabel + (chartType === 'bar' ? ' · one bar per year' : ' · one line per year') + ' · Jan to Dec';
  const area = document.getElementById('chartArea');
  if (!ents.length) { area.innerHTML = '<div class="chart-empty">Select at least one ' + (mode === 'line' ? 'service line' : 'state') + '.</div>'; return; }
  if (mode === 'line' && (metric === 'ebitda' || metric === 'ebitda_margin') && !allLinesActive()) { area.innerHTML = '<div class="chart-empty">EBITDA is reported for Therapy+ consolidated (all service lines) and by Therapy state. Select all service lines, or switch to State.</div>'; return; }
  const years = [...new Set(MONTHS.map(yearOf))].sort();
  const xLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const grid = {};
  years.forEach(y => { grid[y] = xLabels.map((_, mi) => { const k = monthKey(y, mi); return hasMonth(k) ? metricValue(aggScope([k]), metric) : null; }); });
  const series = years.filter(y => grid[y].some(v => v != null)).map((y, i, arr) => {
    const c = YEAR_COLORS[Math.max(0, YEAR_COLORS.length - arr.length + i) % YEAR_COLORS.length];
    const n = grid[y].filter(v => v != null).length;
    return { label: String(y), color: c, width: i === arr.length - 1 ? 3 : 2, values: grid[y], note: n < 12 ? `(${n} mo)` : '' };
  });
  let html = chartType === 'bar' ? svgBarChart({ series, xLabels, fmt: M.fmt, height: 320, compare: true }) : svgLineChart({ series, xLabels, fmt: M.fmt, height: 320, compare: true });
  // table: month rows, one column per year, plus latest-vs-prior change
  const ys = series.map(s => parseInt(s.label, 10));
  html += '<div class="yoy-table"><table><thead><tr><th>Month</th>';
  ys.forEach(y => { html += `<th class="month-col">${y}</th>`; });
  if (ys.length >= 2) html += `<th>Δ ${ys[ys.length - 1]} vs ${ys[ys.length - 2]}</th>`;
  html += '</tr></thead><tbody>';
  xLabels.forEach((l, mi) => {
    html += `<tr><td>${l}</td>`;
    ys.forEach(y => { html += `<td>${fmtBy(grid[y][mi], M.fmt)}</td>`; });
    if (ys.length >= 2) html += `<td class="variance-cell">${variance(grid[ys[ys.length - 1]][mi], grid[ys[ys.length - 2]][mi], M.fmt)}</td>`;
    html += '</tr>';
  });
  if (!M.ratio) {
    // totals over the months the latest year has, applied to every year (like for like)
    const have = grid[ys[ys.length - 1]].map((v, i) => v != null ? i : -1).filter(i => i >= 0);
    const lbl = have.length ? `Total, ${xLabels[have[0]]} to ${xLabels[have[have.length - 1]]} (each year)` : 'Total';
    html += `<tr class="total-row"><td>${lbl}</td>`;
    const tot = ys.map(y => have.reduce((s, i) => s + (grid[y][i] || 0), 0));
    tot.forEach(t => { html += `<td>${fmtBy(t, M.fmt)}</td>`; });
    if (ys.length >= 2) html += `<td class="variance-cell">${variance(tot[tot.length - 1], tot[tot.length - 2], M.fmt)}</td>`;
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  area.innerHTML = html;
}

/* ===== Week over Week (needs a weekly feed in data/weekly_data.csv) ===== */
function weekEntity(wk, k) {
  const d = WEEKLY[wk]; if (!d) return null;
  const e = mode === 'line' ? (d.lines && d.lines[k]) : (d.states && d.states[k]);
  return e || null;
}
function weekScope(wk) {
  const ents = activeEntities(); let rev = 0, gp = 0, vol = 0, any = false, volOk = false, gpOk = false;
  ents.forEach(k => { const e = weekEntity(wk, k); if (!e) return; any = true; rev += e.rev || 0; if (e.gp != null) { gp += e.gp; gpOk = true; } if (e.vol) { vol += e.vol; volOk = true; } });
  if (!any) return null;
  const out = { rev, gp: gpOk ? gp : null, vol: volOk ? vol : null };
  out.gm = (gpOk && rev) ? gp / rev : null; out.rpu = (volOk && rev) ? rev / vol : null;
  return out;
}
const fmtWeek = (iso) => { const [y, m, d] = iso.split('-').map(Number); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1] + ' ' + d + (y !== new Date().getFullYear() ? ' ' + String(y).slice(2) : ''); };
const weekYear = (iso) => parseInt(iso.slice(0, 4), 10);
const weekOrdinal = (iso) => { const [y, m, d] = iso.split('-').map(Number); const t = Date.UTC(y, m - 1, d), j = Date.UTC(y, 0, 1); return Math.floor((t - j) / 86400000 / 7); };

function renderWeekly() {
  const metric = document.getElementById('metricSelect').value, M = METRICS[metric];
  const area = document.getElementById('chartArea');
  const ents = activeEntities();
  document.getElementById('chartTitle').textContent = M.label + ', Week over Week';
  if (!WEEKS.length) {
    document.getElementById('chartSubtitle').textContent = 'No weekly feed loaded';
    area.innerHTML = '<div class="chart-empty">Weekly figures come from a separate feed (data/weekly_data.csv: week ending, scope, revenue, gross profit, volume). The monthly P&amp;L close does not carry weekly detail. Load a weekly export to light this view up.</div>';
    return;
  }
  if (!ents.length) { area.innerHTML = '<div class="chart-empty">Select at least one ' + (mode === 'line' ? 'service line' : 'state') + '.</div>'; return; }
  const nSel = document.getElementById('weeksSelect').value;
  const weeks = nSel === 'all' ? WEEKS.slice() : WEEKS.slice(-parseInt(nSel, 10));
  const scopeLabel = mode === 'line' ? (allLinesActive() ? 'All service lines with weekly data' : ents.map(k => LINES[k].label).join(', ')) : ents.map(k => STATES[k].label).join(', ') + ' (Therapy)';
  document.getElementById('chartSubtitle').textContent = `${scopeLabel} · weeks ending ${fmtWeek(weeks[0])} to ${fmtWeek(weeks[weeks.length - 1])} · ${weeks.length} weeks`;
  const cur = weeks.map(wk => { const a = weekScope(wk); return a ? a[metric] : null; });
  // same week last year, matched by week ordinal within the calendar year
  const byOrd = {}; WEEKS.forEach(wk => { byOrd[weekYear(wk) + ':' + weekOrdinal(wk)] = wk; });
  const ly = weeks.map(wk => { const p = byOrd[(weekYear(wk) - 1) + ':' + weekOrdinal(wk)]; const a = p ? weekScope(p) : null; return a ? a[metric] : null; });
  const hasLY = ly.some(v => v != null);
  const xLabels = weeks.map(fmtWeek);
  const series = [];
  if (hasLY) series.push({ label: 'Same week last year', color: '#9aa5b5', muted: true, values: ly });
  series.push({ label: 'This year', color: '#0020F0', values: cur });
  let html = chartType === 'bar' ? svgBarChart({ series, xLabels, fmt: M.fmt, height: 320, valueLabels: !hasLY && weeks.length <= 26, compare: true })
                                 : svgLineChart({ series, xLabels, fmt: M.fmt, height: 320, compare: true });
  // table, newest first
  html += '<div class="yoy-table"><table><thead><tr><th>Week ending</th>';
  ents.forEach(k => { html += `<th class="month-col">${esc(entityMeta(k).label)}</th>`; });
  html += `<th class="month-col">Total</th><th>Δ vs prior week</th>${hasLY ? '<th>Δ vs same week LY</th>' : ''}</tr></thead><tbody>`;
  for (let i = weeks.length - 1; i >= 0; i--) {
    const wk = weeks[i];
    html += `<tr><td>${esc(fmtWeek(wk))}</td>`;
    ents.forEach(k => { const e = weekEntity(wk, k); let v = null; if (e) { v = metric === 'gm' ? (e.gp != null && e.rev ? e.gp / e.rev : null) : metric === 'rpu' ? (e.vol && e.rev ? e.rev / e.vol : null) : e[metric]; } html += `<td>${fmtBy(v, M.fmt)}</td>`; });
    const prev = i > 0 ? cur[i - 1] : (WEEKS.indexOf(wk) > 0 ? (weekScope(WEEKS[WEEKS.indexOf(wk) - 1]) || {})[metric] : null);
    html += `<td><strong>${fmtBy(cur[i], M.fmt)}</strong></td><td class="variance-cell">${variance(cur[i], prev == null ? null : prev, M.fmt)}</td>`;
    if (hasLY) html += `<td class="variance-cell">${variance(cur[i], ly[i], M.fmt)}</td>`;
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  area.innerHTML = html;
}

/* ===== Init ===== */
initLoader();
detectBackend().then(() => { applyLoadedMonths(); buildPicker(); applyPreset('latest'); });
buildPicker();
syncChips();
applyPreset('latest');
