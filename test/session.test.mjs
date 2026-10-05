import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newSession, addEntry, addSet, removeSet, adjustWeight, adjustReps, commitHistory,
  nextGroupTag, toggleSupersetWithPrev, groupIndices, addSetToGroup, restampDate,
  moveEntry, normalizeGroups, applyRenames
} from '../lib/session.js';

/* ── 超級組 ── */
const mkSession = names => {
  const s = newSession('2026-08-12', ['胸'], 90);
  names.forEach((n, i) => addEntry(s, { name: n, 型式: '自由重量', 部位: '胸' }, {}, 'u' + i));
  s.entries.forEach(e => { e.sets = [{ weight: 20, reps: 10, rpe: null }]; });
  return s;
};

test('toggleSupersetWithPrev：串成組、再點取消', () => {
  const s = mkSession(['A', 'B', 'C']);
  toggleSupersetWithPrev(s, 1);
  assert.equal(s.entries[0].sg, 'A', '上一個動作也被納入同組');
  assert.equal(s.entries[1].sg, 'A');
  assert.equal(s.entries[2].sg, null, '第三個未受影響');
  toggleSupersetWithPrev(s, 2);
  assert.equal(s.entries[2].sg, 'A', '接第三個進同組');
  toggleSupersetWithPrev(s, 2);
  assert.equal(s.entries[2].sg, null, '再點脫離');
});

test('toggleSupersetWithPrev：第一個動作無上一個，不成組', () => {
  const s = mkSession(['A', 'B']);
  toggleSupersetWithPrev(s, 0);
  assert.equal(s.entries[0].sg, null);
});

test('nextGroupTag 避開已用代號', () => {
  const s = mkSession(['A', 'B']);
  s.entries[0].sg = 'A'; s.entries[1].sg = 'A';
  assert.equal(nextGroupTag(s), 'B');
});

test('groupIndices 只含相鄰同組', () => {
  const s = mkSession(['A', 'B', 'C']);
  s.entries[0].sg = 'A'; s.entries[1].sg = 'A';
  assert.deepEqual(groupIndices(s, 0), [0, 1]);
  assert.deepEqual(groupIndices(s, 1), [0, 1]);
  assert.deepEqual(groupIndices(s, 2), [2], '非組內動作只回自己');
});

test('addSetToGroup：整輪加組，組內全部同步＋不影響組外', () => {
  const s = mkSession(['A', 'B', 'C']);
  s.entries[0].sg = 'A'; s.entries[1].sg = 'A';
  addSetToGroup(s, 0);
  assert.equal(s.entries[0].sets.length, 2);
  assert.equal(s.entries[1].sets.length, 2);
  assert.equal(s.entries[2].sets.length, 1, '組外動作不該被加組');
});

test('newSession 初值', () => {
  const s = newSession('2026-08-06', ['胸', '臂'], 120);
  assert.equal(s.date, '2026-08-06');
  assert.deepEqual(s.parts, ['胸', '臂']);
  assert.equal(s.restSeconds, 120);
  assert.deepEqual(s.entries, []);
});

test('addEntry 預設只給一組（即使 history 有多組）', () => {
  const s = newSession('2026-08-06', ['胸'], 90);
  const history = { A: { sets: [{ weight: 80, reps: 5, rpe: 9 }, { weight: 85, reps: 5, rpe: 10 }, { weight: 85, reps: 3, rpe: 10 }] } };
  addEntry(s, { name: 'A', 型式: '半機械式', 部位: '胸' }, history, 'u1');
  assert.equal(s.entries[0].sets.length, 1, '加入動作時只預填一組');
  assert.deepEqual(s.entries[0].sets[0], { weight: 80, reps: 5, rpe: 9 }, '用上次第一組當起點');
});

test('addEntry 帶出 history（深拷貝、不共參照）', () => {
  const s = newSession('2026-08-06', ['胸'], 90);
  const history = { '中胸 水平 推 史密斯': { sets: [{ weight: 85, reps: 5, rpe: 10 }] } };
  addEntry(s, { name: '中胸 水平 推 史密斯', 型式: '半機械式', 部位: '胸' }, history, 'u1');
  assert.equal(s.entries.length, 1);
  assert.deepEqual(s.entries[0].sets, [{ weight: 85, reps: 5, rpe: 10 }]);
  // 改 session 不應污染 history
  s.entries[0].sets[0].weight = 999;
  assert.equal(history['中胸 水平 推 史密斯'].sets[0].weight, 85, 'history 不可被共用參照污染');
});

test('addEntry 無 history → 一空組', () => {
  const s = newSession('2026-08-06', ['核心'], 90);
  addEntry(s, { name: '上腹 水平 捲腹', 型式: '徒手', 部位: '核心' }, {}, 'u1');
  assert.deepEqual(s.entries[0].sets, [{ weight: null, reps: null, rpe: null }]);
});

test('adjustWeight：null→+2.5=2.5；2.5→-2.5→null(自重)', () => {
  const set = { weight: null, reps: 10, rpe: null };
  assert.equal(adjustWeight(set, 2.5), 2.5);
  assert.equal(set.weight, 2.5);
  assert.equal(adjustWeight(set, -2.5), null);
  assert.equal(set.weight, null);
});

test('adjustWeight 可跨 0 進輔助區（負值＝機台幫忙扛；UI step 為 ±2）', () => {
  const set = { weight: 2, reps: 10, rpe: null };
  assert.equal(adjustWeight(set, -2), null, '歸零＝自重');
  assert.equal(adjustWeight(set, -2), -2, '再往下＝輔助 2kg');
  assert.equal(adjustWeight(set, -2), -4);
  assert.equal(adjustWeight(set, 2), -2, '往回加');
  assert.equal(adjustWeight(set, 2), null, '回到自重');
  assert.equal(adjustWeight(set, 2), 2, '再加變負重');
});

test('adjustReps：null→+1=1；1→-1=0；0→-1=0(下限)', () => {
  const set = { weight: 20, reps: null, rpe: null };
  assert.equal(adjustReps(set, 1), 1);
  assert.equal(adjustReps(set, -1), 0);
  assert.equal(adjustReps(set, -1), 0);
});

test('addSet 複製上一組數字', () => {
  const entry = { sets: [{ weight: 80, reps: 5, rpe: 9 }] };
  addSet(entry);
  assert.deepEqual(entry.sets[1], { weight: 80, reps: 5, rpe: 9 });
  entry.sets[1].reps = 6;
  assert.equal(entry.sets[0].reps, 5, '新組不可與舊組共用參照');
});

test('removeSet 移到 0 組時補一空組', () => {
  const entry = { sets: [{ weight: 80, reps: 5, rpe: 9 }] };
  removeSet(entry, 0);
  assert.deepEqual(entry.sets, [{ weight: null, reps: null, rpe: null }]);
});

test('commitHistory 只寫有 reps 的組', () => {
  const s = newSession('2026-08-06', ['胸'], 90);
  s.entries = [
    { name: 'A', sets: [{ weight: 80, reps: 5, rpe: 9 }, { weight: 85, reps: null, rpe: null }] },
    { name: 'B', sets: [{ weight: null, reps: null, rpe: null }] }
  ];
  const history = {};
  commitHistory(s, history);
  assert.deepEqual(history.A.sets, [{ weight: 80, reps: 5, rpe: 9 }]);
  assert.ok(!('B' in history), '無有效組的動作不寫 history');
});

/* ── restampDate ── */
test('restampDate：日期不同→改寫成今天並回傳 true', () => {
  const s = newSession('2026-08-17', ['腿'], 90);
  assert.equal(restampDate(s, '2026-08-18'), true);
  assert.equal(s.date, '2026-08-18');
});

test('restampDate：日期相同→不動並回傳 false', () => {
  const s = newSession('2026-08-18', ['腿'], 90);
  assert.equal(restampDate(s, '2026-08-18'), false);
  assert.equal(s.date, '2026-08-18');
});

test('restampDate：session 為 null／undefined→回傳 false 不拋錯', () => {
  assert.equal(restampDate(null, '2026-08-18'), false);
  assert.equal(restampDate(undefined, '2026-08-18'), false);
});

test('restampDate 之後 commitHistory 用新日期', () => {
  const s = newSession('2026-08-17', ['胸'], 90);
  s.entries = [{ name: '臥推', sets: [{ weight: 80, reps: 5, rpe: 9 }] }];
  restampDate(s, '2026-08-18');
  const history = {};
  commitHistory(s, history);
  assert.equal(history['臥推'].date, '2026-08-18');
});

/* ── 拖拉排序／分組整理 ── */
const tags = s => s.entries.map(e => `${e.name}${e.sg ? ':' + e.sg : ''}`).join(' ');

test('moveEntry merge：拖到獨立動作上 → 兩個組成新超級組', () => {
  const s = mkSession(['A', 'B', 'C']);
  moveEntry(s, 2, { mode: 'merge', target: 0 });
  assert.equal(tags(s), 'A:A C:A B');
});

test('moveEntry merge：拖進既有超級組（被誤拆的動作拉回去）', () => {
  const s = mkSession(['A', 'B', 'C', 'D']);
  s.entries[0].sg = 'A'; s.entries[1].sg = 'A';
  moveEntry(s, 3, { mode: 'merge', target: 1 });
  assert.equal(tags(s), 'A:A B:A D:A C');
});

test('moveEntry before/after：組內調順序、或插到組外變獨立', () => {
  const s = mkSession(['A', 'B', 'C']);
  s.entries[0].sg = 'A'; s.entries[1].sg = 'A'; s.entries[2].sg = 'A';
  moveEntry(s, 2, { mode: 'before', target: 0, sg: 'A' });
  assert.equal(tags(s), 'C:A A:A B:A', '組內換到最前');
  moveEntry(s, 0, { mode: 'end' });
  assert.equal(tags(s), 'A:A B:A C', '拖出組外 → 獨立');
});

test('moveEntry：組只剩一個動作 → 自動解散', () => {
  const s = mkSession(['A', 'B', 'C']);
  s.entries[0].sg = 'A'; s.entries[1].sg = 'A';
  moveEntry(s, 1, { mode: 'end' });
  assert.equal(tags(s), 'A C B');
});

test('normalizeGroups：同代號被拆成兩段 → 後段換新代號', () => {
  const s = mkSession(['A', 'B', 'C', 'D', 'E']);
  ['A', 'A', null, 'A', 'A'].forEach((g, i) => { s.entries[i].sg = g; });
  normalizeGroups(s);
  assert.equal(tags(s), 'A:A B:A C D:B E:B');
});

test('moveEntry：拖到自己或不存在的目標 → 不動', () => {
  const s = mkSession(['A', 'B']);
  moveEntry(s, 0, { mode: 'merge', target: 0 });
  moveEntry(s, 0, { mode: 'after', target: 9 });
  assert.equal(tags(s), 'A B');
});

test('applyRenames：history 與未完成場次一起換名', () => {
  const s = mkSession(['舊', 'X']);
  const h = { 舊: { sets: [{ weight: 10, reps: 12, rpe: null }] } };
  assert.equal(applyRenames(s, h, { 舊: '新' }), true);
  assert.equal(s.entries[0].name, '新');
  assert.deepEqual(Object.keys(h), ['新']);
  assert.equal(applyRenames(s, h, { 舊: '新' }), false, '第二次無改動');
});
