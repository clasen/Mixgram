import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const databases = new WeakMap();

export function getDb(config) {
  if (databases.has(config)) return databases.get(config);
  fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true });
  const db = new Database(config.sqlitePath);
  try {
    const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='documents'").get();
    if (existing && !db.prepare('PRAGMA table_info(documents)').all().some(c => c.name === 'collection')) {
      throw new Error('Legacy database: Mixgram 2 requires a new SQLite path');
    }
    db.pragma('journal_mode = WAL');
    db.exec(fs.readFileSync(new URL('./migrations/001_initial.sql', import.meta.url), 'utf8'));
    databases.set(config, db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function closeDb(config) {
  databases.get(config)?.close();
  databases.delete(config);
}
