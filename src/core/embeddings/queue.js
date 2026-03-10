/**
 * Embedding job queue: enqueue chunk ids after indexing; worker processes pending jobs.
 */
import { getDb } from '../../db/sqlite.js';

const MODEL_NAME = 'Xenova_multilingual_e5_large';
const STATUS = { PENDING: 'pending', PROCESSING: 'processing', COMPLETED: 'completed', FAILED: 'failed', STALE: 'stale' };

function getModelName(config) {
  return config?.embeddings?.model || MODEL_NAME;
}

/**
 * Enqueue chunks for embedding. Idempotent per chunk: existing pending/processing left as-is; completed/failed/stale replaced by pending.
 */
function enqueueChunks(config, chunkIds) {
  if (!config?.embeddings?.enabled || !chunkIds?.length) return;
  const db = getDb(config);
  const model = getModelName(config);
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO embedding_jobs (id, chunk_id, model_name, status, attempts, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET status = 'pending', attempts = 0, last_error = NULL, updated_at = ?
    WHERE embedding_jobs.status IN ('completed', 'failed', 'stale')
  `);
  for (const cid of chunkIds) {
    const id = `${cid}:${model}`;
    insert.run(id, cid, model, STATUS.PENDING, now, now, now);
  }
}

/**
 * Mark jobs for these chunk ids as stale (e.g. before re-indexing the document).
 */
function markStale(config, chunkIds) {
  if (!chunkIds?.length) return;
  const db = getDb(config);
  const model = getModelName(config);
  const now = new Date().toISOString();
  const update = db.prepare(`
    UPDATE embedding_jobs SET status = ?, updated_at = ? WHERE chunk_id = ? AND model_name = ?
  `);
  for (const cid of chunkIds) {
    update.run(STATUS.STALE, now, cid, model);
  }
}

/**
 * Process one pending job: load chunk content, embed, write to vector store, mark completed/failed.
 */
async function processNextJob(config) {
  if (!config?.embeddings?.enabled) return false;
  const db = getDb(config);
  const model = getModelName(config);
  const job = db.prepare(`
    SELECT id, chunk_id FROM embedding_jobs
    WHERE status = ? AND model_name = ?
    ORDER BY created_at ASC LIMIT 1
  `).get(STATUS.PENDING, model);
  if (!job) return false;

  const now = new Date().toISOString();
  db.prepare(`UPDATE embedding_jobs SET status = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?`)
    .run(STATUS.PROCESSING, now, job.id);

  let embedder;
  let vectorStore;
  try {
    const [{ getEmbedder }, { getVectorStore }] = await Promise.all([
      import('./embedder.js'),
      import('./vectorStore.js')
    ]);
    embedder = await getEmbedder(config);
    vectorStore = await getVectorStore(config);
    if (!embedder || !vectorStore) {
      db.prepare(`UPDATE embedding_jobs SET status = ?, last_error = ?, updated_at = ? WHERE id = ?`)
        .run(STATUS.FAILED, 'embeddings not available', now, job.id);
      return true;
    }
  } catch (err) {
    db.prepare(`UPDATE embedding_jobs SET status = ?, last_error = ?, updated_at = ? WHERE id = ?`)
      .run(STATUS.FAILED, String(err?.message || err), now, job.id);
    return true;
  }

  const docRow = db.prepare(`
    SELECT id, id AS document_id, content_hash, body AS content
    FROM documents
    WHERE id = ?
  `).get(job.chunk_id);
  if (!docRow?.content) {
    db.prepare(`UPDATE embedding_jobs SET status = ?, last_error = ?, updated_at = ? WHERE id = ?`)
      .run(STATUS.FAILED, 'document not found or empty body', now, job.id);
    return true;
  }

  try {
    const embedding = await embedder.embed(docRow.content);
    await vectorStore.insert(config, {
      chunk_id: docRow.id,
      document_id: docRow.document_id,
      content_hash: docRow.content_hash,
      embedding
    });
    db.prepare(`UPDATE embedding_jobs SET status = ?, updated_at = ? WHERE id = ?`)
      .run(STATUS.COMPLETED, now, job.id);
  } catch (err) {
    const maxRetries = config?.embeddings?.maxRetries ?? 3;
    const attempts = db.prepare('SELECT attempts FROM embedding_jobs WHERE id = ?').get(job.id)?.attempts ?? 1;
    const nextStatus = attempts >= maxRetries ? STATUS.FAILED : STATUS.PENDING;
    db.prepare(`UPDATE embedding_jobs SET status = ?, last_error = ?, updated_at = ? WHERE id = ?`)
      .run(nextStatus, String(err?.message || err), now, job.id);
  }
  return true;
}

export { enqueueChunks, markStale, processNextJob, getModelName, STATUS };
