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
