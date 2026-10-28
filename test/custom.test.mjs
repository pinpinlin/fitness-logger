import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeName, guessXingshi, fieldOptions, findExisting, makeCustom,
  mergeExercises, reconcileCustoms, renameCustom, bumpCustomBest, newExerciseTag
} from '../lib/custom.js';

test('sanitizeName：去頭尾空白、合併空白、禁字換全形', () => {
  assert.equal(sanitizeName('  單腿  臀推 史密斯 '), '單腿 臀推 史密斯');
  assert.equal(sanitizeName('青蛙深蹲>深蹲'), '青蛙深蹲→深蹲');
  assert.equal(sanitizeName('a/b:c*d?e"f<g|h\\i'), 'a／b：c＊d？e＂f←g｜h＼i');
  assert.equal(sanitizeName('x[1]#^'), 'x［1］＃＾');
  assert.equal(sanitizeName('   '), '');
});
test('guessXingshi：核心優先、器材對應', () => {
  assert.equal(guessXingshi('核心', '啞鈴'), '徒手');
  assert.equal(guessXingshi('腿', '史密斯'), '半機械式');
  assert.equal(guessXingshi('背', '纜繩'), '機械式');
  assert.equal(guessXingshi('胸', '機台'), '機械式');
  assert.equal(guessXingshi('臂', '啞鈴'), '自由重量');
  assert.equal(guessXingshi('臂', ''), '自由重量');
});
test('fieldOptions：只列該部位用過的值、依次數多到少、去空值', () => {
  const ex = [
    { 部位: '腿', 區域: '前腿', 動作型: '蹲', 器材: '啞鈴' },
    { 部位: '腿', 區域: '前腿', 動作型: '腿推', 器材: '機台' },
    { 部位: '腿', 區域: '', 動作型: '蹲', 器材: '機台' },
    { 部位: '胸', 區域: '上胸', 動作型: '胸推', 器材: '史密斯' }];
  assert.deepEqual(fieldOptions(ex, '腿'), { 區域: ['前腿'], 動作型: ['蹲', '腿推'], 器材: ['機台', '啞鈴'] });
});
test('findExisting：清理後同名才算', () => {
  const ex = [{ name: '前腿 腿部伸張機' }];
  assert.equal(findExisting(ex, ' 前腿  腿部伸張機 ').name, '前腿 腿部伸張機');
  assert.equal(findExisting(ex, '前腿'), null);
});
test('makeCustom：快速新增只有名字與部位，型態預設重訓，型式自動推', () => {
  assert.deepEqual(makeCustom({ name: '單腿 臀推 史密斯', 部位: '腿' }),
    { name: '單腿 臀推 史密斯', 部位: '腿', 型態: ['重訓'], 區域: '', 動作型: '', 器材: '', 型式: '自由重量', custom: true, best: null });
  assert.equal(makeCustom({ name: 'x', 部位: '腿', 器材: '史密斯' }).型式, '半機械式');
  assert.equal(makeCustom({ name: 'x', 部位: '腿', 器材: '史密斯', 型式: '自由重量' }).型式, '自由重量', '手動指定優先');
});
test('mergeExercises：附加新動作、正式庫已有同名者不重複', () => {
  const ex = [{ name: 'A' }];
  const cs = { A: makeCustom({ name: 'A', 部位: '胸' }), B: makeCustom({ name: 'B', 部位: '胸' }) };
  assert.deepEqual(mergeExercises(ex, cs).map(e => e.name), ['A', 'B']);
  assert.equal(mergeExercises(ex, cs)[1].custom, true);
});
test('reconcileCustoms：已入庫同名→移除；對照有改名→移除並回報改名', () => {
  const cs = { 舊名: makeCustom({ name: '舊名', 部位: '腿' }), 同名: makeCustom({ name: '同名', 部位: '腿' }), 待確認: makeCustom({ name: '待確認', 部位: '腿' }) };
  const r = reconcileCustoms(cs, [{ name: '同名' }, { name: '正式名' }], { 舊名: '正式名', 同名: '同名' });
  assert.deepEqual(Object.keys(r.customs), ['待確認']);
  assert.deepEqual(r.renameMap, { 舊名: '正式名' }, '同名對照不算改名');
});
test('renameCustom：改鍵與 name；新名已存在則拒絕', () => {
  const cs = { A: makeCustom({ name: 'A', 部位: '胸' }), B: makeCustom({ name: 'B', 部位: '胸' }) };
  assert.equal(renameCustom(cs, 'A', 'B'), false);
  assert.equal(renameCustom(cs, 'A', 'C'), true);
  assert.deepEqual(Object.keys(cs).sort(), ['B', 'C']);
  assert.equal(cs.C.name, 'C');
});
test('bumpCustomBest：跨場累計最重、吃三態重量', () => {
  const cs = { N: makeCustom({ name: 'N', 部位: '腿' }) };
  const s1 = { entries: [{ name: 'N', sets: [{ weight: 40, reps: 8 }, { weight: 50, reps: 5 }] }, { name: '正式', sets: [{ weight: 99, reps: 1 }] }] };
  assert.equal(bumpCustomBest(cs, s1), true);
  assert.equal(cs.N.best, '50×5');
  assert.equal(bumpCustomBest(cs, { entries: [{ name: 'N', sets: [{ weight: 45, reps: 10 }] }] }), false, '較輕不覆蓋');
  const cb = { B: makeCustom({ name: 'B', 部位: '背' }) };
  bumpCustomBest(cb, { entries: [{ name: 'B', sets: [{ weight: -20, reps: 8 }, { weight: null, reps: 5 }] }] });
  assert.equal(cb.B.best, '自重×5');
});
test('newExerciseTag：固定欄位順序、空欄省略', () => {
  const full = makeCustom({ name: 'x', 部位: '腿', 型態: ['重訓', 'HIIT'], 區域: '臀腿', 動作型: '臀推', 器材: '史密斯' });
  assert.equal(newExerciseTag(full), '(新動作:: 部位=腿; 型態=重訓、HIIT; 區域=臀腿; 動作型=臀推; 器材=史密斯)');
  assert.equal(newExerciseTag(makeCustom({ name: 'x', 部位: '腿' })), '(新動作:: 部位=腿; 型態=重訓)');
});
