// format.js — 純函式（無 DOM，可 node --test）
// 負責：部位標籤/檔名、組 token、動作行、整份 .md 組裝。

export const PART_ORDER = ['胸', '背', '肩', '臂', '腿', '核心'];

// 依 PART_ORDER 排序去重
function orderParts(parts) {
  const seen = new Set();
  const out = [];
  for (const p of PART_ORDER) {
    if (parts.includes(p) && !seen.has(p)) { seen.add(p); out.push(p); }
  }
  return out;
}

// ['臂','胸'] → '胸臂'
export function partsLabel(parts) {
  return orderParts(parts).join('');
}

// 檔名與 H1 的單一真相來源，兩者結構上不可能分歧。
// 格式：日期-型態-部位，如 '2026-08-18-重訓-胸臂'、'2026-08-18-有氧-腿'
// 任一段為空則該段連同連字號一併省略（純 HIIT 且無部位 → '2026-08-18-HIIT'）
export function sessionSlug(session) {
  const types = sessionTypes(session).join('');
  const label = partsLabel(session.parts || []);
  const tail = [types, label].filter(Boolean).join('-');
  return tail ? `${session.date}-${tail}` : session.date;
}

export function fileName(session) {
  return `${sessionSlug(session)}.md`;
}

// weight 為 null/undefined/'' → 自重；rpe 空則略
// {weight:80,reps:5,rpe:9} → '80×5@9' ; {weight:null,reps:15,rpe:8} → '自重×15@8'
export function formatSetToken(set) {
  const w = (set.weight === null || set.weight === undefined || set.weight === '') ? '自重' : set.weight;
  const base = `${w}×${set.reps}`;
  const hasRpe = set.rpe !== null && set.rpe !== undefined && set.rpe !== '';
  return hasRpe ? `${base}@${set.rpe}` : base;
}

// sets → '80×5@9, 85×5@10'（只取有 reps 的組）
export function formatSetsField(sets) {
  return sets.filter(s => s.reps !== null && s.reps !== undefined && s.reps !== '')
    .map(formatSetToken).join(', ');
}

// 一行動作：'[[名]] (型式:: X) (組:: …) (超級組:: A選填) (備註:: …選填)'
export function exerciseLine(entry) {
  let line = `[[${entry.name}]] (型式:: ${entry.型式}) (組:: ${formatSetsField(entry.sets)})`;
  if (entry.sg) line += ` (超級組:: ${entry.sg})`;
  if (entry.note && entry.note.trim() !== '') {
    line += ` (備註:: ${entry.note.trim()})`;
  }
  return line;
}

// frontmatter 的 部位 list 區塊（依 PART_ORDER）
export function frontmatterParts(parts) {
  return orderParts(parts).map(p => `  - "[[${p}]]"`).join('\n');
}

/* ── HIIT ── */
// params: {workSec, restSec, rounds, roundRestSec}
export function hiitTotalSeconds(params, itemCount) {
  const { workSec, restSec, rounds, roundRestSec } = params;
  const perRound = itemCount * (Number(workSec) + Number(restSec));
  return perRound * Number(rounds) + Number(roundRestSec || 0) * Math.max(0, Number(rounds) - 1);
}

export function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// {name, doneRounds, load} → '[[名]] (型態:: HIIT) (完成:: 4輪) (負重:: 10kg)'
// load 空＝徒手，不輸出該欄位
export function hiitLine(item) {
  let line = `[[${item.name}]] (型態:: HIIT) (完成:: ${item.doneRounds}輪)`;
  if (item.load !== null && item.load !== undefined && String(item.load).trim() !== '') {
    line += ` (負重:: ${String(item.load).trim()}kg)`;
  }
  return line;
}

/* ── 有氧 ── */
// {name, minutes, km, intensity} → 空欄位省略
export function cardioLine(c) {
  let line = `[[${c.name}]] (型態:: 有氧)`;
  if (c.minutes !== null && c.minutes !== undefined && c.minutes !== '') line += ` (時間:: ${c.minutes}分)`;
  if (c.km !== null && c.km !== undefined && c.km !== '') line += ` (距離:: ${c.km}km)`;
  if (c.intensity && String(c.intensity).trim() !== '') line += ` (強度:: ${String(c.intensity).trim()})`;
  return line;
}

/* ── 本場型態 ── */
export function sessionTypes(session) {
  const t = [];
  if ((session.entries || []).some(e => formatSetsField(e.sets) !== '')) t.push('重訓');
  if (session.hiit && (session.hiit.items || []).length) t.push('HIIT');
  if ((session.cardio || []).length) t.push('有氧');
  return t;
}

// 整份 .md。blocks = {summary, hiitSummary, cardioSummary}（各為 ```dataviewjs…``` 圍籬字串）
// 向後相容：blocks 傳字串時視為 {summary}。區塊「有才輸出」。
export function buildMd(session, blocks) {
  const b = typeof blocks === 'string' ? { summary: blocks } : (blocks || {});
  const types = sessionTypes(session);
  const logged = (session.entries || []).filter(e => formatSetsField(e.sets) !== '');
  const hiitItems = session.hiit ? (session.hiit.items || []) : [];
  const cardio = session.cardio || [];
  const overall = (session.overallNote || '').trim();

  const L = ['---', 'type: workout', `date: ${session.date}`, 'tags: [life/fitness]',
    '部位:', frontmatterParts(session.parts)];
  if (types.length) L.push(`型態: [${types.join(', ')}]`);
  if (hiitItems.length && session.hiit.params) {
    const p = session.hiit.params;
    L.push(`HIIT每項秒: ${p.workSec}`, `HIIT項間休: ${p.restSec}`,
      `HIIT輪數: ${p.rounds}`, `HIIT輪間休: ${p.roundRestSec || 0}`);
  }
  L.push('計畫: "[[訓練計畫]]"', '---', '', `# ${sessionSlug(session)}`, '');

  if (logged.length) {
    L.push('## 課表（填這區）', ...logged.map(exerciseLine), '');
    if (b.summary) L.push('## 📊 本次總覽（自動）', b.summary, '');
  }
  if (hiitItems.length) {
    const p = session.hiit.params;
    const total = fmtDuration(hiitTotalSeconds(p, hiitItems.length));
    L.push('## 🔥 HIIT',
      `> 每項 ${p.workSec} 秒 ｜ 項間休 ${p.restSec} 秒 ｜ ${p.rounds} 輪 ｜ 輪間休 ${p.roundRestSec || 0} 秒 ｜ 總時長 ${total}`,
      ...hiitItems.map(hiitLine), '');
    if (b.hiitSummary) L.push('## 🔥 HIIT 總覽（自動）', b.hiitSummary, '');
  }
  if (cardio.length) {
    L.push('## 🏃 有氧', ...cardio.map(cardioLine), '');
    if (b.cardioSummary) L.push('## 🏃 有氧 總覽（自動）', b.cardioSummary, '');
  }
  L.push('## 體感/心得', `- ${overall}`, '', '## 下次調整', '- ', '');
  return L.join('\n');
}
