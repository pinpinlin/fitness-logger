import { PART_ORDER, partsLabel, fileName, buildMd } from './lib/format.js';
import { newSession, addEntry, addSet, removeSet, adjustWeight, adjustReps, commitHistory } from './lib/session.js';
import * as store from './lib/storage.js';

const app = document.getElementById('app');
let exercises = [], byPart = {}, exByName = {}, summaryBlock = '';
let history = {}, prefs = {};
let session = null;
let setupParts = [];
let search = '';
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

async function boot() {
  try {
    const [ex, sb] = await Promise.all([
      fetch('exercises.json').then(r => r.json()),
      fetch('summary-block.txt').then(r => r.text())
    ]);
    exercises = ex; summaryBlock = sb;
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
  pendingResume = !!(session && session.entries && session.entries.length);
  render();
  startTicker();
}

/* ---------- render ---------- */
function render() {
  if (pendingResume) return renderResume();
  if (!session) return renderSetup();
  switch (session.screen) {
    case 'PICK': return renderPick();
    case 'LOG': return renderLog();
    case 'REVIEW': return renderReview();
    case 'EXPORT': return renderExport();
    default: return renderSetup();
  }
}

function renderResume() {
  const label = partsLabel(session.parts) || '—';
  app.className = '';
  app.innerHTML = `
    <h1>有未完成的紀錄</h1>
    <p class="sub">${esc(session.date)} · ${esc(label)} · ${session.entries.length} 個動作</p>
    <div class="row"><button class="primary" data-act="resume">繼續這場</button>
      <button class="ghost" data-act="discard">開始新的一場</button></div>`;
}

function renderSetup() {
  app.className = '';
  const chips = PART_ORDER.map(p =>
    `<div class="chip ${setupParts.includes(p) ? 'on' : ''}" data-act="togglePart" data-part="${p}">${p}</div>`).join('');
  app.innerHTML = `
    <h1>今天練什麼</h1>
    <p class="sub">${todayISO()} · 勾選部位（可多選）</p>
    <div class="part-grid">${chips}</div>
    <div class="bottombar"><button class="primary" data-act="start" ${setupParts.length ? '' : 'disabled'}>開始（${partsLabel(setupParts) || '—'}）</button></div>`;
}

function renderPick() {
  app.className = 'hasbar';
  const term = search.trim();
  const picked = new Set(session.entries.map(e => e.name));
  let body = '';
  if (term) {
    const hits = exercises.filter(e => (e.name + e.區域 + e.動作型).includes(term));
    body = `<div class="sec-title">搜尋結果</div>${exRows(hits, picked)}`;
  } else {
    for (const p of session.parts) {
      body += `<div class="sec-title">${p}</div>${exRows(byPart[p] || [], picked)}`;
    }
  }
  const chosen = session.entries.length
    ? `<div class="sec-title">本場動作（${session.entries.length}）</div>` +
      session.entries.map(e => `<div class="ex-item on"><span>${esc(e.name)}</span><span class="spacer"></span><button class="tiny ghost" data-act="rmEntry" data-name="${esc(e.name)}">移除</button></div>`).join('')
    : '';
  app.innerHTML = `
    <h1>選動作</h1>
    <p class="sub">${esc(partsLabel(session.parts))} · 點選加入；可搜尋全庫</p>
    <input data-inp="search" placeholder="搜尋動作名／區域／動作型…" value="${esc(search)}">
    <div id="picklist">${body}</div>
    ${chosen}
    <div class="bottombar">
      <button class="ghost" data-act="toSetup">改部位</button>
      <button class="primary" data-act="toLog" ${session.entries.length ? '' : 'disabled'}>去記錄（${session.entries.length}）</button>
    </div>`;
}
function exRows(list, picked) {
  if (!list.length) return `<p class="muted small">（無）</p>`;
  return list.map(e => `<div class="ex-item ${picked.has(e.name) ? 'on' : ''}" data-act="pickEx" data-name="${esc(e.name)}">
      <span>${esc(e.name)}</span><span class="spacer"></span>
      <span class="meta">${esc(e.型式)}</span>${picked.has(e.name) ? '<span class="meta">✓</span>' : ''}</div>`).join('');
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

function renderLog() {
  app.className = 'hasbar';
  const cards = session.entries.map((e, ei) => {
    const sets = e.sets.map((s, si) => setBlock(e, ei, s, si)).join('');
    const bl = bestLabel(e.name, e.sets);
    return `<div class="card">
      <div class="row"><b>${esc(e.name)}</b><span class="spacer"></span>
        <span class="meta muted small">${esc(e.型式)}</span>
        <button class="tiny ghost" data-act="rmEntry" data-name="${esc(e.name)}">✕</button></div>
      ${bl ? `<div class="best">最重 ${esc(bl)}</div>` : ''}
      ${sets}
      <div class="row srow" style="margin-top:6px"><button class="tiny" data-act="addSet" data-e="${ei}">＋ 加一組</button></div>
      <input class="note-input" data-inp="note" data-e="${ei}" placeholder="動作備註（座椅高度／體感…）" value="${esc(e.note)}">
    </div>`;
  }).join('');
  app.innerHTML = `
    <h1>記錄</h1>
    <p class="sub">${esc(session.date)} · ${esc(partsLabel(session.parts))}</p>
    <div id="timer"></div>
    ${cards || '<p class="muted">尚無動作，回上一步加入。</p>'}
    <div class="bottombar">
      <button class="ghost" data-act="toPick">＋ 動作</button>
      <button class="primary" data-act="toReview">完成 → 心得</button>
    </div>`;
  renderTimer();
}
function setBlock(e, ei, s, si) {
  const wVal = (s.weight === null || s.weight === undefined) ? '' : s.weight;
  const rVal = (s.reps === null || s.reps === undefined) ? '' : s.reps;
  const rpeVal = (s.rpe === null || s.rpe === undefined) ? '' : s.rpe;
  return `<div class="setblk">
    <div class="row srow">
      <span class="setno">${si + 1}</span>
      <button class="step" data-act="w" data-e="${ei}" data-s="${si}" data-d="-2.5">−</button>
      <input inputmode="decimal" data-inp="w" data-e="${ei}" data-s="${si}" value="${wVal}" placeholder="自重">
      <button class="step" data-act="w" data-e="${ei}" data-s="${si}" data-d="2.5">＋</button>
      <span class="unit">kg</span></div>
    <div class="row srow">
      <span class="setno"></span>
      <button class="step" data-act="r" data-e="${ei}" data-s="${si}" data-d="-1">−</button>
      <input inputmode="numeric" data-inp="r" data-e="${ei}" data-s="${si}" value="${rVal}" placeholder="次">
      <button class="step" data-act="r" data-e="${ei}" data-s="${si}" data-d="1">＋</button>
      <span class="unit">RPE</span>
      <input inputmode="decimal" data-inp="rpe" data-e="${ei}" data-s="${si}" value="${rpeVal}" placeholder="–" style="max-width:52px">
      <button class="tiny ghost" data-act="rmSet" data-e="${ei}" data-s="${si}">✕</button></div>
  </div>`;
}

function renderReview() {
  app.className = 'hasbar';
  app.innerHTML = `
    <h1>全場心得</h1>
    <p class="sub">${esc(session.date)} · ${esc(partsLabel(session.parts))}</p>
    <textarea data-inp="overall" placeholder="整體感受、今天狀態…（會寫進 log 的體感/心得）">${esc(session.overallNote)}</textarea>
    <div class="bottombar">
      <button class="ghost" data-act="toLog">← 回記錄</button>
      <button class="primary" data-act="toExport">產生 .md</button>
    </div>`;
}

function renderExport() {
  app.className = 'hasbar';
  const md = buildMd(session, summaryBlock);
  const name = fileName(session.date, session.parts);
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

/* ---------- 組間倒數 ---------- */
let ticker = null;
function startTicker() { if (!ticker) ticker = setInterval(renderTimer, 500); }
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

function entryOf(t) { return session.entries[+t.dataset.e]; }
function setOf(t) { return session.entries[+t.dataset.e].sets[+t.dataset.s]; }

function onClick(ev) {
  const t = ev.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act;
  switch (act) {
    case 'resume': pendingResume = false; render(); return;
    case 'discard': store.clearSession(); session = null; pendingResume = false; setupParts = []; render(); return;
    case 'togglePart': {
      const p = t.dataset.part;
      setupParts = setupParts.includes(p) ? setupParts.filter(x => x !== p) : [...setupParts, p];
      render(); return;
    }
    case 'start':
      session = newSession(todayISO(), setupParts, prefs.restDefault || 90);
      session.screen = 'PICK'; store.saveSession(session); render(); return;
    case 'toSetup': setupParts = [...session.parts]; session.screen = 'PICK'; // 改部位：回 setup 視覺
      session = null; render(); return;
    case 'pickEx': {
      const name = t.dataset.name;
      if (session.entries.some(e => e.name === name)) { // 再點取消
        session.entries = session.entries.filter(e => e.name !== name);
      } else {
        const ex = exercises.find(e => e.name === name);
        if (ex) addEntry(session, ex, history, 'u' + (idc++));
      }
      saveSoon(); render(); return;
    }
    case 'rmEntry':
      session.entries = session.entries.filter(e => e.name !== t.dataset.name);
      saveSoon(); render(); return;
    case 'toLog': session.screen = 'LOG'; store.saveSession(session); render(); return;
    case 'toPick': session.screen = 'PICK'; search = ''; store.saveSession(session); render(); return;
    case 'toReview': session.screen = 'REVIEW'; store.saveSession(session); render(); return;
    case 'toExport': session.screen = 'EXPORT'; store.saveSession(session); render(); return;
    case 'addSet': addSet(entryOf(t)); session.restEndAt = Date.now() + (session.restSeconds || 90) * 1000; saveSoon(); render(); return;
    case 'rmSet': removeSet(entryOf(t), +t.dataset.s); saveSoon(); render(); return;
    case 'w': adjustWeight(setOf(t), parseFloat(t.dataset.d)); saveSoon(); render(); return;
    case 'r': adjustReps(setOf(t), parseInt(t.dataset.d)); saveSoon(); render(); return;
    case 'rest30': if (session.restEndAt) { session.restEndAt += 30000; renderTimer(); } return;
    case 'restClear': session.restEndAt = null; saveSoon(); renderTimer(); return;
    case 'copy': navigator.clipboard?.writeText(buildMd(session, summaryBlock)); toast('已複製全文'); return;
    case 'save': saveMd(); return;
    case 'new': store.clearSession(); session = null; setupParts = []; render(); return;
  }
}

function onInput(ev) {
  const t = ev.target.closest('[data-inp]'); if (!t) return;
  const kind = t.dataset.inp;
  if (kind === 'search') { search = t.value; updatePickList(); return; }
  if (kind === 'overall') { session.overallNote = t.value; saveSoon(); return; }
  if (kind === 'note') { entryOf(t).note = t.value; saveSoon(); return; }
  if (kind === 'w') { const v = t.value.trim(); setOf(t).weight = v === '' ? null : parseFloat(v); saveSoon(); return; }
  if (kind === 'r') { const v = t.value.trim(); setOf(t).reps = v === '' ? null : parseInt(v); saveSoon(); return; }
  if (kind === 'rpe') { const v = t.value.trim(); setOf(t).rpe = v === '' ? null : parseFloat(v); saveSoon(); return; }
}
// 搜尋：只重繪清單容器，不動搜尋框（保住游標）
function updatePickList() {
  const el = document.getElementById('picklist'); if (!el) return;
  const term = search.trim();
  const picked = new Set(session.entries.map(e => e.name));
  if (term) {
    const hits = exercises.filter(e => (e.name + e.區域 + e.動作型).includes(term));
    el.innerHTML = `<div class="sec-title">搜尋結果</div>${exRows(hits, picked)}`;
  } else {
    let body = '';
    for (const p of session.parts) body += `<div class="sec-title">${p}</div>${exRows(byPart[p] || [], picked)}`;
    el.innerHTML = body;
  }
}

let toastT;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => el.remove(), 1600);
}

async function saveMd() {
  const text = buildMd(session, summaryBlock);            // 同步先算，保住 user-activation
  const name = fileName(session.date, session.parts);
  const file = new File([text], name, { type: 'text/markdown' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      afterSave();
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;            // 使用者取消，靜默
    }
  }
  // fallback：複製
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
