import { getDb } from '../../db/sqlite.js';
import { promptId } from '../../utils/ids.js';

function savePrompt(config, options) {
  const { session_id, project = null, content } = options;
  const id = options.id || promptId();
  const db = getDb(config);
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO prompts (id, session_id, project, content, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, session_id, project, content ?? '', now);
  return { id, created_at: now };
}

export { savePrompt };
