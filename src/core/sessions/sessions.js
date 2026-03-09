import { getDb } from '../../db/sqlite.js';
import { sessionId } from '../../utils/ids.js';

function startSession(config, options = {}) {
  const id = options.id || sessionId();
  const { project, directory } = options;
  const db = getDb(config);
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO sessions (id, project, directory, started_at) VALUES (?, ?, ?, ?)'
  ).run(id, project || '', directory ?? null, now);
  return { id, started_at: now };
}

function endSession(config, sessionIdParam) {
  const db = getDb(config);
  const now = new Date().toISOString();
  const r = db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(now, sessionIdParam);
  return { success: r.changes > 0, ended_at: now };
}

function getSession(config, sessionIdParam) {
  const db = getDb(config);
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionIdParam) ?? null;
}

export { startSession, endSession, getSession };
