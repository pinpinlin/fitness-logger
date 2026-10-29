// storage.js — localStorage 薄封裝（讀取一律 try/catch，壞資料視為空）
const K = { session: 'fl.session.v1', history: 'fl.history.v1', prefs: 'fl.prefs.v1', custom: 'fl.custom.v1' };

function read(k, fallback) {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function write(k, val) {
  try { localStorage.setItem(k, JSON.stringify(val)); } catch { /* 配額/隱私模式：忽略 */ }
}

export const loadSession = () => read(K.session, null);
export const saveSession = (s) => write(K.session, s);
export const clearSession = () => { try { localStorage.removeItem(K.session); } catch {} };

export const loadHistory = () => read(K.history, {});
export const saveHistory = (h) => write(K.history, h);

// 手機新增、尚未入庫的動作（Record<name, Custom>）；壞資料／非物件一律回 {}
export const loadCustoms = () => {
  const c = read(K.custom, {});
  if (!c || typeof c !== 'object' || Array.isArray(c)) return {};
  // 丟掉壞條目（值不是帶字串 name 的物件），否則 boot 對帳會丟例外、畫面空白
  return Object.fromEntries(Object.entries(c).filter(([, v]) => v && typeof v === 'object' && typeof v.name === 'string'));
};
export const saveCustoms = (c) => write(K.custom, c);

export const loadPrefs = () => read(K.prefs, { schema: 1, restDefault: 90, restOptions: [90, 120] });
export const savePrefs = (p) => write(K.prefs, p);
