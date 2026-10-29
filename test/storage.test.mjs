import { test } from 'node:test';
import assert from 'node:assert/strict';

// localStorage 樁：storage.js 的 read 直接用全域 localStorage
function stub(value) {
  globalThis.localStorage = { getItem: () => value, setItem() {}, removeItem() {} };
}

test('loadCustoms：丟掉壞條目（null／非物件／缺字串 name），好的保留', async () => {
  const { loadCustoms } = await import('../lib/storage.js');
  stub(JSON.stringify({ X: null, Y: 5, Z: { name: 3 }, W: {}, 好: { name: '好', 部位: '腿' } }));
  assert.deepEqual(Object.keys(loadCustoms()), ['好']);
});

test('loadCustoms：非物件／陣列／壞 JSON 回 {}', async () => {
  const { loadCustoms } = await import('../lib/storage.js');
  stub('[1,2]'); assert.deepEqual(loadCustoms(), {});
  stub('"abc"'); assert.deepEqual(loadCustoms(), {});
  stub('{bad'); assert.deepEqual(loadCustoms(), {});
  stub(null); assert.deepEqual(loadCustoms(), {});
});
