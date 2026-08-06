import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PART_ORDER, partsLabel, fileName, formatSetToken, formatSetsField,
  exerciseLine, frontmatterParts, buildMd
} from '../lib/format.js';

const summaryBlock = readFileSync(fileURLToPath(new URL('../summary-block.txt', import.meta.url)), 'utf8');

test('partsLabel 依 PART_ORDER 排序', () => {
  assert.equal(partsLabel(['臂', '胸']), '胸臂');
  assert.equal(partsLabel(['核心']), '核心');
  assert.equal(partsLabel(['腿', '核心', '胸', '肩', '臂', '背']), '胸背肩臂腿核心');
});

test('fileName', () => {
  assert.equal(fileName('2026-08-06', ['臂', '胸']), '2026-08-06-胸臂.md');
});

test('formatSetToken：一般/自重/無RPE/小數', () => {
  assert.equal(formatSetToken({ weight: 80, reps: 5, rpe: 9 }), '80×5@9');
  assert.equal(formatSetToken({ weight: null, reps: 15, rpe: 8 }), '自重×15@8');
  assert.equal(formatSetToken({ weight: 80, reps: 5, rpe: null }), '80×5');
  assert.equal(formatSetToken({ weight: 2.5, reps: 12, rpe: null }), '2.5×12');
});

test('formatSetsField 多組串接、跳過無 reps', () => {
  const sets = [{ weight: 80, reps: 5, rpe: 9 }, { weight: 85, reps: 5, rpe: 10 }, { weight: 90, reps: null, rpe: null }];
  assert.equal(formatSetsField(sets), '80×5@9, 85×5@10');
});

test('exerciseLine 有/無備註', () => {
  const base = { name: '中胸 水平 推 史密斯', 型式: '半機械式', sets: [{ weight: 80, reps: 5, rpe: 9 }] };
  assert.equal(exerciseLine({ ...base, note: '' }),
    '[[中胸 水平 推 史密斯]] (型式:: 半機械式) (組:: 80×5@9)');
  assert.equal(exerciseLine({ ...base, note: '座椅第4格' }),
    '[[中胸 水平 推 史密斯]] (型式:: 半機械式) (組:: 80×5@9) (備註:: 座椅第4格)');
});

test('frontmatterParts 依序', () => {
  assert.equal(frontmatterParts(['臂', '胸']), '  - "[[胸]]"\n  - "[[臂]]"');
});

test('buildMd 契約結構＋內嵌 summaryBlock＋備註省略', () => {
  const session = {
    date: '2026-08-06', parts: ['胸', '臂'], overallNote: '狀態不錯',
    entries: [
      { name: '中胸 水平 推 史密斯', 型式: '半機械式', note: '座椅第4格', sets: [{ weight: 80, reps: 5, rpe: 9 }, { weight: 85, reps: 5, rpe: 10 }] },
      { name: '上腹 水平 捲腹', 型式: '徒手', note: '', sets: [{ weight: null, reps: 15, rpe: 8 }] },
      { name: '未記空動作', 型式: '自由重量', note: '', sets: [{ weight: null, reps: null, rpe: null }] }
    ]
  };
  const md = buildMd(session, summaryBlock);
  assert.match(md, /^---\ntype: workout\ndate: 2026-08-06\ntags: \[life\/fitness\]\n部位:\n  - "\[\[胸\]\]"\n  - "\[\[臂\]\]"\n計畫: "\[\[訓練計畫\]\]"\n---/);
  assert.match(md, /# 2026-08-06 訓練（胸臂）/);
  assert.ok(md.includes('[[中胸 水平 推 史密斯]] (型式:: 半機械式) (組:: 80×5@9, 85×5@10) (備註:: 座椅第4格)'));
  assert.ok(md.includes('[[上腹 水平 捲腹]] (型式:: 徒手) (組:: 自重×15@8)'));
  assert.ok(!md.includes('未記空動作'), '無組的動作不應輸出');
  assert.ok(md.includes(summaryBlock), '須內嵌範本本次總覽區塊');
  assert.ok(md.includes('## 體感/心得\n- 狀態不錯'));
  assert.ok(md.includes('## 下次調整\n- '));
  assert.ok(!md.includes('(備註:: )'), '空備註不應輸出');
});

test('summary-block 用自重感知正則（與 parser.test.mjs 一致）', () => {
  assert.ok(summaryBlock.includes('(?:(自重|[\\d.]+)\\s*[×x]\\s*)?([\\d+]+)'),
    'summary-block.txt 必須含自重感知 token 正則');
});
