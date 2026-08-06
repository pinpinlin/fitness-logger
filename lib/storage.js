// storage.js — localStorage 薄封裝（讀取一律 try/catch，壞資料視為空）
const K = { session: 'fl.session.v1', history: 'fl.history.v1', prefs: 'fl.prefs.v1' };

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

export const loadPrefs = () => read(K.prefs, { schema: 1, restDefault: 90, restOptions: [90, 120] });
export const savePrefs = (p) => write(K.prefs, p);
