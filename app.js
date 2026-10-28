import { PART_ORDER, partsLabel, fileName, buildMd, hiitTotalSeconds, fmtDuration } from './lib/format.js';
import { newSession, addEntry, addSet, removeSet, adjustWeight, adjustReps, commitHistory,
  toggleSupersetWithPrev, addSetToGroup, nextGroupTag, restampDate,
  moveEntry, normalizeGroups, applyRenames } from './lib/session.js';
import * as store from './lib/storage.js';
import { mergeExercises, reconcileCustoms, bumpCustomBest, sanitizeName, sanitizeField, guessXingshi, fieldOptions,
  findExisting, makeCustom, renameCustom } from './lib/custom.js';

const app = document.getElementById('app');
let exercises = [];                // 正式動作庫（exercises.json）；新增表單的欄位選項只能吃這份
let customs = {};                  // 手機新增、尚未入庫的動作（Record<name, Custom>）
let allEx = [];                    // 合併後清單＝正式庫＋customs；選動作池／byPart／exByName 都吃這份
let byPart = {}, exByName = {};
let officialRenames = {};          // renames.json（舊名→正式名），boot 時載入
let blocks = { summary: '', hiitSummary: '', cardioSummary: '' };
let pastLogs = [];          // history.json：過去場次（新→舊）
let histOpen = null;        // 歷史頁展開中的場次索引
let histScreen = false;
let verInfo = null;      // version.json：資料產生時間與筆數
let swVer = '';          // 目前生效的 SW 快取版本
let swUpdate = false;    // 有新版 SW 等待啟用     // 歷史頁開啟中（獨立於 session，未開始訓練也能看）
let history = {}, prefs = {};
let session = null;
let setupParts = [];
let search = '', hiitSearch = '', cardioSearch = '';
// 新增／編輯動作的底部表單（null＝未開）：疊在目前畫面上，不換 session.screen
// {mode:'new'|'edit', oldName?, name, 部位, 型態[], 區域, 動作型, 器材, 型式, 型式手動, other:{區域,動作型,器材}}
let addForm = null;
let sgMode = false, sgSel = [];   // 選動作頁的超級組圈選模式
let idc = 1;
let pendingResume = false;

// 依 正式庫＋customs 重建合併清單與索引；新增／刪除／入庫對帳新動作後呼叫
function rebuildIndex() {
  allEx = mergeExercises(exercises, customs);
  byPart = {}; for (const p of PART_ORDER) byPart[p] = [];
  exByName = {};
  for (const e of allEx) { (byPart[e.部位] || (byPart[e.部位] = [])).push(e); exByName[e.name] = e; }
}
const saveCustoms = () => store.saveCustoms(customs);

// 動作改名對照（舊名→新名）：本機 history 與未完成場次在開 app 時自動換名
const RENAMES = {
  '後肩 側飛圈俯身 啞鈴': '後肩 側飛鳥俯身 啞鈴',
  '中肩 側飛鳥 啞鈴': '中肩 側飛鳥 啞鈴 水平'
};

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
    const [ex, sb, hb, cb, hist, ver, renames] = await Promise.all([
      fetch('exercises.json').then(r => r.json()),
      fetch('summary-block.txt').then(r => r.text()),
      fetch('summary-hiit-block.txt').then(r => r.text()).catch(() => ''),
      fetch('summary-cardio-block.txt').then(r => r.text()).catch(() => ''),
      fetch('history.json').then(r => r.json()).catch(() => []),
      fetch('version.json').then(r => r.json()).catch(() => null),
      fetch('renames.json').then(r => r.json()).catch(() => ({}))   // 舊版部署／離線抓不到 → 空對照
    ]);
    officialRenames = (renames && typeof renames === 'object' && !Array.isArray(renames)) ? renames : {};
    exercises = ex; blocks = { summary: sb, hiitSummary: hb, cardioSummary: cb }; pastLogs = hist; verInfo = ver;
  } catch (e) {
    app.innerHTML = `<div class="card">載入動作資料失敗，請確認連線後重開。<br><span class="muted small">${esc(e.message)}</span></div>`;
    return;
  }
  history = store.loadHistory();
  prefs = store.loadPrefs();
  session = store.loadSession();
  if (session) {
    migrate(session);
    if (restampDate(session, todayISO())) store.saveSession(session);
  }
  // 新動作對帳：已入庫同名 → 從 customs 移除；renames.json 有改名 → 一併換名
  const stored = store.loadCustoms();
  const rec = reconcileCustoms(stored, exercises, officialRenames);
  customs = rec.customs;
  if (Object.keys(customs).length !== Object.keys(stored).length) saveCustoms();
  if (applyRenames(session, history, { ...RENAMES, ...officialRenames, ...rec.renameMap })) {
    store.saveHistory(history); if (session) store.saveSession(session);
  }
  rebuildIndex();
  // entry id 接續既有最大號（重開 app 後 idc 從 1 起算會撞號）
  for (const e of (session && session.entries) || []) { const n = parseInt(String(e.id || '').slice(1)); if (n >= idc) idc = n + 1; }
  pendingResume = !!(session && hasContent(session));
  render();
  startTicker();
  probeSW();
}

// 舊 session 補上新欄位；單一 hiit → hiits 陣列（一場可多組 HIIT）
function migrate(s) {
  if (!s.entries) s.entries = [];
  if (!s.cardio) s.cardio = [];
  if (s.run === undefined) s.run = null;
  if (!Array.isArray(s.hiits)) s.hiits = s.hiit ? [s.hiit] : [];
  delete s.hiit;
  s.hiits.forEach((g, i) => { if (!g.tag) g.tag = String.fromCharCode(65 + i); });
  if (typeof s.hiitIdx !== 'number') s.hiitIdx = 0;
}
// 目前編輯／執行中的 HIIT 組
const curH = () => (session && session.hiits) ? session.hiits[session.hiitIdx] : null;
const hGroups = s => (s.hiits || []).filter(g => (g.items || []).length);
const hasContent = s => (s.entries || []).length || hGroups(s).length || (s.cardio || []).length;
const typeOf = e => (e && e.型態) ? e.型態 : ['重訓'];
const poolOf = t => allEx.filter(e => typeOf(e).includes(t));
// 重訓模式的動作池：重訓 ＋ HIIT 動作（HIIT 動作也可能單獨做，用組數記錄，如開合跳 100 下）；排除純有氧
const liftPool = () => allEx.filter(e => { const t = typeOf(e); return t.includes('重訓') || t.includes('HIIT'); });

// 檔名/frontmatter 用的部位＝重訓勾選 ∪ HIIT 動作 ∪ 有氧項目 的部位
function derivedParts(s) {
  const set = new Set(s.parts || []);
  for (const g of hGroups(s)) for (const it of g.items) { const e = exByName[it.name]; if (e) set.add(e.部位); }
  for (const c of s.cardio || []) { const e = exByName[c.name]; if (e) set.add(e.部位); }
  return PART_ORDER.filter(p => set.has(p));
}
const exportSession = () => ({ ...session, parts: derivedParts(session) });


/* ---------- 版本資訊 ---------- */
// 問 SW 目前生效的快取版本；並偵測是否有新版等待啟用
async function probeSW() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      swUpdate = !!reg.waiting;
      reg.addEventListener("updatefound", () => { swUpdate = true; render(); });
    }
    const ctrl = navigator.serviceWorker.controller;
    if (ctrl) {
      swVer = await new Promise(res => {
        const ch = new MessageChannel();
        const t = setTimeout(() => res(""), 1200);
        ch.port1.onmessage = e => { clearTimeout(t); res((e.data && e.data.cache) || ""); };
        ctrl.postMessage("version", [ch.port2]);
      });
    }
  } catch { /* 忽略 */ }
  render();
}

// 版本列（開場與歷史頁底部）
function versionLine() {
  const bits = [];
  const v = swVer || (verInfo && verInfo.sw);   // 優先顯示手機上實際生效的程式版本（資料是 network-first，可能比程式新）
  if (v) bits.push(v);
  if (verInfo) bits.push("資料 " + (verInfo.latestLog || "—") + "（" + verInfo.sessions + " 場／" + verInfo.exercises + " 動作）");
  if (verInfo && verInfo.generated) bits.push("更新 " + verInfo.generated);
  if (!bits.length) return "";
  return "<div class=\"verline\">" + esc(bits.join(" · ")) +
    (swUpdate ? "<br><span class=\"vernew\">🔄 有新版本，關掉 app 重開即可更新</span>" : "") + "</div>";
}

/* ---------- render ---------- */
function render() { renderScreen(); renderSheet(); }
function renderScreen() {
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
  const n = (session.entries || []).length + hGroups(session).reduce((a,g)=>a+g.items.length,0) + (session.cardio || []).length;
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
    <div class="row"><button class="ghost" data-act="histOpen" style="width:100%">📖 看過去紀錄（${pastLogs.length} 場）</button></div>
    ${versionLine()}`;
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
  app.innerHTML = `
    <h1>選動作</h1>
    <p class="sub">${sgMode
      ? `🔗 圈選模式：依序點 2~3 個動作組成超級組（已選 ${sgSel.length}）`
      : `${esc(partsLabel(session.parts))} · 點選加入`}</p>
    ${searchRow('search', '搜尋動作名／區域／動作型…', search)}
    <div id="picklist">${listBody('picklist')}</div>
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
    // 新動作：待確認標記＋✎（✎ 自帶 data-act，closest 先抓到它，不會觸發整列的 pickEx）
    return `<div class="ex-item ${n ? 'on' : ''}" data-act="pickEx" data-name="${esc(e.name)}">
      <span>${esc(e.name)}</span>${e.custom ? '<span class="new">待確認</span>' : ''}<span class="spacer"></span>
      <span class="meta">${esc(e.區域 || e.型式)}</span>${badge}${e.custom
        ? `<button class="tiny ghost editbtn" data-act="editCustom" data-name="${esc(e.name)}">✎</button>` : ''}</div>`;
  }).join('');
}
// 搜尋框＋常駐「＋ 新增」鈕（開完整表單）
const searchRow = (inp, ph, val) => `<div class="row searchrow">
    <input data-inp="${inp}" placeholder="${ph}" value="${esc(val)}">
    <button class="tiny" data-act="addExForm">＋ 新增</button></div>`;
// 搜尋字清理後非空、且不是既有動作（正式庫或新動作）→ 清單底部出現兩顆新增鈕
function addRows(term) {
  const nm = sanitizeName(term);
  if (!nm || findExisting(exercises, nm) || Object.hasOwn(customs, nm)) return '';
  return `<div class="ex-item addrow" data-act="addQuick"><span>＋ 新增「<b>${esc(nm)}</b>」</span><span class="spacer"></span><span class="meta">快速</span></div>
    <div class="ex-item addrow full" data-act="addExForm"><span>⚙ 新增並填欄位…</span><span class="spacer"></span><span class="meta">完整</span></div>`;
}
// 三個選動作頁的清單本體（搜尋結果＋新增鈕／依部位分區）；整頁 render 與 updatePickList 共用
function listBody(id) {
  const L = {
    picklist: () => ({ term: search, pool: liftPool(), parts: session.parts, showEmpty: true,
      picked: sgMode ? new Set(sgSel) : new Set(session.entries.map(e => e.name)) }),
    hiitlist: () => ({ term: hiitSearch, pool: poolOf('HIIT'), parts: PART_ORDER, picked: hiitCounts() }),
    cardiolist: () => ({ term: cardioSearch, pool: poolOf('有氧'), parts: null, picked: new Set((session.cardio || []).map(c => c.name)) })
  }[id]();
  const term = L.term.trim();
  if (term) return `<div class="sec-title">搜尋結果</div>${exRows(L.pool.filter(e => (e.name + e.區域 + e.動作型).includes(term)), L.picked)}${addRows(term)}`;
  if (!L.parts) return exRows(L.pool, L.picked);
  return L.parts.map(p => {
    const g = L.pool.filter(e => e.部位 === p);
    return (g.length || L.showEmpty) ? `<div class="sec-title">${p}</div>${exRows(g, L.picked)}` : '';
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
  if (ex && ex.best) {
    const m = ex.best.match(/^(自重(?:-[\d.]+)?|[\d.]+)×(\d+)/);
    if (m) { const rw = m[1]; consider(rw.startsWith('自重') ? (rw.length > 2 ? -parseFloat(rw.slice(3)) : 0) : parseFloat(rw), parseInt(m[2])); }
  }
  const h = history[name]; if (h && h.sets) h.sets.forEach(s => consider(s.weight, s.reps));
  (currentSets || []).forEach(s => consider(s.weight, s.reps));
  if (!best) return null;
  const lab = best.w === 0 ? '自重' : (best.w < 0 ? `自重-${Math.abs(best.w)}` : String(best.w));
  return `${lab}×${best.r}`;
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
      // 🔗 只給「獨立動作」用來接上一個；已在組內的不放（避免誤觸拆組，要移出改用拖拉）
      const canLink = ei > 0 && !e.sg;
      return `<div class="card${g.sg ? ' ingroup' : ''}" data-ei="${ei}">
        <div class="row cardhead"><span class="grip" data-grip="${ei}" title="按住拖拉：排序／拖進超級組">⠿</span><b>${esc(e.name)}</b><span class="spacer"></span>
          <span class="meta muted small">${esc(e.型式)}</span>
          ${canLink ? `<button class="tiny ghost" data-act="sgToggle" data-e="${ei}" title="與上一個動作連成超級組">🔗</button>` : ''}
          <button class="tiny ghost" data-act="rmEntry" data-e="${ei}">✕</button></div>
        ${bl ? `<div class="best">最重 ${esc(bl)}</div>` : ''}
        ${lastLine}
        ${e.sets.map((s, si) => setBlock(e, ei, s, si)).join('')}
        ${g.sg ? '' : `<div class="row srow" style="margin-top:6px"><button class="tiny" data-act="addSet" data-e="${ei}">＋ 加一組</button></div>`}
        <input class="note-input" data-inp="note" data-e="${ei}" placeholder="動作備註（座椅高度／體感…）" value="${esc(e.note)}">
      </div>`;
    }).join('');
    if (!g.sg) return inner;
    return `<div class="sgbox" data-sg="${g.sg}">
      <div class="sghead">超級組 ${g.sg} · 中間不休息</div>
      ${inner}
      <div class="row srow" style="margin-top:2px"><button class="tiny primary" data-act="addSetGroup" data-e="${g.idx[0]}">＋ 加一輪（全部動作）</button></div>
    </div>`;
  }).join('');

  // 多組 HIIT：每組一張卡
  const multiH = session.hiits.filter(g => g.items.length).length > 1;
  const hiitCard = session.hiits.map((g, gi) => {
    if (!g.items.length) return '';
    const p = g.params;
    const total = fmtDuration(hiitTotalSeconds(p, g.items.length));
    return `<div class="card">
      <div class="row"><b>🔥 HIIT${multiH ? ' ' + esc(g.tag) : ''}</b><span class="spacer"></span>
        <button class="tiny" data-act="hiitEdit" data-g="${gi}">設定</button>
        <button class="tiny ghost" data-act="hiitClear" data-g="${gi}">✕</button></div>
      <div class="best">每項 ${p.workSec}s ｜ 休 ${p.restSec}s ｜ ${p.rounds} 輪 ｜ 輪休 ${p.roundRestSec}s ｜ 總 ${total}</div>
      ${g.items.map((it, i) => `<div class="setblk">
        <div class="row srow"><span class="spacer">${esc(it.name)}</span>
          <button class="step" data-act="hiitRound" data-g="${gi}" data-i="${i}" data-d="-1">−</button>
          <input inputmode="numeric" data-inp="hiitRound" data-g="${gi}" data-i="${i}" value="${num(it.doneRounds)}" style="max-width:56px;text-align:center">
          <button class="step" data-act="hiitRound" data-g="${gi}" data-i="${i}" data-d="1">＋</button>
          <span class="unit">輪</span></div>
        <div class="row srow"><span class="muted small" style="width:34px">負重</span>
          <button class="step" data-act="hiitLoad" data-g="${gi}" data-i="${i}" data-d="-2">−</button>
          <input inputmode="decimal" data-inp="hiitLoad" data-g="${gi}" data-i="${i}" value="${num(it.load)}" placeholder="徒手">
          <button class="step" data-act="hiitLoad" data-g="${gi}" data-i="${i}" data-d="2">＋</button>
          <span class="unit">kg</span></div>
      </div>`).join('')}
      <div class="row srow" style="margin-top:6px"><button class="tiny primary" data-act="hiitRun" data-g="${gi}">▶ 開始導引</button></div>
    </div>`;
  }).join('');

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
    ${session.entries.length > 1 ? '<p class="muted small draghelp">按住 ⠿ 拖拉：上下排序；拖到別的動作中間＝組成／加入超級組；拖到框外＝脫離</p>' : ''}
    ${liftCards}${hiitCard}${cardioCards}${empty}
    <div class="bottombar">
      <button class="ghost tiny" data-act="addLift">＋重訓</button>
      <button class="ghost tiny" data-act="addHiit">＋HIIT${session.hiits.filter(g=>g.items.length).length?'組':''}</button>
      <button class="ghost tiny" data-act="addCardio">＋有氧</button>
      <button class="primary" data-act="toReview" ${hasContent(session) ? '' : 'disabled'}>完成</button>
    </div>`;
  renderTimer();
}
function setBlock(e, ei, s, si) {
  return `<div class="setblk">
    <div class="row srow">
      <span class="setno">${si + 1}</span>
      <button class="step" data-act="w" data-e="${ei}" data-s="${si}" data-d="-2">−</button>
      <input inputmode="decimal" data-inp="w" data-e="${ei}" data-s="${si}" value="${num(s.weight)}" placeholder="自重">
      <button class="step" data-act="w" data-e="${ei}" data-s="${si}" data-d="2">＋</button>
      <span class="unit">${Number(s.weight) < 0 ? '<span class="assist">輔助</span>' : 'kg'}</span></div>
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
  for (const it of curH().items) m.set(it.name, (m.get(it.name) || 0) + 1);
  return m;
};

function renderHiitSetup() {
  app.className = 'hasbar';
  const h = curH();
  const p = h.params;
  const total = h.items.length ? fmtDuration(hiitTotalSeconds(p, h.items.length)) : '—';
  const paramRow = (label, key, step, unit) => `<div class="row srow">
      <span class="muted small" style="width:56px">${label}</span>
      <button class="step" data-act="hp" data-k="${key}" data-d="-${step}">−</button>
      <input inputmode="numeric" data-inp="hp" data-k="${key}" value="${p[key]}" style="text-align:center">
      <button class="step" data-act="hp" data-k="${key}" data-d="${step}">＋</button>
      <span class="unit">${unit}</span></div>`;
  app.innerHTML = `
    <h1>HIIT 設定${session.hiits.length>1?' · '+esc(curH().tag)+' 組':''}</h1>
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
          <button class="step" data-act="hiitLoad" data-g="${session.hiitIdx}" data-i="${i}" data-d="-2">−</button>
          <input inputmode="decimal" data-inp="hiitLoad" data-g="${session.hiitIdx}" data-i="${i}" value="${num(it.load)}" placeholder="徒手">
          <button class="step" data-act="hiitLoad" data-g="${session.hiitIdx}" data-i="${i}" data-d="2">＋</button>
          <span class="unit">kg</span></div>
      </div>`).join('') : ''}
    <div style="margin-top:10px">${searchRow('hiitSearch', '搜尋 HIIT 動作…', hiitSearch)}</div>
    <div id="hiitlist">${listBody('hiitlist')}</div>
    <div class="bottombar">
      <button class="ghost" data-act="toHub">← 返回</button>
      <button class="primary" data-act="hiitRun" ${h.items.length ? '' : 'disabled'}>▶ 開始導引</button>
    </div>`;
}

/* ---------- HIIT 導引 ---------- */
// 按下「開始導引」後先給 PREP_SEC 秒就位；只在整場開頭一次，不計入總時長。
const PREP_SEC = 5;
const PHASE = { prep: { label: '準備', cls: 'run-prep' }, work: { label: '運動', cls: 'run-work' }, itemRest: { label: '項間休息', cls: 'run-rest' }, roundRest: { label: '輪間休息', cls: 'run-round' }, done: { label: '完成', cls: 'run-done' } };

function renderHiitRun() {
  const r = session.run, h = curH();
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
    <div class="runphase">${r.phase === 'prep' ? '準備 ｜ 就位' : `${PHASE[r.phase].label} ｜ 第 ${r.round}/${h.params.rounds} 輪 ｜ ${r.idx + 1}/${h.items.length}`}</div>
    <div class="runname">${(r.phase === 'work' || r.phase === 'prep') ? esc(cur.name) + loadTag(cur.load) : '休息'}</div>
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
  // prep 與 work 一樣：畫面上「現在」顯示的是 items[idx]，所以下一個是 idx+1
  if (r.phase === 'work' || r.phase === 'prep') return r.idx < h.items.length - 1 ? h.items[r.idx + 1] : (r.round < h.params.rounds ? h.items[0] : null);
  if (r.phase === 'itemRest') return h.items[r.idx + 1] || null;
  if (r.phase === 'roundRest') return h.items[0] || null;
  return null;
}
function phaseSeconds(phase) {
  const p = curH().params;
  return phase === 'prep' ? PREP_SEC : phase === 'work' ? +p.workSec : phase === 'itemRest' ? +p.restSec : +p.roundRestSec;
}
function startRun() {
  const h = curH();
  session.run = { round: 1, idx: 0, phase: 'prep', phaseEndAt: Date.now() + PREP_SEC * 1000, paused: false, pausedLeft: 0, beeped: -1, noWakeLock: false };
  session.screen = 'HIIT_RUN';
  initAudio(); requestWake();
  store.saveSession(session); render();
}
// 推進到下一段；回傳是否結束
function advance() {
  const r = session.run, h = curH(), n = h.items.length, R = +h.params.rounds;
  if (r.phase === 'prep') { r.phase = 'work'; }   // 準備完直接開第一項，不動 idx/round
  else if (r.phase === 'work') {
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
  const r = session.run, h = curH();
  const done = completed ? +h.params.rounds : Math.max(0, r.round - 1);
  h.items.forEach(it => { it.doneRounds = done; });
  r.phase = 'done';
  releaseWake();
  beep(1200, 0.3); setTimeout(() => beep(1200, 0.3), 220);
  store.saveSession(session); render();
}

/* 音效 */
// iOS 的坑：切到別的 app／鎖屏再回來，Web Audio 常被系統中斷（有時 state 仍顯示 running 卻無聲），
// 且重新喚醒必須在使用者觸控當下。所以：
//  ① 回到前景就把舊 AudioContext 視為作廢，下一次觸控（畫面任何地方）重建；
//  ② 還沒觸控就時間到 → 改用 <audio> 元素播放。這個元素在先前某次觸控時播過一段無聲音檔「解鎖」，
//     iOS 允許解鎖過的元素之後自行播放。
let actx = null, audioStale = false;
try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch {}   // 與音樂混音、不打斷 Spotify
function initAudio() {
  try {
    if (actx && audioStale) { try { actx.close(); } catch {} actx = null; }
    audioStale = false;
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state !== 'running') actx.resume();
  } catch { actx = null; }
  unlockClip();
}
const audioOK = () => !!(actx && !audioStale && actx.state === 'running');
const wakeAudio = () => { if (!audioOK() || !clipUnlocked) initAudio(); };
document.addEventListener('touchend', wakeAudio, { capture: true, passive: true });
document.addEventListener('click', wakeAudio, true);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') audioStale = true;
  else if (actx) { try { actx.resume(); } catch {} }
});

// 用程式產生 WAV（免另放音檔）：tones = [[頻率, 起點秒, 長度秒], …]
function wavUrl(tones, total) {
  const sr = 22050, n = Math.round(sr * total), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / sr; let x = 0;
    for (const [f, st, d] of tones) if (t >= st && t < st + d) {
      const k = t - st;
      x += Math.sin(2 * Math.PI * f * k) * Math.min(1, k / 0.01, (d - k) / 0.03) * 0.5;
    }
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 32767, true);
  }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
let clipEl = null, clipUnlocked = false, clipUrls = null;
function unlockClip() {
  if (clipUnlocked) return;
  try {
    if (!clipUrls) clipUrls = {
      silent: wavUrl([], 0.05),
      tick: wavUrl([[660, 0, 0.08]], 0.12),
      done: wavUrl([[1050, 0, 0.22], [1050, 0.26, 0.22], [1050, 0.52, 0.22]], 0.8)
    };
    clipEl = clipEl || new Audio();
    clipEl.src = clipUrls.silent;
    clipUnlocked = true;
    const pr = clipEl.play();
    if (pr && pr.catch) pr.catch(() => { clipUnlocked = false; });
  } catch { clipUnlocked = false; }
}
function playClip(kind) {
  if (!clipEl || !clipUrls) return;
  try { clipEl.src = clipUrls[kind]; const pr = clipEl.play(); if (pr && pr.catch) pr.catch(() => {}); } catch {}
}

function beep(freq, dur) {
  if (!audioOK()) { playClip('tick'); return; }
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
  app.innerHTML = `
    <h1>選有氧項目</h1>
    <p class="sub">點選加入本場</p>
    ${searchRow('cardioSearch', '搜尋有氧項目…', cardioSearch)}
    <div id="cardiolist">${listBody('cardiolist')}</div>
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
    ${versionLine()}
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
  const md = buildMd(s, blocks, customs);
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
// 計時條的 DOM 只在「無／倒數中／結束」切換時重建一次，之後每 tick 只改數字文字。
// 原本每 250ms 整條 innerHTML 重建：iOS Safari 看到點擊瞬間有新內容出現，會當成 hover 選單而吞掉這次點擊
// （＋加一組、±重量次數要點好幾下才有反應）。
function renderTimer() {
  const el = document.getElementById('timer');
  if (!el || !session) return;
  if (!session.restEndAt) {
    if (el._mode) { el.innerHTML = ''; el._mode = null; }
    if (app.classList.contains('withtimer')) app.classList.remove('withtimer');
    return;
  }
  if (!app.classList.contains('withtimer')) app.classList.add('withtimer');
  const left = Math.round((session.restEndAt - Date.now()) / 1000);
  restBeep(left);
  const mode = left <= 0 ? 'done' : 'run';
  if (el._mode !== mode) {
    el._mode = mode;
    el.innerHTML = mode === 'done'
      ? `<div class="timer"><span class="t" style="color:var(--good)">休息結束</span><span class="spacer"></span>
      <button class="tiny" data-act="restClear">關閉</button></div>`
      : `<div class="timer"><span class="t"></span>
    <span class="muted small">組間休息</span><span class="spacer"></span>
    <button class="tiny" data-act="rest30">+30</button>
    <button class="tiny" data-act="restClear">跳過</button></div>`;
  }
  if (mode === 'run') {
    const txt = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const t = el.querySelector('.t');
    if (!t.firstChild) t.appendChild(document.createTextNode(""));
    if (t.firstChild.nodeValue !== txt) t.firstChild.nodeValue = txt;   // 改字不插新節點
  }
}

// 組間休息提示音：最後 3 秒短嗶、時間到三聲長嗶＋震動（每次休息只響一輪）
let restBeepKey = null, restTickLeft = null;
function startRest() {
  initAudio();   // 在使用者點擊當下解鎖音效，倒數結束時才響得出來
  session.restEndAt = Date.now() + (session.restSeconds || 90) * 1000;
}
function restBeep(left) {
  const key = session.restEndAt;
  if (left > 0 && left <= 3 && restTickLeft !== left) { restTickLeft = left; beep(660, 0.08); }
  if (left <= 0 && restBeepKey !== key) {
    restBeepKey = key; restTickLeft = null;
    if (left < -5) return;   // app 在背景時就結束了，回來不補響
    if (audioOK()) [0, 260, 520].forEach(ms => setTimeout(() => beep(1050, 0.22), ms));
    else playClip('done');   // 剛從背景回來、還沒觸控 → 用解鎖過的 <audio> 播
    try { navigator.vibrate && navigator.vibrate([200, 100, 200, 100, 200]); } catch {}
  }
}

/* ---------- 復原（刪動作／刪組／組超級組／拖拉／刪新動作都可撤回一步）---------- */
let undoT = null;
function withUndo(msg, fn) {
  const snap = JSON.stringify(session), csnap = JSON.stringify(customs);
  fn();
  const cChanged = JSON.stringify(customs) !== csnap;
  if (JSON.stringify(session) === snap && !cChanged) { render(); return; }   // 沒變就不提示
  store.saveSession(session);
  if (cChanged) { saveCustoms(); rebuildIndex(); }
  render();
  let el = document.querySelector('.undo');
  if (!el) {
    el = document.createElement('div'); el.className = 'undo';
    el.addEventListener('click', ev => {
      if (!ev.target.closest('button') || !el._snap) return;
      session = JSON.parse(el._snap); el._snap = null;
      if (el._csnap !== JSON.stringify(customs)) { customs = JSON.parse(el._csnap); saveCustoms(); rebuildIndex(); }
      store.saveSession(session); el.remove(); render();
    });
    document.body.appendChild(el);
  }
  el._snap = snap; el._csnap = csnap;
  el.innerHTML = `<span>${esc(msg)}</span><button class="tiny">復原</button>`;
  clearTimeout(undoT); undoT = setTimeout(() => el.remove(), 8000);
}

/* ---------- 拖拉排序（記錄頁的重訓動作卡）----------
   只用左側 ⠿ 把手（按住即拖）。拖拉時卡片收合成只剩標題，整場一眼看完。
   放的位置：卡片上緣／下緣＝插在前／後（該卡在超級組內就一起加入）；卡片中段＝與它組成／加入超級組；
   卡片之間的空隙＝獨立動作（在超級組框內的空隙則加入該組）。 */
let drag = null, suppressClickUntil = 0;
app.addEventListener('pointerdown', ev => {
  if (!session || session.screen !== 'LOG' || drag || pendingResume || histScreen) return;
  const grip = ev.target.closest('[data-grip]'); if (!grip) return;
  const card = grip.closest('.card[data-ei]'); if (!card) return;
  ev.preventDefault(); beginDrag(+card.dataset.ei, ev.clientY);
});
window.addEventListener('pointermove', ev => { if (drag) { ev.preventDefault(); drag.y = ev.clientY; dragUpdate(); } }, { passive: false });
window.addEventListener('pointerup', () => { if (drag) endDrag(true); });
window.addEventListener('pointercancel', () => { if (drag) endDrag(false); });
// iOS：拖拉中擋掉捲動（否則系統接手變成捲頁並送 pointercancel）
document.addEventListener('touchmove', ev => { if (drag) ev.preventDefault(); }, { passive: false });
// 拖完放手時，手指下的按鈕（如另一張卡的 ✕）不可被觸發
window.addEventListener('click', ev => { if (Date.now() < suppressClickUntil) { ev.stopPropagation(); ev.preventDefault(); } }, true);
document.addEventListener('contextmenu', ev => { if (drag) ev.preventDefault(); });
function beginDrag(from, y) {
  const card = app.querySelector(`.card[data-ei="${from}"]`); if (!card) return;
  drag = { from, y, op: null, raf: 0 };
  app.classList.add('dragging');
  card.classList.add('dragsrc');
  // 收合後把被拖的卡捲回手指底下
  const r = card.getBoundingClientRect();
  window.scrollBy(0, r.top + r.height / 2 - y);
  const r2 = card.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.className = 'card dragghost'; ghost.removeAttribute('data-ei');
  ghost.style.left = r2.left + 'px'; ghost.style.width = r2.width + 'px';
  drag.ghost = ghost; drag.gh = r2.height;
  drag.line = Object.assign(document.createElement('div'), { className: 'dropline' });
  drag.hint = Object.assign(document.createElement('div'), { className: 'draghint' });
  document.body.append(ghost, drag.line, drag.hint);
  try { navigator.vibrate && navigator.vibrate(15); } catch {}
  dragUpdate();
  // 手指靠近上下緣時自動捲動
  const loop = () => {
    if (!drag) return;
    const H = window.innerHeight, edge = 80;
    const v = drag.y < edge ? -(edge - drag.y) / 6 : drag.y > H - 110 ? (drag.y - (H - 110)) / 6 : 0;
    if (v) { window.scrollBy(0, v); dragUpdate(); }
    drag.raf = requestAnimationFrame(loop);
  };
  drag.raf = requestAnimationFrame(loop);
}
function dragOp(y) {
  const from = drag.from;
  const cards = [...app.querySelectorAll('.card[data-ei]')].filter(c => +c.dataset.ei !== from);
  if (!cards.length) return null;
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    if (y < r.top || y > r.bottom) continue;
    const t = +c.dataset.ei, sg = session.entries[t].sg, rel = (y - r.top) / r.height;
    if (rel < 0.3) return { mode: 'before', target: t, sg, lineY: r.top - 3 };
    if (rel > 0.7) return { mode: 'after', target: t, sg, lineY: r.bottom + 3 };
    return { mode: 'merge', target: t, el: c };
  }
  // 空隙：在超級組框內 → 加入該組；否則獨立
  let box = null;
  for (const b of app.querySelectorAll('.sgbox')) { const r = b.getBoundingClientRect(); if (y >= r.top && y <= r.bottom) box = b; }
  let best = null;
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    const d = y < r.top ? r.top - y : y - r.bottom;
    if (!best || d < best.d) best = { d, c, r, above: y < r.top };
  }
  const t = +best.c.dataset.ei;
  const sg = box && box.contains(best.c) ? box.dataset.sg : null;
  return best.above ? { mode: 'before', target: t, sg, lineY: best.r.top - 3 } : { mode: 'after', target: t, sg, lineY: best.r.bottom + 3 };
}
function dragUpdate() {
  const op = drag.op = dragOp(drag.y);
  drag.ghost.style.top = (drag.y - drag.gh - 14) + 'px';   // 浮在手指上方，不擋住落點線
  app.querySelectorAll('.droptarget').forEach(e => e.classList.remove('droptarget'));
  const name = session.entries[drag.from].name;
  let hint = '拖到想放的位置';
  if (op && op.mode === 'merge') {
    op.el.classList.add('droptarget');
    drag.line.style.display = 'none';
    const tsg = session.entries[op.target].sg;
    hint = tsg ? `放開 → 加入超級組 ${tsg}` : `放開 → 與「${session.entries[op.target].name}」組成超級組`;
  } else if (op) {
    drag.line.style.display = 'block';
    drag.line.style.top = op.lineY + 'px';
    drag.line.classList.toggle('insg', !!op.sg);
    hint = op.sg ? `放開 → 移到這裡（超級組 ${op.sg} 內）` : '放開 → 移到這裡（獨立動作）';
  }
  drag.hint.textContent = `${name}｜${hint}`;
}
function endDrag(commit) {
  const { from, op } = drag;
  cancelAnimationFrame(drag.raf);
  drag.ghost.remove(); drag.line.remove(); drag.hint.remove();
  drag = null;
  app.classList.remove('dragging');
  suppressClickUntil = Date.now() + 400;
  if (commit && op) withUndo('已移動', () => moveEntry(session, from, op));
  else render();
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
      else { cardioSearch = ''; goto('CARDIO_PICK'); }
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
    case 'addCardio': cardioSearch = ''; goto('CARDIO_PICK'); return;

    case 'pickEx': {
      const name = t.dataset.name;
      // 已選的再點＝移除（HIIT 可重複加入，不移除；移除靠上方列表的 ✕）
      if (session.screen === 'CARDIO_PICK') {
        const i = session.cardio.findIndex(c => c.name === name);
        if (i >= 0) { session.cardio.splice(i, 1); saveSoon(); render(); return; }
      } else if (session.screen !== 'HIIT_SETUP') {
        if (sgMode) {
          const i = sgSel.indexOf(name);
          if (i >= 0) sgSel.splice(i, 1);
          else if (sgSel.length < 3) sgSel.push(name);
          else toast('超級組最多 3 個動作');
          render(); return;
        }
        if (session.entries.some(e => e.name === name)) {
          withUndo(`已移除 ${name}`, () => { session.entries = session.entries.filter(e => e.name !== name); normalizeGroups(session); });
          return;
        }
      }
      addPicked(name);
      saveSoon(); render(); return;
    }

    /* 新增／編輯動作 */
    case 'addExForm': openAddForm(curTerm()); renderSheet(); return;
    case 'addQuick': quickAdd(); return;
    case 'editCustom': { const n = t.dataset.name; if (Object.hasOwn(customs, n)) { openEditForm(customs[n]); renderSheet(); } return; }
    case 'addCancel': addForm = null; renderSheet(); return;
    case 'addPart': setFormPart(t.dataset.v); renderSheet(); return;
    case 'addType': { const v = t.dataset.v, a = addForm.型態; addForm.型態 = a.includes(v) ? a.filter(x => x !== v) : [...a, v]; renderSheet(); return; }
    case 'addField': { const k = t.dataset.f, v = t.dataset.v; addForm[k] = addForm[k] === v ? '' : v; addForm.other[k] = false; autoXs(); renderSheet(); return; }
    case 'addOther': {
      const k = t.dataset.f; addForm.other[k] = !addForm.other[k]; addForm[k] = ''; autoXs(); renderSheet();
      if (addForm.other[k]) { const inp = document.querySelector(`#addsheet [data-inp="addOther"][data-f="${k}"]`); if (inp) inp.focus(); }
      return;
    }
    case 'addXs': { const i = XS_CYCLE.indexOf(addForm.型式); addForm.型式 = XS_CYCLE[(i + 1) % XS_CYCLE.length]; addForm.型式手動 = true; renderSheet(); return; }
    case 'addSubmit': submitForm(); return;
    case 'addDelete': deleteCustom(); return;
    case 'rmEntry': { const ei = +t.dataset.e; const nm = session.entries[ei].name;
      withUndo(`已刪除 ${nm}`, () => { session.entries.splice(ei, 1); normalizeGroups(session); }); return; }
    case 'rmCardio': session.cardio.splice(+t.dataset.c, 1); saveSoon(); render(); return;
    case 'toLog': goto('LOG'); return;
    case 'toPick': search = ''; goto('PICK'); return;
    case 'toReview': goto('REVIEW'); return;
    case 'toExport': goto('EXPORT'); return;
    case 'addSet': addSet(entryOf(t)); startRest(); saveSoon(); render(); return;
    case 'addSetGroup': addSetToGroup(session, +t.dataset.e); startRest(); saveSoon(); render(); return;
    case 'sgToggle': withUndo('已與上一個動作組成超級組', () => { toggleSupersetWithPrev(session, +t.dataset.e); normalizeGroups(session); }); return;
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
    case 'rmSet': withUndo('已刪除一組', () => removeSet(entryOf(t), +t.dataset.s)); return;
    case 'w': adjustWeight(setOf(t), parseFloat(t.dataset.d)); saveSoon(); render(); return;
    case 'r': adjustReps(setOf(t), parseInt(t.dataset.d)); saveSoon(); render(); return;
    case 'rest30': if (session.restEndAt) { session.restEndAt += 30000; renderTimer(); } return;
    case 'restClear': session.restEndAt = null; saveSoon(); renderTimer(); return;

    /* HIIT */
    case 'hp': {
      const k = t.dataset.k, d = parseInt(t.dataset.d);
      const min = k === 'rounds' ? 1 : 0;
      curH().params[k] = Math.max(min, (+curH().params[k] || 0) + d);
      saveSoon(); render(); return;
    }
    case 'hiitDel': curH().items.splice(+t.dataset.i, 1); saveSoon(); render(); return;
    case 'hiitAddGroup': addHiitGroup(); goto('HIIT_SETUP'); return;
    case 'hiitEdit': session.hiitIdx = +t.dataset.g; goto('HIIT_SETUP'); return;
    case 'hiitClear': { session.hiits.splice(+t.dataset.g, 1); session.hiitIdx = Math.max(0, Math.min(session.hiitIdx, session.hiits.length - 1)); saveSoon(); render(); return; }
    case 'hiitRun': { if (t.dataset.g !== undefined) session.hiitIdx = +t.dataset.g; if (curH() && curH().items.length) startRun(); return; }
    case 'hiitRound': {
      const it = session.hiits[+t.dataset.g].items[+t.dataset.i];
      it.doneRounds = Math.max(0, (+it.doneRounds || 0) + parseInt(t.dataset.d));
      saveSoon(); render(); return;
    }
    case 'hiitLoad': {
      const it = session.hiits[+t.dataset.g].items[+t.dataset.i];
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

    case 'copy': navigator.clipboard?.writeText(buildMd(exportSession(), blocks, customs)); toast('已複製全文'); return;
    case 'save': saveMd(); return;
  }
}

function onInput(ev) {
  const t = ev.target.closest('[data-inp]'); if (!t) return;
  const kind = t.dataset.inp;
  const v = t.value.trim();
  if (kind === 'search') { search = v; updatePickList('picklist'); return; }
  if (kind === 'hiitSearch') { hiitSearch = v; updatePickList('hiitlist'); return; }
  if (kind === 'cardioSearch') { cardioSearch = v; updatePickList('cardiolist'); return; }
  // 表單文字欄：只改狀態＋就地更新按鈕／型式字，不重繪（保住游標）
  if (kind === 'addName') { addForm.name = t.value; const b = document.getElementById('addSubmit'); if (b) b.disabled = !formOk(); return; }
  if (kind === 'addOther') {
    const k = t.dataset.f; addForm[k] = t.value;
    if (k === '器材') { autoXs(); const x = document.getElementById('addXs'); if (x) x.textContent = addForm.型式; }
    return;
  }
  if (kind === 'overall') { session.overallNote = t.value; saveSoon(); return; }
  if (kind === 'date') { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { session.date = v; saveSoon(); } return; }
  if (kind === 'note') { entryOf(t).note = t.value; saveSoon(); return; }
  if (kind === 'w') { setOf(t).weight = v === '' ? null : parseFloat(v); saveSoon(); return; }
  if (kind === 'r') { setOf(t).reps = v === '' ? null : parseInt(v); saveSoon(); return; }
  if (kind === 'rpe') { setOf(t).rpe = v === '' ? null : parseFloat(v); saveSoon(); return; }
  if (kind === 'hp') { const k = t.dataset.k; curH().params[k] = v === '' ? 0 : parseInt(v); saveSoon(); return; }
  if (kind === 'hiitRound') { session.hiits[+t.dataset.g].items[+t.dataset.i].doneRounds = v === '' ? 0 : parseInt(v); saveSoon(); return; }
  if (kind === 'hiitLoad') { session.hiits[+t.dataset.g].items[+t.dataset.i].load = v === '' ? null : parseFloat(v); saveSoon(); return; }
  if (kind === 'cMin') { session.cardio[+t.dataset.c].minutes = v === '' ? null : parseInt(v); saveSoon(); return; }
  if (kind === 'cKm') { session.cardio[+t.dataset.c].km = v === '' ? null : parseFloat(v); saveSoon(); return; }
  if (kind === 'cInt') { session.cardio[+t.dataset.c].intensity = t.value; saveSoon(); return; }
}
// 只重繪清單容器，不動搜尋框（保住游標）
function updatePickList(id) {
  const el = document.getElementById(id); if (el) el.innerHTML = listBody(id);
}

/* ---------- 新增／編輯動作（底部表單）---------- */
const TYPES = ['重訓', 'HIIT', '有氧'];
const FIELDS = ['區域', '動作型', '器材'];
const XS_CYCLE = ['半機械式', '機械式', '自由重量', '徒手'];
const SCREEN_TYPE = { PICK: '重訓', HIIT_SETUP: 'HIIT', CARDIO_PICK: '有氧' };
const scrType = () => SCREEN_TYPE[session.screen] || '重訓';
const curTerm = () => session.screen === 'HIIT_SETUP' ? hiitSearch : session.screen === 'CARDIO_PICK' ? cardioSearch : search;
function clearTerm() {
  if (session.screen === 'HIIT_SETUP') hiitSearch = '';
  else if (session.screen === 'CARDIO_PICK') cardioSearch = '';
  else search = '';
}
const formOk = () => !!(addForm && sanitizeName(addForm.name) && addForm.部位 && addForm.型態.length);
const autoXs = () => { if (!addForm.型式手動) addForm.型式 = guessXingshi(addForm.部位, addForm.器材); };

// 把動作加入本場（依目前畫面）；只加不移除，已在本場就不動
function addPicked(name) {
  if (session.screen === 'HIIT_SETUP') curH().items.push({ name, doneRounds: 0, load: null });
  else if (session.screen === 'CARDIO_PICK') {
    if (!session.cardio.some(c => c.name === name)) session.cardio.push({ name, minutes: null, km: null, intensity: '' });
  } else if (sgMode) { if (!sgSel.includes(name) && sgSel.length < 3) sgSel.push(name); }
  else if (!session.entries.some(e => e.name === name)) { const ex = exByName[name]; if (ex) addEntry(session, ex, history, 'u' + (idc++)); }
}
// 新增流程收尾：加入本場 → 清空搜尋字 → 存檔重繪
function commitPick(name) {
  addPicked(name); clearTerm();
  store.saveSession(session); render();
}

function openAddForm(name) {
  const 部位 = (session.parts || [])[0] || null;
  addForm = { mode: 'new', name: sanitizeName(name), 部位, 型態: [scrType()], 區域: '', 動作型: '', 器材: '',
    型式: guessXingshi(部位, ''), 型式手動: false, other: { 區域: false, 動作型: false, 器材: false } };
}
function openEditForm(c) {
  const opts = fieldOptions(exercises, c.部位);
  const other = {};
  for (const k of FIELDS) other[k] = !!c[k] && !opts[k].includes(c[k]);
  addForm = { mode: 'edit', oldName: c.name, name: c.name, 部位: c.部位, 型態: [...c.型態],
    區域: c.區域 || '', 動作型: c.動作型 || '', 器材: c.器材 || '',
    型式: c.型式, 型式手動: c.型式 !== guessXingshi(c.部位, c.器材), other };
}
// 切部位：選項重算，清掉不在新選項中的點選值（「其他」手打的保留）
function setFormPart(p) {
  addForm.部位 = p;
  const opts = fieldOptions(exercises, p);
  for (const k of FIELDS) if (!addForm.other[k] && addForm[k] && !opts[k].includes(addForm[k])) addForm[k] = '';
  autoXs();
}

// 快速新增：部位＝本場第一個部位、型態＝目前畫面；本場沒部位（純 HIIT／有氧場）改開完整表單
function quickAdd() {
  const name = sanitizeName(curTerm());
  if (!name) return;
  const 部位 = (session.parts || [])[0];
  if (!部位) { openAddForm(name); renderSheet(); return; }
  const ex = findExisting(exercises, name);
  if (!ex && !Object.hasOwn(customs, name)) {
    customs[name] = makeCustom({ name, 部位, 型態: [scrType()] }); saveCustoms(); rebuildIndex();
  }
  commitPick(ex ? ex.name : name);
}

function submitForm() {
  const f = addForm; if (!formOk()) return;
  const name = sanitizeName(f.name);
  const fields = { 部位: f.部位, 型態: TYPES.filter(t => f.型態.includes(t)),
    區域: sanitizeField(f.區域), 動作型: sanitizeField(f.動作型), 器材: sanitizeField(f.器材), 型式: f.型式 };
  if (f.mode === 'new') {
    // 與正式庫（或既有新動作）同名 → 不新建，直接選那個
    const ex = findExisting(exercises, name) || (Object.hasOwn(customs, name) ? customs[name] : null);
    addForm = null;
    if (ex) toast(`已有此動作：${ex.name}`);
    else { customs[name] = makeCustom({ name, ...fields }); saveCustoms(); rebuildIndex(); }
    commitPick(ex ? ex.name : name);
    return;
  }
  // 編輯：改名要連本場與本機 history 一起換
  const old = f.oldName;
  if (!Object.hasOwn(customs, old)) { addForm = null; render(); return; }
  if (name !== old) {
    if (findExisting(exercises, name)) { toast(`正式庫已有「${name}」，不能用這個名字`); return; }
    if (!renameCustom(customs, old, name)) { toast(`已有同名動作：${name}`); return; }
    applyRenames(session, history, { [old]: name });
    sgSel = sgSel.map(n => n === old ? name : n);
    store.saveHistory(history);
  }
  const c = Object.assign(customs[name], fields);
  for (const e of session.entries) if (e.name === name) { e.部位 = c.部位; e.型式 = c.型式; }   // 本場動作行的型式跟著改
  saveCustoms(); rebuildIndex(); store.saveSession(session);
  addForm = null; toast('已更新'); render();
}

function deleteCustom() {
  const n = addForm.oldName;
  const used = session.entries.some(e => e.name === n) || session.hiits.some(g => g.items.some(i => i.name === n))
    || session.cardio.some(c => c.name === n) || sgSel.includes(n);
  if (used) { toast('本場已使用，請先從本場移除'); return; }
  addForm = null;
  withUndo(`已刪除 ${n}`, () => { delete customs[n]; });
}

// 表單只在使用者操作時整塊重繪（不跟 ticker）；掛在 #app 內，共用事件委派
function renderSheet() {
  let el = document.getElementById('addsheet');
  if (!addForm) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'addsheet'; app.appendChild(el); }
  const f = addForm, edit = f.mode === 'edit';
  const opts = f.部位 ? fieldOptions(exercises, f.部位) : { 區域: [], 動作型: [], 器材: [] };
  const chip = (label, on, act, attrs, cls = '') => `<span class="chip${cls}${on ? ' on' : ''}" data-act="${act}" ${attrs}>${esc(label)}</span>`;
  const pre = ok => (!edit && ok) ? '<i>已預選</i>' : '';
  const field = k => `<div class="lbl">${k}${f.部位 ? `（只列「${f.部位}」用過的）` : '（先選部位）'}</div>
    <div class="chips">${opts[k].map(v => chip(v, !f.other[k] && f[k] === v, 'addField', `data-f="${k}" data-v="${esc(v)}"`)).join('')}${
      chip('＋其他', f.other[k], 'addOther', `data-f="${k}"`, ' other')}</div>
    ${f.other[k] ? `<input class="other-inp" data-inp="addOther" data-f="${k}" value="${esc(f[k])}" placeholder="輸入${k}">` : ''}`;
  el.innerHTML = `<div class="sheet-dim" data-act="addCancel"></div>
  <div class="sheet">
    <div class="sheet-title">${edit ? '編輯動作' : '新增動作'}</div>
    <input data-inp="addName" placeholder="動作名稱，如 單腿 臀推 史密斯" value="${esc(f.name)}">
    <div class="lbl">部位${pre(f.部位 && f.部位 === (session.parts || [])[0])}</div>
    <div class="chips">${PART_ORDER.map(p => chip(p, f.部位 === p, 'addPart', `data-v="${p}"`)).join('')}</div>
    <div class="lbl">型態（可多選）${pre(f.型態.length === 1 && f.型態[0] === scrType())}</div>
    <div class="chips">${TYPES.map(t => chip(t, f.型態.includes(t), 'addType', `data-v="${t}"`)).join('')}</div>
    ${FIELDS.map(field).join('')}
    <div class="xs" data-act="addXs">型式：<b id="addXs">${esc(f.型式)}</b>（${f.型式手動 ? '已手動指定' : '依器材自動帶'}，點此改）</div>
    <div class="row sheet-bar">
      ${edit ? '<button class="ghost danger" data-act="addDelete">刪除此動作</button>' : ''}
      <button class="ghost" data-act="addCancel">取消</button>
      <button class="primary" id="addSubmit" data-act="addSubmit" ${formOk() ? '' : 'disabled'}>${edit ? '儲存' : '加入並開始記'}</button>
    </div>
  </div>`;
}

const DEFAULT_HIIT = () => ({ workSec: 20, restSec: 10, rounds: 1, roundRestSec: 60 });
// 新增一組 HIIT（代號 A、B、C…）並設為目前編輯組；參數沿用上一組
function addHiitGroup() {
  const used = new Set(session.hiits.map(g => g.tag));
  let tag = 'A';
  for (let i = 0; i < 26; i++) { const t = String.fromCharCode(65 + i); if (!used.has(t)) { tag = t; break; } }
  const prev = session.hiits[session.hiits.length - 1];
  session.hiits.push({ tag, params: prev ? { ...prev.params } : DEFAULT_HIIT(), items: [] });
  session.hiitIdx = session.hiits.length - 1;
}
// 確保有一組可編輯（有空組就沿用，不重複新增）
function ensureHiit() {
  const empty = session.hiits.findIndex(g => !g.items.length);
  if (empty >= 0) session.hiitIdx = empty;
  else addHiitGroup();
}

let toastT;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => el.remove(), 1600);
}

async function saveMd() {
  const s = exportSession();
  const text = buildMd(s, blocks, customs);              // 同步先算，保住 user-activation
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
  if (bumpCustomBest(customs, session)) saveCustoms();
  store.clearSession();
  toast('已存檔，可開始新的一場');
  session = null; setupParts = [];
  render();
}

boot();
