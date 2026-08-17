import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newSession, addEntry, addSet, removeSet, adjustWeight, adjustReps, commitHistory,
  nextGroupTag, toggleSupersetWithPrev, groupIndices, addSetToGroup
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
