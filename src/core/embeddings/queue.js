import { randomUUID } from 'crypto';
import { getDb } from '../../db/sqlite.js';

export function enqueueDocuments(config, ids) {
  if (!config.embeddings.enabled) return;
  const db = getDb(config);
  const now = new Date().toISOString();
  const insert = db.prepare(`INSERT INTO embedding_jobs (id,document_id,content_hash,model_name,status,attempts,created_at,updated_at)
    SELECT ?,id,content_hash,?,'pending',0,?,? FROM documents WHERE id=? AND deleted_at IS NULL
    ON CONFLICT(id) DO UPDATE SET content_hash=excluded.content_hash,status='pending',attempts=0,last_error=NULL,updated_at=excluded.updated_at
    WHERE embedding_jobs.content_hash != excluded.content_hash`);
  for (const id of ids) insert.run(`${id}:${config.embeddings.model}`, config.embeddings.model, now, now, id);
}

export async function processNextJob(config) {
  if (!config.embeddings.enabled) return false;
  const db = getDb(config);
  const now = new Date().toISOString();
  const expired = new Date(Date.now() - config.embeddings.jobLeaseMs).toISOString();
  const token = randomUUID();
  const job = db.transaction(() => {
    const next = db.prepare(`SELECT * FROM embedding_jobs WHERE model_name=? AND
      (status='pending' OR (status='processing' AND updated_at < ?)) ORDER BY created_at,id LIMIT 1`).get(config.embeddings.model, expired);
    if (next) db.prepare("UPDATE embedding_jobs SET status='processing',attempts=attempts+1,updated_at=?,claim=? WHERE id=?").run(now, token, next.id);
    return next;
  })();
  if (!job) return false;
  const doc = db.prepare('SELECT id,content_hash,body FROM documents WHERE id=? AND deleted_at IS NULL').get(job.document_id);
  try {
    if (!doc) { db.prepare('DELETE FROM embedding_jobs WHERE id=? AND claim=?').run(job.id, token); return true; }
    const [{ getEmbedder }, { getVectorStore }] = await Promise.all([import('./embedder.js'), import('./vectorStore.js')]);
    const embedder = await getEmbedder(config);
    const store = await getVectorStore(config);
    const embedding = await embedder.embed(doc.body);
    const current = db.prepare('SELECT content_hash,deleted_at FROM documents WHERE id=?').get(doc.id);
    if (!current || current.deleted_at || current.content_hash !== doc.content_hash) return true;
    await store.insert(config, { id: doc.id, content_hash: doc.content_hash, embedding });
    db.prepare("UPDATE embedding_jobs SET status='completed',last_error=NULL WHERE id=? AND claim=? AND content_hash=? AND status='processing'")
      .run(job.id, token, doc.content_hash);
  } catch (error) {
    const status = job.attempts + 1 >= config.embeddings.maxRetries ? 'failed' : 'pending';
    db.prepare("UPDATE embedding_jobs SET status=?,last_error=? WHERE id=? AND claim=? AND content_hash=? AND status='processing'")
      .run(status, error.message, job.id, token, job.content_hash);
  }
  return true;
}
