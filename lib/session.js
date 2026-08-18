// session.js — 純函式狀態轉換（無 DOM，可 node --test）

// 產生序號 id（呼叫端傳入遞增器，避免 Date.now/random 讓測試不穩）
export function newSession(dateISO, parts, restSeconds = 90) {
  return {
    schema: 1,
    date: dateISO,
    parts: [...parts],
    screen: 'LOG',
    entries: [],
    overallNote: '',
    restSeconds,
    restEndAt: null
  };
}

// 場次日期只在建場時蓋章，跨夜恢復未完成場次時會過期。
// boot() 載入 session 後呼叫此函式重新蓋成今天；回傳是否有改動（決定要不要存回）。
export function restampDate(session, today) {
  if (!session || session.date === today) return false;
  session.date = today;
  return true;
}

function blankSet() {
  return { weight: null, reps: null, rpe: null };
}

// 深拷貝一組 sets（避免與 history 共用參照）
function cloneSets(sets) {
  return sets.map(s => ({ weight: s.weight ?? null, reps: s.reps ?? null, rpe: s.rpe ?? null }));
}

// 加入動作，**預設只給一組**：有 history 就用上次第一組的數字當起點，否則空組。
// （要更多組由使用者按「＋加一組」，會複製上一組數字）
// exercise: {name,型式,部位}；history: {name: {sets:[…]}}
export function addEntry(session, exercise, history, id) {
  const prev = history && history[exercise.name];
  const sets = (prev && Array.isArray(prev.sets) && prev.sets.length)
    ? cloneSets(prev.sets.slice(0, 1))
    : [blankSet()];
  session.entries.push({
    id,
    name: exercise.name,
    型式: exercise.型式,
    部位: exercise.部位,
    note: '',
    sg: null,        // 超級組代號（null＝獨立動作）
    sets
  });
  return session;
}

// 加一組：複製上一組數字（無組則空組）
export function addSet(entry) {
  const last = entry.sets[entry.sets.length - 1];
  entry.sets.push(last ? { weight: last.weight, reps: last.reps, rpe: last.rpe } : blankSet());
  return entry;
}

/* ── 超級組（2~3 動作連續做、中間不休息）──
   entry.sg = 'A'|'B'|… ；同 sg 且相鄰的 entries 為一組。 */

// 取下一個可用的組代號
export function nextGroupTag(session) {
  const used = new Set(session.entries.map(e => e.sg).filter(Boolean));
  for (let i = 0; i < 26; i++) {
    const t = String.fromCharCode(65 + i);
    if (!used.has(t)) return t;
  }
  return 'A';
}

// 把 index 的動作與「上一個」串成超級組；已在組內則脫離該組
export function toggleSupersetWithPrev(session, index) {
  const cur = session.entries[index], prev = session.entries[index - 1];
  if (!cur) return session;
  if (cur.sg) { cur.sg = null; return session; }      // 取消
  if (!prev) return session;                           // 第一個沒有上一個可連
  cur.sg = prev.sg || (prev.sg = nextGroupTag(session));
  return session;
}

// 同組（相鄰且同 sg）的 entry 索引
export function groupIndices(session, index) {
  const sg = session.entries[index] && session.entries[index].sg;
  if (!sg) return [index];
  const out = [];
  let i = index; while (i >= 0 && session.entries[i].sg === sg) { out.unshift(i); i--; }
  i = index + 1; while (i < session.entries.length && session.entries[i].sg === sg) { out.push(i); i++; }
  return out;
}

// 超級組：整輪做完才加一組 → 組內每個動作各加一組
export function addSetToGroup(session, index) {
  for (const i of groupIndices(session, index)) addSet(session.entries[i]);
  return session;
}

export function removeSet(entry, idx) {
  entry.sets.splice(idx, 1);
  if (entry.sets.length === 0) entry.sets.push(blankSet());
  return entry;
}

// 重量 ±delta：從 null(自重) 起加為 delta；降到 ≤0 回 null(自重)
export function adjustWeight(set, delta) {
  const cur = (set.weight === null || set.weight === undefined || set.weight === '') ? 0 : Number(set.weight);
  const next = Math.round((cur + delta) * 100) / 100;
  set.weight = next <= 0 ? null : next;
  return set.weight;
}

// 次數 ±delta：不低於 0
export function adjustReps(set, delta) {
  const cur = (set.reps === null || set.reps === undefined || set.reps === '') ? 0 : Number(set.reps);
  set.reps = Math.max(0, cur + delta);
  return set.reps;
}

// 產出成功後：把每動作最後狀態寫進 history（供下次帶出）
export function commitHistory(session, history) {
  for (const e of session.entries) {
    const sets = e.sets.filter(s => s.reps !== null && s.reps !== undefined && s.reps !== '');
    if (sets.length) history[e.name] = { date: session.date, sets: sets.map(s => ({ ...s })) };
  }
  return history;
}
