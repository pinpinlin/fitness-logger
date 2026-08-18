import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PART_ORDER, partsLabel, fileName, sessionSlug, formatSetToken, formatSetsField,
  exerciseLine, frontmatterParts, buildMd,
  hiitTotalSeconds, fmtDuration, hiitLine, cardioLine, sessionTypes
} from '../lib/format.js';

const rd = f => readFileSync(fileURLToPath(new URL('../' + f, import.meta.url)), 'utf8');
const summaryBlock = rd('summary-block.txt');
const blocks = {
  summary: summaryBlock,
  hiitSummary: rd('summary-hiit-block.txt'),
  cardioSummary: rd('summary-cardio-block.txt')
};

/* 三種型態的最小 session fixture（Step 1、Step 2 共用） */
const mkStrength = (date, parts) => ({
  date, parts, entries: [{ name: '臥推', sets: [{ weight: 80, reps: 5, rpe: 9 }] }],
  hiit: null, cardio: []
});
const mkCardio = (date, parts) => ({
  date, parts, entries: [], hiit: null,
  cardio: [{ name: '跑步機 坡度快走', minutes: 22, km: 1.4, intensity: '坡15' }]
});
const mkHiit = (date, parts) => ({
  date, parts, entries: [], cardio: [],
  hiit: { params: { workSec: 20, restSec: 10, rounds: 3, roundRestSec: 60 }, items: [{ name: '開合跳', doneRounds: 3, load: null }] }
});
const mkHiitCardio = (date, parts) => ({
  ...mkHiit(date, parts),
  cardio: [{ name: '跑步機 坡度快走', minutes: 22, km: null, intensity: '' }]
});

test('partsLabel 依 PART_ORDER 排序', () => {
  assert.equal(partsLabel(['臂', '胸']), '胸臂');
  assert.equal(partsLabel(['核心']), '核心');
  assert.equal(partsLabel(['腿', '核心', '胸', '肩', '臂', '背']), '胸背肩臂腿核心');
});

test('fileName：重訓場帶型態前綴', () => {
  assert.equal(fileName(mkStrength('2026-08-06', ['臂', '胸'])), '2026-08-06-重訓-胸臂.md');
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

test('exerciseLine 超級組標記（欄位順序：組→超級組→備註）', () => {
  const base = { name: 'A', 型式: '自由重量', sets: [{ weight: 20, reps: 10, rpe: null }] };
  assert.equal(exerciseLine({ ...base, sg: 'A', note: '' }), '[[A]] (型式:: 自由重量) (組:: 20×10) (超級組:: A)');
  assert.equal(exerciseLine({ ...base, sg: 'A', note: '慢放' }), '[[A]] (型式:: 自由重量) (組:: 20×10) (超級組:: A) (備註:: 慢放)');
  assert.equal(exerciseLine({ ...base, sg: null, note: '' }), '[[A]] (型式:: 自由重量) (組:: 20×10)', '無超級組不輸出該欄位');
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
  assert.match(md, /^---\ntype: workout\ndate: 2026-08-06\ntags: \[life\/fitness\]\n部位:\n  - "\[\[胸\]\]"\n  - "\[\[臂\]\]"\n型態: \[重訓\]\n計畫: "\[\[訓練計畫\]\]"\n---/);
  assert.match(md, /# 2026-08-06-重訓-胸臂/);
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

/* ── 計畫三：HIIT／有氧 ── */

test('hiitTotalSeconds／fmtDuration', () => {
  const p = { workSec: 40, restSec: 20, rounds: 4, roundRestSec: 60 };
  assert.equal(hiitTotalSeconds(p, 2), 2 * 60 * 4 + 180);
  assert.equal(fmtDuration(660), '11:00');
  assert.equal(fmtDuration(65), '1:05');
  assert.equal(hiitTotalSeconds({ workSec: 30, restSec: 10, rounds: 1, roundRestSec: 60 }, 3), 120);
});

test('hiitLine 負重：有值輸出、空/0 視為徒手不輸出', () => {
  assert.equal(hiitLine({ name: '臀橋', doneRounds: 3, load: 10 }), '[[臀橋]] (型態:: HIIT) (完成:: 3輪) (負重:: 10kg)');
  assert.equal(hiitLine({ name: '臀橋', doneRounds: 3, load: 7.5 }), '[[臀橋]] (型態:: HIIT) (完成:: 3輪) (負重:: 7.5kg)');
  assert.equal(hiitLine({ name: '臀橋', doneRounds: 3, load: null }), '[[臀橋]] (型態:: HIIT) (完成:: 3輪)');
  assert.equal(hiitLine({ name: '臀橋', doneRounds: 3, load: '' }), '[[臀橋]] (型態:: HIIT) (完成:: 3輪)');
});

test('hiitLine／cardioLine（空欄位省略）', () => {
  assert.equal(hiitLine({ name: '波比跳', doneRounds: 4 }), '[[波比跳]] (型態:: HIIT) (完成:: 4輪)');
  assert.equal(cardioLine({ name: '跑步機 跑步', minutes: 30, km: 5.2, intensity: '8.5km/h 坡3' }),
    '[[跑步機 跑步]] (型態:: 有氧) (時間:: 30分) (距離:: 5.2km) (強度:: 8.5km/h 坡3)');
  assert.equal(cardioLine({ name: '橢圓機', minutes: 20, km: '', intensity: '' }),
    '[[橢圓機]] (型態:: 有氧) (時間:: 20分)');
});

test('sessionTypes 依實際內容', () => {
  const lift = { entries: [{ name: 'A', 型式: '自由重量', note: '', sets: [{ weight: 20, reps: 10, rpe: null }] }] };
  assert.deepEqual(sessionTypes(lift), ['重訓']);
  assert.deepEqual(sessionTypes({ entries: [], hiit: { items: [{ name: '波比跳', doneRounds: 4 }] } }), ['HIIT']);
  assert.deepEqual(sessionTypes({ entries: [], cardio: [{ name: '橢圓機', minutes: 20 }] }), ['有氧']);
  assert.deepEqual(sessionTypes({ ...lift, hiit: { items: [{ name: '波比跳', doneRounds: 4 }] }, cardio: [{ name: '橢圓機', minutes: 20 }] }),
    ['重訓', 'HIIT', '有氧']);
});

test('fileName：無部位時型態單獨成段，不留空連字號', () => {
  assert.equal(fileName(mkHiit('2026-08-10', [])), '2026-08-10-HIIT.md');
});

test('buildMd 混合場：三區塊齊全、(組:: 只在重訓行', () => {
  const session = {
    date: '2026-08-10', parts: ['肩', '腿'], overallNote: '混合場',
    entries: [{ name: '前肩 推 啞鈴 中距', 型式: '自由重量', note: '', sets: [{ weight: 20, reps: 13, rpe: 9 }] }],
    hiit: { params: { workSec: 40, restSec: 20, rounds: 4, roundRestSec: 60 }, items: [{ name: '波比跳', doneRounds: 4 }, { name: '登山者', doneRounds: 3 }] },
    cardio: [{ name: '跑步機 跑步', minutes: 30, km: 5.2, intensity: '8.5km/h 坡3' }]
  };
  const md = buildMd(session, blocks);
  assert.match(md, /型態: \[重訓, HIIT, 有氧\]/);
  assert.match(md, /HIIT每項秒: 40\nHIIT項間休: 20\nHIIT輪數: 4\nHIIT輪間休: 60/);
  assert.ok(md.includes('# 2026-08-10-重訓HIIT有氧-肩腿'));
  assert.ok(md.includes('[[前肩 推 啞鈴 中距]] (型式:: 自由重量) (組:: 20×13@9)'));
  assert.ok(md.includes('> 每項 40 秒 ｜ 項間休 20 秒 ｜ 4 輪 ｜ 輪間休 60 秒 ｜ 總時長 11:00'));
  assert.ok(md.includes('[[波比跳]] (型態:: HIIT) (完成:: 4輪)'));
  assert.ok(md.includes('[[登山者]] (型態:: HIIT) (完成:: 3輪)'));
  assert.ok(md.includes('[[跑步機 跑步]] (型態:: 有氧) (時間:: 30分) (距離:: 5.2km) (強度:: 8.5km/h 坡3)'));
  assert.ok(md.includes(blocks.hiitSummary) && md.includes(blocks.cardioSummary));
  // 零回歸：資料行中 (組:: 只出現在唯一的重訓行（排除 dataviewjs 區塊內的正則字串）
  const dataLines = md.split('\n').filter(l => l.startsWith('[['));
  assert.equal(dataLines.filter(l => l.includes('(組::')).length, 1);
  for (const line of dataLines) {
    if (line.includes('(型態::')) assert.ok(!line.includes('(組::'), 'HIIT/有氧行不得含 (組::');
  }
});

test('buildMd 純 HIIT 場：不輸出課表與本次總覽', () => {
  const session = {
    date: '2026-08-10', parts: ['腿'], overallNote: '',
    entries: [],
    hiit: { params: { workSec: 30, restSec: 15, rounds: 3, roundRestSec: 45 }, items: [{ name: '開合跳', doneRounds: 3 }] },
    cardio: []
  };
  const md = buildMd(session, blocks);
  assert.ok(!md.includes('## 課表'), '無重訓不應出現課表');
  assert.ok(!md.includes('## 📊 本次總覽'), '無重訓不應出現本次總覽');
  assert.ok(!md.includes('## 🏃 有氧'), '無有氧不應出現有氧區塊');
  assert.match(md, /型態: \[HIIT\]/);
  assert.ok(md.includes('## 🔥 HIIT'));
});

test('buildMd 向後相容：blocks 傳字串＝只給 summary', () => {
  const session = {
    date: '2026-08-06', parts: ['胸'], overallNote: '',
    entries: [{ name: '中胸 胸推機', 型式: '機械式', note: '', sets: [{ weight: 50, reps: 10, rpe: 8 }] }]
  };
  const md = buildMd(session, summaryBlock);
  assert.ok(md.includes('## 📊 本次總覽（自動）'));
  assert.ok(md.includes(summaryBlock));
  assert.match(md, /型態: \[重訓\]/);
});

/* ── sessionSlug ── */
test('sessionSlug：純重訓', () => {
  assert.equal(sessionSlug(mkStrength('2026-08-18', ['胸', '臂'])), '2026-08-18-重訓-胸臂');
});

test('sessionSlug：純有氧（與重訓腿日不再撞名）', () => {
  assert.equal(sessionSlug(mkCardio('2026-08-18', ['腿'])), '2026-08-18-有氧-腿');
  assert.notEqual(sessionSlug(mkCardio('2026-08-18', ['腿'])), sessionSlug(mkStrength('2026-08-18', ['腿'])));
});

test('sessionSlug：HIIT＋有氧', () => {
  assert.equal(sessionSlug(mkHiitCardio('2026-08-18', ['肩', '腿'])), '2026-08-18-HIIT有氧-肩腿');
});

test('sessionSlug：三型態齊全→順序為 重訓HIIT有氧', () => {
  const s = mkHiitCardio('2026-08-18', ['胸', '腿']);
  s.entries = [{ name: '臥推', sets: [{ weight: 80, reps: 5, rpe: 9 }] }];
  assert.equal(sessionSlug(s), '2026-08-18-重訓HIIT有氧-胸腿');
});

test('sessionSlug：型態與部位皆空→只回日期', () => {
  assert.equal(sessionSlug({ date: '2026-08-18', parts: [], entries: [], hiit: null, cardio: [] }), '2026-08-18');
});

test('sessionSlug：型態空、部位非空（選了部位加動作但一組都沒記）', () => {
  assert.equal(sessionSlug({ date: '2026-08-18', parts: ['胸'], entries: [], hiit: null, cardio: [] }), '2026-08-18-胸');
});

test('buildMd 的 H1 與 fileName 去掉 .md 後一字不差', () => {
  const s = mkHiitCardio('2026-08-18', ['肩', '腿']);
  const md = buildMd(s, {});
  const h1 = md.split('\n').find(l => l.startsWith('# '));
  assert.equal(h1, `# ${fileName(s).replace(/\.md$/, '')}`);
});

// 對應 REVIEW 頁改日期：改 session.date 後檔名、H1、frontmatter 三處都要跟著變
test('改 session.date 後 fileName 與 buildMd 三處同步反映', () => {
  const s = mkStrength('2026-08-17', ['胸', '臂']);
  s.date = '2026-08-18';
  assert.equal(fileName(s), '2026-08-18-重訓-胸臂.md');
  const md = buildMd(s, {});
  assert.ok(md.includes('date: 2026-08-18'), 'frontmatter 的 date 要是新日期');
  assert.ok(md.includes('# 2026-08-18-重訓-胸臂'), 'H1 要是新日期');
  assert.ok(!md.includes('2026-08-17'), '不得殘留舊日期');
});
