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

// '2026-08-06' + ['胸','臂'] → '2026-08-06-胸臂.md'
export function fileName(dateISO, parts) {
  return `${dateISO}-${partsLabel(parts)}.md`;
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

// 一行動作：'[[名]] (型式:: X) (組:: …) (備註:: …選填)'
export function exerciseLine(entry) {
  let line = `[[${entry.name}]] (型式:: ${entry.型式}) (組:: ${formatSetsField(entry.sets)})`;
  if (entry.note && entry.note.trim() !== '') {
    line += ` (備註:: ${entry.note.trim()})`;
  }
  return line;
}

// frontmatter 的 部位 list 區塊（依 PART_ORDER）
export function frontmatterParts(parts) {
  return orderParts(parts).map(p => `  - "[[${p}]]"`).join('\n');
}

// 整份 .md。summaryBlock = summary-block.txt 內容（```dataviewjs…``` 圍籬）。
// 只輸出「有記到組」的動作。
export function buildMd(session, summaryBlock) {
  const label = partsLabel(session.parts);
  const logged = session.entries.filter(e => formatSetsField(e.sets) !== '');
  const 課表 = logged.map(exerciseLine).join('\n');
  const overall = (session.overallNote || '').trim();
  return [
    '---',
    'type: workout',
    `date: ${session.date}`,
    'tags: [life/fitness]',
    '部位:',
    frontmatterParts(session.parts),
    '計畫: "[[訓練計畫]]"',
    '---',
    '',
    `# ${session.date} 訓練（${label}）`,
    '',
    '## 課表（填這區）',
    課表,
    '',
    '## 📊 本次總覽（自動）',
    summaryBlock,
    '',
    '## 體感/心得',
    `- ${overall}`,
    '',
    '## 下次調整',
    '- ',
    ''
  ].join('\n');
}
