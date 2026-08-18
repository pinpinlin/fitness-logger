import { PART_ORDER, partsLabel, fileName, buildMd, hiitTotalSeconds, fmtDuration } from './lib/format.js';
import { newSession, addEntry, addSet, removeSet, adjustWeight, adjustReps, commitHistory,
  toggleSupersetWithPrev, addSetToGroup, nextGroupTag, restampDate } from './lib/session.js';
import * as store from './lib/storage.js';

const app = document.getElementById('app');
let exercises = [], byPart = {}, exByName = {};
let blocks = { summary: '', hiitSummary: '', cardioSummary: '' };
let pastLogs = [];          // history.json：過去場次（新→舊）
let histOpen = null;        // 歷史頁展開中的場次索引
let histScreen = false;     // 歷史頁開啟中（獨立於 session，未開始訓練也能看）
let history = {}, prefs = {};
let session = null;
let setupParts = [];
let search = '', hiitSearch = '';
let sgMode = false, sgSel = [];   // 選動作頁的超級組圈選模式
let idc = 1;
let pendingResume = false;

const saveSoon = debounce(() => { if (session) store.saveSession(session); }, 300);
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

function todayISO() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = v => (v === null || v === undefined || v === '') ? '' : v;

async function boot() {
  try {
    const [ex, sb, hb, cb, hist] = await Promise.all([
      fetch('exercises.json').then(r => r.json()),
      fetch('summary-block.txt').then(r => r.text()),
      fetch('summary-hiit-block.txt').then(r => r.text()).catch(() => ''),
      fetch('summary-cardio-block.txt').then(r => r.text()).catch(() => ''),
      fetch('history.json').then(r => r.json()).catch(() => [])
    ]);
    exercises = ex; blocks = { summary: sb, hiitSummary: hb, cardioSummary: cb }; pastLogs = hist;
  } catch (e) {
    app.innerHTML = `<div class="card">載入動作資料失敗，請確認連線後重開。<br><span class="muted small">${esc(e.message)}</span></div>`;
    return;
  }
  byPart = {}; for (const p of PART_ORDER) byPart[p] = [];
  exByName = {};
  for (const e of exercises) { (byPart[e.部位] || (byPart[e.部位] = [])).push(e); exByName[e.name] = e; }

  history = store.loadHistory();
  prefs = store.loadPrefs();
  session = store.loadSession();
  if (session) {
    migrate(session);
    if (restampDate(session, todayISO())) store.saveSession(session);
  }
  pendingResume = !!(session && hasContent(session));
  render();
  startTicker();
}

// 舊 session（計畫二）補上新欄位
function migrate(s) {
  if (!s.entries) s.entries = [];
  if (s.hiit === undefined) s.hiit = null;
  if (!s.cardio) s.cardio = [];
  if (s.run === undefined) s.run = null;
}
const hasContent = s => (s.entries || []).length || (s.hiit && (s.hiit.items || []).length) || (s.cardio || []).length;
const typeOf = e => (e && e.型態) ? e.型態 : ['重訓'];
const poolOf = t => exercises.filter(e => typeOf(e).includes(t));

// 檔名/frontmatter 用的部位＝重訓勾選 ∪ HIIT 動作 ∪ 有氧項目 的部位
function derivedParts(s) {
  const set = new Set(s.parts || []);
  for (const it of (s.hiit ? s.hiit.items : []) || []) { const e = exByName[it.name]; if (e) set.add(e.部位); }
  for (const c of s.cardio || []) { const e = exByName[c.name]; if (e) set.add(e.部位); }
  return PART_ORDER.filter(p => set.has(p));
}
const exportSession = () => ({ ...session, parts: derivedParts(session) });

/* ---------- render ---------- */
function render() {
  if (histScreen) return renderHistory();
  if (pendingResume) return renderResume();
  if (!session) return renderSetup();
  switch (session.screen) {
    case 'PARTS': return renderParts();
    case 'PICK': return renderPick();
    case 'LOG': return renderLog();
    case 'HIIT_SETUP': return renderHiitSetup();
    case 'HIIT_RUN': return renderHiitRun();
    case 'CARDIO_PICK': return renderCardioPick();
    case 'REVIEW': return renderReview();
    case 'EXPORT': return renderExport();
    default: return renderSetup();
  }
}

function renderResume() {
  const label = partsLabel(derivedParts(session)) || '—';
  const n = (session.entries || []).length + ((session.hiit && session.hiit.items) || []).length + (session.cardio || []).length;
  app.className = '';
  app.innerHTML = `
    <h1>有未完成的紀錄</h1>
    <p class="sub">${esc(session.date)} · ${esc(label)} · ${n} 個項目</p>
    <div class="row"><button class="primary" data-act="resume">繼續這場</button>
      <button class="ghost" data-act="discard">開始新的一場</button></div>`;
}

// 模式選擇
function renderSetup() {
  app.className = '';
  app.innerHTML = `
    <h1>今天練什麼</h1>
    <p class="sub">${todayISO()} · 選訓練型態</p>
    <div class="mode-grid">
      <div class="chip mode" data-act="mode" data-m="重訓"><b>重訓</b><span>重量 × 次數</span></div>
      <div class="chip mode" data-act="mode" data-m="HIIT"><b>HIIT</b><span>計時循環</span></div>
      <div class="chip mode" data-act="mode" data-m="有氧"><b>有氧</b><span>時間／距離</span></div>
    </div>
    <div class="row"><button class="ghost" data-act="histOpen" style="width:100%">📖 看過去紀錄（${pastLogs.length} 場）</button></div>`;
}

function renderParts() {
  app.className = 'hasbar';
  const chips = PART_ORDER.map(p =>
    `<div class="chip ${setupParts.includes(p) ? 'on' : ''}" data-act="togglePart" data-part="${p}">${p}</div>`).join('');
  app.innerHTML = `
    <h1>重訓部位</h1>
    <p class="sub">${esc(session.date)} · 勾選部位（可多選）</p>
    <div class="part-grid">${chips}</div>
    <div class="bottombar">
      <button class="ghost" data-act="toHub">← 返回</button>
      <button class="primary" data-act="partsDone" ${setupParts.length ? '' : 'disabled'}>選動作（${partsLabel(setupParts) || '—'}）</button>
    </div>`;
}

function renderPick() {
  app.className = 'hasbar';
  const term = search.trim();
  const picked = sgMode ? new Set(sgSel) : new Set(session.entries.map(e => e.name));
  const pool = poolOf('重訓');
  let body = '';
  if (term) {
    body = `<div class="sec-title">搜尋結果</div>${exRows(pool.filter(e => (e.name + e.區域 + e.動作型).includes(term)), picked)}`;
  } else {
    for (const p of session.parts) body += `<div class="sec-title">${p}</div>${exRows(pool.filter(e => e.部位 === p), picked)}`;
  }
  app.innerHTML = `
    <h1>選動作</h1>
    <p class="sub">${sgMode
      ? `🔗 圈選模式：依序點 2~3 個動作組成超級組（已選 ${sgSel.length}）`
      : `${esc(partsLabel(session.parts))} · 點選加入`}</p>
    <input data-inp="search" placeholder="搜尋動作名／區域／動作型…" value="${esc(search)}">
    <div id="picklist">${body}</div>
    <div class="bottombar">
      ${sgMode
        ? `<button class="ghost" data-act="sgCancel">取消</button>
           <button class="primary" data-act="sgConfirm" ${sgSel.length >= 2 ? '' : 'disabled'}>組成超級組（${sgSel.length}）</button>`
        : `<button class="ghost tiny" data-act="toParts">改部位</button>
           <button class="ghost tiny" data-act="sgStart">🔗 超級組</button>
           <button class="primary" data-act="toLog" ${session.entries.length ? '' : 'disabled'}>去記錄（${session.entries.length}）</button>`}
    </div>`;
}
// picked：Set（單選語義，點second次＝移除）或 Map name→次數（可重複，點擊＝再加一個）
function exRows(list, picked) {
  if (!list.length) return `<p class="muted small">（無）</p>`;
  const isMap = picked instanceof Map;
  return list.map(e => {
    const n = isMap ? (picked.get(e.name) || 0) : (picked.has(e.name) ? 1 : 0);
    const badge = n ? `<span class="meta">${isMap ? '×' + n : '✓'}</span>` : (isMap ? '<span class="meta">＋</span>' : '');
    return `<div class="ex-item ${n ? 'on' : ''}" data-act="pickEx" data-name="${esc(e.name)}">
      <span>${esc(e.name)}</span><span class="spacer"></span>
      <span class="meta">${esc(e.區域 || e.型式)}</span>${badge}</div>`;
  }).join('');
}

// 該動作最重（歷史 baked ＋ 本機上次 ＋ 本場即時 取最大）
function bestLabel(name, currentSets) {
  let best = null;
  const consider = (w, r) => {
    if (r === null || r === undefined || r === '') return;
    const ww = (w === null || w === undefined || w === '') ? 0 : Number(w);
    const rr = Number(r) || 0;
    if (!best || ww > best.w || (ww === best.w && rr > best.r)) best = { w: ww, r: rr };
  };
  const ex = exByName[name];
  if (ex && ex.best) { const m = ex.best.match(/^(自重|[\d.]+)×(\d+)/); if (m) consider(m[1] === '自重' ? null : parseFloat(m[1]), parseInt(m[2])); }
  const h = history[name]; if (h && h.sets) h.sets.forEach(s => consider(s.weight, s.reps));
  (currentSets || []).forEach(s => consider(s.weight, s.reps));
  if (!best) return null;
  return best.w ? `${best.w}×${best.r}` : `自重×${best.r}`;
}

/* ---------- LOG（本場 hub）---------- */
function renderLog() {
  app.className = 'hasbar';
  // 依「相鄰且同 sg」分群：超級組包成一個外框、共用整輪加組
  const groups = [];
  session.entries.forEach((e, ei) => {
    const last = groups[groups.length - 1];
    if (e.sg && last && last.sg === e.sg) last.idx.push(ei);
    else groups.push({ sg: e.sg || null, idx: [ei] });
  });
  const liftCards = groups.map(g => {
    const inner = g.idx.map(ei => {
      const e = session.entries[ei];
      const bl = bestLabel(e.name, e.sets);
      const ex = exByName[e.name];
      const lastLine = (ex && ex.lastSets)
        ? `<div class="lastsets">上次 <span class="lsdate">${esc((ex.lastDate || '').slice(5))}</span> ${esc(ex.lastSets)}</div>` : '';
      const canLink = ei > 0;
      return `<div class="card${g.sg ? ' ingroup' : ''}">
        <div class="row"><b>${esc(e.name)}</b><span class="spacer"></span>
          <span class="meta muted small">${esc(e.型式)}</span>
          ${canLink ? `<button class="tiny ${e.sg ? 'linked' : 'ghost'}" data-act="sgToggle" data-e="${ei}" title="與上一個動作連成超級組">🔗</button>` : ''}
          <button class="tiny ghost" data-act="rmEntry" data-name="${esc(e.name)}">✕</button></div>
        ${bl ? `<div class="best">最重 ${esc(bl)}</div>` : ''}
        ${lastLine}
        ${e.sets.map((s, si) => setBlock(e, ei, s, si)).join('')}
        ${g.sg ? '' : `<div class="row srow" style="margin-top:6px"><button class="tiny" data-act="addSet" data-e="${ei}">＋ 加一組</button></div>`}
        <input class="note-input" data-inp="note" data-e="${ei}" placeholder="動作備註（座椅高度／體感…）" value="${esc(e.note)}">
      </div>`;
    }).join('');
    if (!g.sg) return inner;
    return `<div class="sgbox">
      <div class="sghead">超級組 ${g.sg} · 中間不休息</div>
      ${inner}
      <div class="row srow" style="margin-top:2px"><button class="tiny primary" data-act="addSetGroup" data-e="${g.idx[0]}">＋ 加一輪（全部動作）</button></div>
    </div>`;
  }).join('');

  let hiitCard = '';
  if (session.hiit && session.hiit.items.length) {
    const p = session.hiit.params;
    const total = fmtDuration(hiitTotalSeconds(p, session.hiit.items.length));
    hiitCard = `<div class="card">
      <div class="row"><b>🔥 HIIT</b><span class="spacer"></span>
        <button class="tiny" data-act="hiitEdit">設定</button>
        <button class="tiny ghost" data-act="hiitClear">✕</button></div>
      <div class="best">每項 ${p.workSec}s ｜ 休 ${p.restSec}s ｜ ${p.rounds} 輪 ｜ 輪休 ${p.roundRestSec}s ｜ 總 ${total}</div>
      ${session.hiit.items.map((it, i) => `<div class="setblk">
        <div class="row srow"><span class="spacer">${esc(it.name)}</span>
          <button class="step" data-act="hiitRound" data-i="${i}" data-d="-1">−</button>
          <input inputmode="numeric" data-inp="hiitRound" data-i="${i}" value="${num(it.doneRounds)}" style="max-width:56px;text-align:center">
          <button class="step" data-act="hiitRound" data-i="${i}" data-d="1">＋</button>
          <span class="unit">輪</span></div>
        <div class="row srow"><span class="muted small" style="width:34px">負重</span>
          <button class="step" data-act="hiitLoad" data-i="${i}" data-d="-2.5">−</button>
          <input inputmode="decimal" data-inp="hiitLoad" data-i="${i}" value="${num(it.load)}" placeholder="徒手">
          <button class="step" data-act="hiitLoad" data-i="${i}" data-d="2.5">＋</button>
          <span class="unit">kg</span></div>
      </div>`).join('')}
      <div class="row srow" style="margin-top:6px"><button class="tiny primary" data-act="hiitRun">▶ 開始導引</button></div>
    </div>`;
  }

  const cardioCards = (session.cardio || []).map((c, ci) => `<div class="card">
      <div class="row"><b>🏃 ${esc(c.name)}</b><span class="spacer"></span>
        <button class="tiny ghost" data-act="rmCardio" data-c="${ci}">✕</button></div>
      <div class="row srow"><span class="muted small" style="width:34px">時間</span>
        <input inputmode="numeric" data-inp="cMin" data-c="${ci}" value="${num(c.minutes)}" placeholder="分"><span class="unit">分</span></div>
      <div class="row srow"><span class="muted small" style="width:34px">距離</span>
        <input inputmode="decimal" data-inp="cKm" data-c="${ci}" value="${num(c.km)}" placeholder="選填"><span class="unit">km</span></div>
      <div class="row srow"><span class="muted small" style="width:34px">強度</span>
        <input data-inp="cInt" data-c="${ci}" value="${esc(c.intensity || '')}" placeholder="如 8.5km/h 坡3、阻力12"></div>
    </div>`).join('');

  const empty = !hasContent(session) ? '<p class="muted">尚無內容，用下方按鈕加入。</p>' : '';
  app.innerHTML = `
    <div class="row"><h1 style="margin:4px 0 2px">記錄</h1><span class="spacer"></span>
      <button class="tiny ghost" data-act="histOpen">📖 過去紀錄</button></div>
    <p class="sub">${esc(session.date)} · ${esc(partsLabel(derivedParts(session)) || '—')}</p>
    <div id="timer"></div>
    ${liftCards}${hiitCard}${cardioCards}${empty}
    <div class="bottombar">
      <button class="ghost tiny" data-act="addLift">＋重訓</button>
      <button class="ghost tiny" data-act="addHiit">＋HIIT</button>
      <button class="ghost tiny" data-act="addCardio">＋有氧</button>
      <button class="primary" data-act="toReview" ${hasContent(session) ? '' : 'disabled'}>完成</button>
    </div>`;
  renderTimer();
}
function setBlock(e, ei, s, si) {
  return `<div class="setblk">
    <div class="row srow">
      <span class="setno">${si + 1}</span>
      <button class="step" data-act="w" data-e="${ei}" data-s="${si}" data-d="-2.5">−</button>
      <input inputmode="decimal" data-inp="w" data-e="${ei}" data-s="${si}" value="${num(s.weight)}" placeholder="自重">
      <button class="step" data-act="w" data-e="${ei}" data-s="${si}" data-d="2.5">＋</button>
      <span class="unit">kg</span></div>
    <div class="row srow">
      <span class="setno"></span>
      <button class="step" data-act="r" data-e="${ei}" data-s="${si}" data-d="-1">−</button>
      <input inputmode="numeric" data-inp="r" data-e="${ei}" data-s="${si}" value="${num(s.reps)}" placeholder="次">
      <button class="step" data-act="r" data-e="${ei}" data-s="${si}" data-d="1">＋</button>
      <span class="unit">RPE</span>
      <input inputmode="decimal" data-inp="rpe" data-e="${ei}" data-s="${si}" value="${num(s.rpe)}" placeholder="–" style="max-width:52px">
      <button class="tiny ghost" data-act="rmSet" data-e="${ei}" data-s="${si}">✕</button></div>
  </div>`;
}

/* ---------- HIIT 設定 ---------- */
const hiitCounts = () => {
  const m = new Map();
  for (const it of session.hiit.items) m.set(it.name, (m.get(it.name) || 0) + 1);
  return m;
};

function renderHiitSetup() {
  app.className = 'hasbar';
  const h = session.hiit;
  const picked = hiitCounts();
  const term = hiitSearch.trim();
  const pool = poolOf('HIIT');
  let list = '';
  if (term) {
    list = `<div class="sec-title">搜尋結果</div>${exRows(pool.filter(e => (e.name + e.區域 + e.動作型).includes(term)), picked)}`;
  } else {
    for (const p of PART_ORDER) {
      const g = pool.filter(e => e.部位 === p);
      if (g.length) list += `<div class="sec-title">${p}</div>${exRows(g, picked)}`;
    }
  }
  const p = h.params;
  const total = h.items.length ? fmtDuration(hiitTotalSeconds(p, h.items.length)) : '—';
  const paramRow = (label, key, step, unit) => `<div class="row srow">
      <span class="muted small" style="width:56px">${label}</span>
      <button class="step" data-act="hp" data-k="${key}" data-d="-${step}">−</button>
      <input inputmode="numeric" data-inp="hp" data-k="${key}" value="${p[key]}" style="text-align:center">
      <button class="step" data-act="hp" data-k="${key}" data-d="${step}">＋</button>
      <span class="unit">${unit}</span></div>`;
  app.innerHTML = `
    <h1>HIIT 設定</h1>
    <p class="sub">已選 ${h.items.length} 個動作 ｜ 預估總時長 ${total}</p>
    <div class="card">
      ${paramRow('每項', 'workSec', 5, '秒')}
      ${paramRow('項間休', 'restSec', 5, '秒')}
      ${paramRow('輪數', 'rounds', 1, '輪')}
      ${paramRow('輪間休', 'roundRestSec', 15, '秒')}
    </div>
    ${h.items.length ? `<div class="sec-title">本場順序（可重複加入同動作、設不同負重）</div>` +
      h.items.map((it, i) => `<div class="card" style="padding:8px 10px">
        <div class="row srow"><span class="setno">${i + 1}</span><span class="spacer">${esc(it.name)}</span>
          <button class="tiny ghost" data-act="hiitDel" data-i="${i}">✕</button></div>
        <div class="row srow"><span class="muted small" style="width:34px">負重</span>
          <button class="step" data-act="hiitLoad" data-i="${i}" data-d="-2.5">−</button>
          <input inputmode="decimal" data-inp="hiitLoad" data-i="${i}" value="${num(it.load)}" placeholder="徒手">
          <button class="step" data-act="hiitLoad" data-i="${i}" data-d="2.5">＋</button>
          <span class="unit">kg</span></div>
      </div>`).join('') : ''}
    <input data-inp="hiitSearch" placeholder="搜尋 HIIT 動作…" value="${esc(hiitSearch)}" style="margin-top:10px">
    <div id="hiitlist">${list}</div>
    <div class="bottombar">
      <button class="ghost" data-act="toHub">← 返回</button>
      <button class="primary" data-act="hiitRun" ${h.items.length ? '' : 'disabled'}>▶ 開始導引</button>
    </div>`;
}

/* ---------- HIIT 導引 ---------- */
const PHASE = { work: { label: '運動', cls: 'run-work' }, itemRest: { label: '項間休息', cls: 'run-rest' }, roundRest: { label: '輪間休息', cls: 'run-round' }, done: { label: '完成', cls: 'run-done' } };

function renderHiitRun() {
  const r = session.run, h = session.hiit;
  if (!r || !h) { session.screen = 'LOG'; return render(); }
  app.className = 'run ' + (PHASE[r.phase] ? PHASE[r.phase].cls : '');
  if (r.phase === 'done') {
    app.innerHTML = `<div class="runbox">
      <div class="runphase">完成 🎉</div>
      <div class="runname">${h.items.length} 動作 × ${h.params.rounds} 輪</div>
      <div class="runbig">${fmtDuration(hiitTotalSeconds(h.params, h.items.length))}</div>
      <button class="primary" data-act="runFinish">回記錄</button></div>`;
    return;
  }
  const left = leftSec(r);
  const cur = h.items[r.idx];
  const next = peekNext(r, h);
  const loadTag = l => (l !== null && l !== undefined && l !== '') ? ` <span class="runload">${l}kg</span>` : '';
  app.innerHTML = `<div class="runbox">
    <div class="runphase">${PHASE[r.phase].label} ｜ 第 ${r.round}/${h.params.rounds} 輪 ｜ ${r.idx + 1}/${h.items.length}</div>
    <div class="runname">${r.phase === 'work' ? esc(cur.name) + loadTag(cur.load) : '休息'}</div>
    <div class="runbig" id="runbig">${left}</div>
    ${next ? `<div class="runnextlabel">下一個</div><div class="runnext">${esc(next.name)}${loadTag(next.load)}</div>`
      : '<div class="runnextlabel">最後一段</div>'}
    ${r.paused ? '<div class="runpaused">已暫停 · 點畫面繼續</div>' : '<div class="runtip">點畫面可暫停</div>'}
    <div class="row" style="justify-content:center;gap:8px;margin-top:14px">
      <button class="tiny" data-act="runSkip">跳過本段</button>
      <button class="tiny ghost" data-act="runStop">結束</button>
    </div>
    ${r.noWakeLock ? '<div class="runhint">螢幕可能自動鎖定：建議調長「自動鎖定」時間</div>' : ''}
  </div>`;
}
function leftSec(r) {
  if (r.paused) return Math.max(0, Math.ceil(r.pausedLeft / 1000));
  return Math.max(0, Math.ceil((r.phaseEndAt - Date.now()) / 1000));
}
// 回傳下一個「運動」項目物件（含 load），無則 null
function peekNext(r, h) {
  if (r.phase === 'work') return r.idx < h.items.length - 1 ? h.items[r.idx + 1] : (r.round < h.params.rounds ? h.items[0] : null);
  if (r.phase === 'itemRest') return h.items[r.idx + 1] || null;
  if (r.phase === 'roundRest') return h.items[0] || null;
  return null;
}
function phaseSeconds(phase) {
  const p = session.hiit.params;
  return phase === 'work' ? +p.workSec : phase === 'itemRest' ? +p.restSec : +p.roundRestSec;
}
function startRun() {
  const h = session.hiit;
  session.run = { round: 1, idx: 0, phase: 'work', phaseEndAt: Date.now() + phaseSeconds('work') * 1000, paused: false, pausedLeft: 0, beeped: -1, noWakeLock: false };
  session.screen = 'HIIT_RUN';
  initAudio(); requestWake();
  store.saveSession(session); render();
}
// 推進到下一段；回傳是否結束
function advance() {
  const r = session.run, h = session.hiit, n = h.items.length, R = +h.params.rounds;
  if (r.phase === 'work') {
    if (r.idx < n - 1) r.phase = +h.params.restSec > 0 ? 'itemRest' : 'workNext';
    else if (r.round < R) r.phase = +h.params.roundRestSec > 0 ? 'roundRest' : 'roundNext';
    else { finishRun(true); return; }
    if (r.phase === 'workNext') { r.idx++; r.phase = 'work'; }
    if (r.phase === 'roundNext') { r.round++; r.idx = 0; r.phase = 'work'; }
  } else if (r.phase === 'itemRest') { r.idx++; r.phase = 'work'; }
  else if (r.phase === 'roundRest') { r.round++; r.idx = 0; r.phase = 'work'; }
  r.phaseEndAt = Date.now() + phaseSeconds(r.phase) * 1000;
  r.beeped = -1;
  beep(r.phase === 'work' ? 880 : 440, 0.18);
  render();
}
function togglePause() {
  const r = session.run; if (!r) return;
  if (r.paused) { r.phaseEndAt = Date.now() + r.pausedLeft; r.paused = false; }
  else { r.pausedLeft = Math.max(0, r.phaseEndAt - Date.now()); r.paused = true; }
  render();
}

function finishRun(completed) {
  const r = session.run, h = session.hiit;
  const done = completed ? +h.params.rounds : Math.max(0, r.round - 1);
  h.items.forEach(it => { it.doneRounds = done; });
  r.phase = 'done';
  releaseWake();
  beep(1200, 0.3); setTimeout(() => beep(1200, 0.3), 220);
  store.saveSession(session); render();
}

/* 音效 */
let actx = null;
function initAudio() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch { actx = null; }
}
function beep(freq, dur) {
  if (!actx) return;
  try {
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = freq; o.type = 'sine';
    g.gain.setValueAtTime(0.001, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.35, actx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime + dur + 0.02);
  } catch { /* 忽略 */ }
}
/* Wake Lock */
let wakeLock = null;
async function requestWake() {
  try {
    if ('wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); }
    else if (session.run) session.run.noWakeLock = true;
  } catch { if (session.run) session.run.noWakeLock = true; }
}
function releaseWake() { try { wakeLock && wakeLock.release(); } catch {} wakeLock = null; }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session && session.screen === 'HIIT_RUN' && session.run && session.run.phase !== 'done') requestWake();
});

/* ---------- 有氧 ---------- */
function renderCardioPick() {
  app.className = 'hasbar';
  const picked = new Set((session.cardio || []).map(c => c.name));
  const pool = poolOf('有氧');
  app.innerHTML = `
    <h1>選有氧項目</h1>
    <p class="sub">點選加入本場</p>
    ${exRows(pool, picked)}
    <div class="bottombar">
      <button class="ghost" data-act="toHub">← 返回</button>
      <button class="primary" data-act="toLog">去記錄（${(session.cardio || []).length}）</button>
    </div>`;
}

/* ---------- 歷史紀錄 ---------- */
function renderHistory() {
  app.className = 'hasbar';
  const rows = pastLogs.map((s, i) => {
    const open = histOpen === i;
    const counts = { 重訓: 0, HIIT: 0, 有氧: 0 };
    (s.items || []).forEach(it => { counts[it.型態] = (counts[it.型態] || 0) + 1; });
    const tags = Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${k}${n}`).join('·');
    const body = !open ? '' : `<div class="histbody">
      ${(s.items || []).map(it => {
        if (it.型態 === '重訓') return `<div class="histitem"><b>${esc(it.name)}</b>${it.超級組 ? ` <span class="sgtag">超${esc(it.超級組)}</span>` : ''}<div class="histsets">${esc(it.組)}</div>${it.備註 ? `<div class="histnote">${esc(it.備註)}</div>` : ''}</div>`;
        if (it.型態 === 'HIIT') return `<div class="histitem"><b>🔥 ${esc(it.name)}</b><div class="histsets">完成 ${esc(it.完成 || '-')}${it.負重 ? ` ｜ 負重 ${esc(it.負重)}` : ''}</div></div>`;
        return `<div class="histitem"><b>🏃 ${esc(it.name)}</b><div class="histsets">${[it.時間, it.距離, it.強度].filter(Boolean).map(esc).join(' ｜ ')}</div></div>`;
      }).join('')}
      ${s.hiitParams ? `<div class="histnote">HIIT：每項 ${s.hiitParams.HIIT每項秒}s ｜ 休 ${s.hiitParams.HIIT項間休}s ｜ ${s.hiitParams.HIIT輪數} 輪 ｜ 輪休 ${s.hiitParams.HIIT輪間休}s</div>` : ''}
      ${s.note ? `<div class="histnote">💬 ${esc(s.note)}</div>` : ''}
    </div>`;
    return `<div class="card" style="padding:9px 11px">
      <div class="row" data-act="histToggle" data-i="${i}" style="cursor:pointer">
        <b>${esc(s.date)}</b><span class="meta" style="margin-left:8px">${esc(s.label)}</span>
        <span class="spacer"></span><span class="meta muted small">${esc(tags)}</span>
        <span class="meta">${open ? '▲' : '▼'}</span></div>
      ${body}</div>`;
  }).join('');
  app.innerHTML = `
    <h1>訓練紀錄</h1>
    <p class="sub">${pastLogs.length} 場（新→舊）· 點日期展開</p>
    ${rows || '<p class="muted">尚無紀錄</p>'}
    <div class="bottombar"><button class="ghost" data-act="histBack">← 返回</button></div>`;
}

function renderReview() {
  app.className = 'hasbar';
  app.innerHTML = `
    <h1>全場心得</h1>
    <p class="sub"><input type="date" data-inp="date" value="${esc(session.date)}"> · ${esc(partsLabel(derivedParts(session)) || '—')}</p>
    <textarea data-inp="overall" placeholder="整體感受、今天狀態…（會寫進 log 的體感/心得）">${esc(session.overallNote)}</textarea>
    <div class="bottombar">
      <button class="ghost" data-act="toLog">← 回記錄</button>
      <button class="primary" data-act="toExport">產生 .md</button>
    </div>`;
}

function renderExport() {
  app.className = 'hasbar';
  const s = exportSession();
  const md = buildMd(s, blocks);
  const name = fileName(s);
  app.innerHTML = `
    <h1>存檔</h1>
    <p class="sub">${esc(name)} → 存到 OneDrive / 00_Inbox</p>
    <pre class="md">${esc(md)}</pre>
    <div class="row wrap" style="margin-top:10px">
      <button class="tiny ghost" data-act="copy">複製全文</button>
      <span class="muted small">若「儲存到檔案」失敗，改用複製 → 貼到檔案 App 存成 ${esc(name)}</span>
    </div>
    <div class="bottombar">
      <button class="ghost" data-act="toReview">← 心得</button>
      <button class="primary" data-act="save">儲存到檔案</button>
    </div>`;
}

/* ---------- ticker：組間倒數 ＋ HIIT 導引 ---------- */
let ticker = null;
function startTicker() { if (!ticker) ticker = setInterval(tick, 250); }
function tick() {
  if (session && session.screen === 'HIIT_RUN' && session.run && session.run.phase !== 'done' && !session.run.paused) {
    const r = session.run;
    const left = Math.ceil((r.phaseEndAt - Date.now()) / 1000);
    if (left <= 0) { advance(); return; }
    if (left <= 3 && r.beeped !== left) { r.beeped = left; beep(660, 0.08); }
    const el = document.getElementById('runbig');
    if (el) el.textContent = Math.max(0, left);
    return;
  }
  renderTimer();
}
function renderTimer() {
  const el = document.getElementById('timer');
  if (!el || !session) return;
  if (!session.restEndAt) { el.innerHTML = ''; return; }
  const left = Math.round((session.restEndAt - Date.now()) / 1000);
  if (left <= 0) {
    el.innerHTML = `<div class="timer"><span class="t" style="color:var(--good)">休息結束</span><span class="spacer"></span>
      <button class="tiny" data-act="restClear">關閉</button></div>`;
    return;
  }
  const m = Math.floor(left / 60), s = String(left % 60).padStart(2, '0');
  el.innerHTML = `<div class="timer"><span class="t">${m}:${s}</span>
    <span class="muted small">組間休息</span><span class="spacer"></span>
    <button class="tiny" data-act="rest30">+30</button>
    <button class="tiny" data-act="restClear">跳過</button></div>`;
}

/* ---------- events ---------- */
app.addEventListener('click', onClick);
app.addEventListener('input', onInput);

const entryOf = t => session.entries[+t.dataset.e];
const setOf = t => session.entries[+t.dataset.e].sets[+t.dataset.s];
function ensureSession() { if (!session) { session = newSession(todayISO(), [], prefs.restDefault || 90); migrate(session); } }
function goto(screen) { session.screen = screen; store.saveSession(session); render(); }

function onClick(ev) {
  const t = ev.target.closest('[data-act]');
  // HIIT 導引中：點畫面空白處＝暫停／繼續（按鈕除外）
  if (!t && session && session.screen === 'HIIT_RUN' && session.run && session.run.phase !== 'done') {
    togglePause(); return;
  }
  if (!t) return;
  const act = t.dataset.act;
  switch (act) {
    case 'resume': pendingResume = false; render(); return;
    case 'discard': store.clearSession(); session = null; pendingResume = false; setupParts = []; render(); return;

    case 'mode': {
      ensureSession();
      const m = t.dataset.m;
      if (m === '重訓') { setupParts = [...(session.parts || [])]; goto('PARTS'); }
      else if (m === 'HIIT') { ensureHiit(); goto('HIIT_SETUP'); }
      else { goto('CARDIO_PICK'); }
      return;
    }
    case 'togglePart': {
      const p = t.dataset.part;
      setupParts = setupParts.includes(p) ? setupParts.filter(x => x !== p) : [...setupParts, p];
      render(); return;
    }
    case 'partsDone': session.parts = [...setupParts]; search = ''; goto('PICK'); return;
    case 'toParts': setupParts = [...session.parts]; goto('PARTS'); return;
    case 'toHub': goto(hasContent(session) ? 'LOG' : 'SETUP'); return;
    case 'addLift': setupParts = [...(session.parts || [])]; goto(session.parts && session.parts.length ? 'PICK' : 'PARTS'); return;
    case 'addHiit': ensureHiit(); goto('HIIT_SETUP'); return;
    case 'addCardio': goto('CARDIO_PICK'); return;

    case 'pickEx': {
      const name = t.dataset.name;
      if (session.screen === 'HIIT_SETUP') {
        // 可重複：每點一次就再加一個（不同負重用），移除靠上方列表的 ✕
        session.hiit.items.push({ name, doneRounds: 0, load: null });
      } else if (session.screen === 'CARDIO_PICK') {
        const i = session.cardio.findIndex(c => c.name === name);
        if (i >= 0) session.cardio.splice(i, 1);
        else session.cardio.push({ name, minutes: null, km: null, intensity: '' });
      } else if (sgMode) {
        const i = sgSel.indexOf(name);
        if (i >= 0) sgSel.splice(i, 1);
        else if (sgSel.length < 3) sgSel.push(name);
        else toast('超級組最多 3 個動作');
        render(); return;
      } else {
        if (session.entries.some(e => e.name === name)) session.entries = session.entries.filter(e => e.name !== name);
        else { const ex = exByName[name]; if (ex) addEntry(session, ex, history, 'u' + (idc++)); }
      }
      saveSoon(); render(); return;
    }
    case 'rmEntry': session.entries = session.entries.filter(e => e.name !== t.dataset.name); saveSoon(); render(); return;
    case 'rmCardio': session.cardio.splice(+t.dataset.c, 1); saveSoon(); render(); return;
    case 'toLog': goto('LOG'); return;
    case 'toPick': search = ''; goto('PICK'); return;
    case 'toReview': goto('REVIEW'); return;
    case 'toExport': goto('EXPORT'); return;
    case 'addSet': addSet(entryOf(t)); session.restEndAt = Date.now() + (session.restSeconds || 90) * 1000; saveSoon(); render(); return;
    case 'addSetGroup': addSetToGroup(session, +t.dataset.e); session.restEndAt = Date.now() + (session.restSeconds || 90) * 1000; saveSoon(); render(); return;
    case 'sgToggle': toggleSupersetWithPrev(session, +t.dataset.e); saveSoon(); render(); return;
    case 'sgStart': sgMode = true; sgSel = []; render(); return;
    case 'sgCancel': sgMode = false; sgSel = []; render(); return;
    case 'sgConfirm': {
      const tag = nextGroupTag(session);
      for (const nm of sgSel) {
        const ex = exByName[nm]; if (!ex) continue;
        addEntry(session, ex, history, 'u' + (idc++));
        session.entries[session.entries.length - 1].sg = tag;
      }
      sgMode = false; sgSel = [];
      store.saveSession(session); goto('LOG'); return;
    }
    case 'rmSet': removeSet(entryOf(t), +t.dataset.s); saveSoon(); render(); return;
    case 'w': adjustWeight(setOf(t), parseFloat(t.dataset.d)); saveSoon(); render(); return;
    case 'r': adjustReps(setOf(t), parseInt(t.dataset.d)); saveSoon(); render(); return;
    case 'rest30': if (session.restEndAt) { session.restEndAt += 30000; renderTimer(); } return;
    case 'restClear': session.restEndAt = null; saveSoon(); renderTimer(); return;

    /* HIIT */
    case 'hp': {
      const k = t.dataset.k, d = parseInt(t.dataset.d);
      const min = k === 'rounds' ? 1 : 0;
      session.hiit.params[k] = Math.max(min, (+session.hiit.params[k] || 0) + d);
      saveSoon(); render(); return;
    }
    case 'hiitDel': session.hiit.items.splice(+t.dataset.i, 1); saveSoon(); render(); return;
    case 'hiitEdit': goto('HIIT_SETUP'); return;
    case 'hiitClear': session.hiit = null; saveSoon(); render(); return;
    case 'hiitRun': if (session.hiit && session.hiit.items.length) startRun(); return;
    case 'hiitRound': {
      const it = session.hiit.items[+t.dataset.i];
      it.doneRounds = Math.max(0, (+it.doneRounds || 0) + parseInt(t.dataset.d));
      saveSoon(); render(); return;
    }
    case 'hiitLoad': {
      const it = session.hiit.items[+t.dataset.i];
      const next = Math.round(((+it.load || 0) + parseFloat(t.dataset.d)) * 100) / 100;
      it.load = next <= 0 ? null : next;   // ≤0 → 徒手
      saveSoon(); render(); return;
    }
    case 'runSkip': advance(); return;
    case 'runStop': finishRun(false); return;
    case 'runFinish': session.run = null; releaseWake(); goto('LOG'); return;

    /* 歷史紀錄 */
    case 'histOpen': histScreen = true; histOpen = null; render(); return;
    case 'histBack': histScreen = false; render(); return;
    case 'histToggle': { const i = +t.dataset.i; histOpen = (histOpen === i) ? null : i; render(); return; }

    case 'copy': navigator.clipboard?.writeText(buildMd(exportSession(), blocks)); toast('已複製全文'); return;
    case 'save': saveMd(); return;
  }
}

function onInput(ev) {
  const t = ev.target.closest('[data-inp]'); if (!t) return;
  const kind = t.dataset.inp;
  const v = t.value.trim();
  if (kind === 'search') { search = v; updatePickList('picklist', poolOf('重訓'), session.parts); return; }
  if (kind === 'hiitSearch') { hiitSearch = v; updatePickList('hiitlist', poolOf('HIIT'), PART_ORDER); return; }
  if (kind === 'overall') { session.overallNote = t.value; saveSoon(); return; }
  if (kind === 'date') { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { session.date = v; saveSoon(); } return; }
  if (kind === 'note') { entryOf(t).note = t.value; saveSoon(); return; }
  if (kind === 'w') { setOf(t).weight = v === '' ? null : parseFloat(v); saveSoon(); return; }
  if (kind === 'r') { setOf(t).reps = v === '' ? null : parseInt(v); saveSoon(); return; }
  if (kind === 'rpe') { setOf(t).rpe = v === '' ? null : parseFloat(v); saveSoon(); return; }
  if (kind === 'hp') { const k = t.dataset.k; session.hiit.params[k] = v === '' ? 0 : parseInt(v); saveSoon(); return; }
  if (kind === 'hiitRound') { session.hiit.items[+t.dataset.i].doneRounds = v === '' ? 0 : parseInt(v); saveSoon(); return; }
  if (kind === 'hiitLoad') { session.hiit.items[+t.dataset.i].load = v === '' ? null : parseFloat(v); saveSoon(); return; }
  if (kind === 'cMin') { session.cardio[+t.dataset.c].minutes = v === '' ? null : parseInt(v); saveSoon(); return; }
  if (kind === 'cKm') { session.cardio[+t.dataset.c].km = v === '' ? null : parseFloat(v); saveSoon(); return; }
  if (kind === 'cInt') { session.cardio[+t.dataset.c].intensity = t.value; saveSoon(); return; }
}
// 只重繪清單容器，不動搜尋框（保住游標）
function updatePickList(id, pool, parts) {
  const el = document.getElementById(id); if (!el) return;
  const term = (id === 'hiitlist' ? hiitSearch : search).trim();
  const picked = id === 'hiitlist' ? hiitCounts() : new Set(session.entries.map(e => e.name));
  if (term) {
    el.innerHTML = `<div class="sec-title">搜尋結果</div>${exRows(pool.filter(e => (e.name + e.區域 + e.動作型).includes(term)), picked)}`;
  } else {
    let body = '';
    for (const p of parts) {
      const g = pool.filter(e => e.部位 === p);
      if (g.length) body += `<div class="sec-title">${p}</div>${exRows(g, picked)}`;
    }
    el.innerHTML = body;
  }
}

function ensureHiit() {
  if (!session.hiit) session.hiit = { params: { workSec: 20, restSec: 10, rounds: 1, roundRestSec: 60 }, items: [] };
}

let toastT;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => el.remove(), 1600);
}

async function saveMd() {
  const s = exportSession();
  const text = buildMd(s, blocks);              // 同步先算，保住 user-activation
  const name = fileName(s);
  const file = new File([text], name, { type: 'text/markdown' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); afterSave(); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast('已複製 → 貼到檔案 App 存成 .md'); }
  catch { toast('請長按上方文字全選複製'); }
}

function afterSave() {
  commitHistory(session, history); store.saveHistory(history);
  store.clearSession();
  toast('已存檔，可開始新的一場');
  session = null; setupParts = [];
  render();
}

boot();
