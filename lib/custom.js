// custom.js — 手機新增動作的純函式（無 DOM，可 node --test）
// 負責：名稱清理、欄位選項、型式推斷、與正式庫對帳、最重累計、log 標記。
import { formatSetToken } from './format.js';

// 檔名禁字＋破壞 wikilink 的字 → 全形對照
const BAD_CHARS = {
  '\\': '＼', '/': '／', ':': '：', '*': '＊', '?': '？', '"': '＂',
  '<': '←', '>': '→', '|': '｜', '[': '［', ']': '］', '#': '＃', '^': '＾'
};

// 去頭尾空白、合併連續空白、禁字換全形
export function sanitizeName(raw) {
  return String(raw ?? '')
    .replace(/[\\/:*?"<>|[\]#^]/g, c => BAD_CHARS[c])
    .replace(/\s+/g, ' ')
    .trim();
}

// 型式由部位＋器材推：核心→徒手；史密斯→半機械式；機台/纜繩→機械式；其他→自由重量
export function guessXingshi(部位, 器材) {
  if (部位 === '核心') return '徒手';
  if (器材 === '史密斯') return '半機械式';
  if (器材 === '機台' || 器材 === '纜繩') return '機械式';
  return '自由重量';
}

// 該部位已用過的欄位值，依次數多到少（同次數依首次出現順序），去空值
export function fieldOptions(exercises, 部位) {
  const out = {};
  for (const f of ['區域', '動作型', '器材']) {
    const count = new Map();
    for (const e of exercises) {
      if (e.部位 !== 部位 || !e[f]) continue;
      count.set(e[f], (count.get(e[f]) || 0) + 1);
    }
    out[f] = [...count.entries()]
      .map(([v, n], i) => ({ v, n, i }))
      .sort((a, b) => b.n - a.n || a.i - b.i)
      .map(x => x.v);
  }
  return out;
}

// 清理後與正式庫同名 → 回傳該動作，否則 null
export function findExisting(exercises, name) {
  const n = sanitizeName(name);
  return exercises.find(e => e.name === n) || null;
}

export function makeCustom(f) {
  const 部位 = f.部位;
  const 器材 = f.器材 || '';
  return {
    name: f.name,
    部位,
    型態: f.型態 && f.型態.length ? [...f.型態] : ['重訓'],
    區域: f.區域 || '',
    動作型: f.動作型 || '',
    器材,
    型式: f.型式 || guessXingshi(部位, 器材),
    custom: true,
    best: null
  };
}

// 正式庫＋新動作（正式庫已有同名者不重複）
export function mergeExercises(exercises, customs) {
  const have = new Set(exercises.map(e => e.name));
  return [...exercises, ...Object.values(customs).filter(c => !have.has(c.name))];
}

// 與最新正式庫對帳：已入庫同名→移除；對照表有改名→移除並回報 {舊名: 正式名}
export function reconcileCustoms(customs, exercises, renames) {
  const have = new Set(exercises.map(e => e.name));
  const kept = {};
  const renameMap = {};
  for (const [name, c] of Object.entries(customs)) {
    const to = renames && renames[name];
    if (to && to !== name) renameMap[name] = to;
    else if (!have.has(name)) kept[name] = c;
  }
  return { customs: kept, renameMap };
}

// 改鍵與 name（就地）；新名已存在則拒絕
export function renameCustom(customs, oldName, newName) {
  if (!customs[oldName] || customs[newName]) return false;
  const c = customs[oldName];
  delete customs[oldName];
  c.name = newName;
  customs[newName] = c;
  return true;
}

// 'W×R' / '自重×R' / '自重-N×R' → {w, r}
function parseBest(s) {
  const m = typeof s === 'string' && s.match(/^(自重(?:-[\d.]+)?|[\d.]+)×(\d+)/);
  if (!m) return null;
  const rw = m[1];
  const w = rw.startsWith('自重') ? (rw.length > 2 ? -parseFloat(rw.slice(3)) : 0) : parseFloat(rw);
  return { w, r: parseInt(m[2]) };
}

// 本場出現的新動作，把最重一組累計進 customs[name].best（w 大者勝，同 w 比 reps）；有更新回傳 true
export function bumpCustomBest(customs, session) {
  let changed = false;
  for (const e of session.entries || []) {
    const c = customs[e.name];
    if (!c) continue;
    let best = parseBest(c.best);
    let improved = false;
    for (const s of e.sets || []) {
      if (s.reps === null || s.reps === undefined || s.reps === '') continue;
      const w = (s.weight === null || s.weight === undefined || s.weight === '') ? 0 : Number(s.weight);
      const r = Number(s.reps) || 0;
      if (!best || w > best.w || (w === best.w && r > best.r)) { best = { w, r }; improved = true; }
    }
    if (improved) {
      c.best = formatSetToken({ weight: best.w, reps: best.r });
      changed = true;
    }
  }
  return changed;
}

// log 行尾標記：(新動作:: 部位=腿; 型態=重訓、HIIT; 區域=…; 動作型=…; 器材=…)，空欄省略
export function newExerciseTag(c) {
  const parts = [`部位=${c.部位}`, `型態=${c.型態.join('、')}`];
  if (c.區域) parts.push(`區域=${c.區域}`);
  if (c.動作型) parts.push(`動作型=${c.動作型}`);
  if (c.器材) parts.push(`器材=${c.器材}`);
  return `(新動作:: ${parts.join('; ')})`;
}
