import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { JsonStore } from '../../cloudflare/store.mjs';

test('large Unicode saves use bounded SQLite rows and failed writes roll back', () => {
  const db = new DatabaseSync(':memory:');
  let fail = false;
  const storage = {
    sql: { exec(query, ...params) {
      if (fail && query.startsWith('INSERT') && params[1] === 1) throw new Error('injected storage failure');
      const rows = db.prepare(query).all(...params); return { toArray: () => rows };
    } },
    transactionSync(fn) {
      db.exec('BEGIN'); try { const out = fn(); db.exec('COMMIT'); return out; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  try {
    const store = new JsonStore(storage);
    assert.equal(store.load('garden'), null);
    const save = { text: '花园🌿'.repeat(350000), revision: 9 };
    store.save('garden', save); assert.deepEqual(store.load('garden'), save);
    const sizes = db.prepare('SELECT length(CAST(value AS BLOB)) AS bytes FROM documents').all();
    assert.ok(sizes.length > 20); assert.ok(sizes.every(r => r.bytes < 128 * 1024));
    const before = db.prepare('SELECT total_changes() AS n').get().n;
    store.save('garden', save);
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n, before);
    fail = true;
    assert.throws(() => store.save('garden', { text: 'different'.repeat(15000) }), /storage failure/);
    assert.deepEqual(store.load('garden'), save);
    fail = false;
    store.save('garden', { revision: 10 }); assert.deepEqual(store.load('garden'), { revision: 10 });
    assert.equal(db.prepare('SELECT count(*) AS n FROM documents').get().n, 1);
  } finally { db.close(); }
});
