import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newSession, addEntry, addSet, removeSet, adjustWeight, adjustReps, commitHistory
} from '../lib/session.js';

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
