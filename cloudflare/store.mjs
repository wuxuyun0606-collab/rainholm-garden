// Split JSON into small SQLite rows; writes are atomic, including retry receipts.
// Unlike a single KV value, a mature save can safely grow beyond 2 MiB.
export class JsonStore {
  constructor(storage) {
    this.storage = storage;
    storage.sql.exec('CREATE TABLE IF NOT EXISTS documents (name TEXT NOT NULL, part INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY (name, part))');
  }
  load(name) {
    const rows = this.storage.sql.exec('SELECT value FROM documents WHERE name = ? ORDER BY part', name).toArray();
    return rows.length ? JSON.parse(rows.map(r => r.value).join('')) : null;
  }
  save(name, value) {
    const text = JSON.stringify(value), chunks = [];
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + 30000, text.length);
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
      chunks.push(text.slice(start, end)); start = end;
    }
    this.storage.transactionSync(() => {
      const before = this.storage.sql.exec('SELECT part, value FROM documents WHERE name = ? ORDER BY part', name).toArray();
      for (let i = 0; i < chunks.length; i++) if (before[i]?.value !== chunks[i]) {
        this.storage.sql.exec('INSERT INTO documents (name, part, value) VALUES (?, ?, ?) ON CONFLICT(name, part) DO UPDATE SET value = excluded.value', name, i, chunks[i]);
      }
      if (before.length > chunks.length) this.storage.sql.exec('DELETE FROM documents WHERE name = ? AND part >= ?', name, chunks.length);
    });
  }
}
