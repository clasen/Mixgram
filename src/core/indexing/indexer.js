import { getDb } from '../../db/sqlite.js';
import { parseAndChunk } from './parser.js';
import { contentHash } from '../../utils/hash.js';
import { chunkId } from '../../utils/ids.js';

function normalizeForFts(str) {
  if (str == null || str === undefined) return '';
  return String(str)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function indexDocument(config, docPath, rawContent, fileMtimeMs = null) {
  const db = getDb(config);
  const { frontmatter, chunks } = parseAndChunk(rawContent, {
    chunkSize: config.indexing.chunkSize,
    chunkOverlap: config.indexing.chunkOverlap
  });

  const id = frontmatter.id;
  if (!id) throw new Error('Document frontmatter must include id');

  const now = new Date().toISOString();
  const docHash = contentHash(rawContent);

  const docRow = {
    id,
    path: docPath,
    title: frontmatter.title || '',
    type: frontmatter.type || 'generated_note',
    scope: frontmatter.scope || 'project',
    project: frontmatter.project || null,
    topic_key: frontmatter.topic_key || null,
    session_id: frontmatter.session_id || null,
    tool_name: frontmatter.tool_name || null,
    content_hash: docHash,
    file_mtime_ms: fileMtimeMs,
    created_at: frontmatter.created_at || now,
    updated_at: frontmatter.updated_at || now,
    indexed_at: now,
    deleted_at: frontmatter.deleted_at || null,
    revision_count: frontmatter.revision_count ?? 1,
    duplicate_count: frontmatter.duplicate_count ?? 0,
    embedding_status: frontmatter.embedding_status || 'disabled'
  };

  let oldChunkIds = [];
  db.transaction(() => {
    const existing = db.prepare('SELECT id FROM documents WHERE id = ?').get(id);
    if (existing) {
      oldChunkIds = db.prepare('SELECT id FROM document_chunks WHERE document_id = ?').all(id).map((r) => r.id);
      const ftsRowids = db.prepare('SELECT rowid FROM document_chunks_fts WHERE document_id = ?').all(id);
      for (const { rowid } of ftsRowids) {
        db.prepare('DELETE FROM document_chunks_fts WHERE rowid = ?').run(rowid);
      }
      db.prepare('DELETE FROM document_chunks WHERE document_id = ?').run(id);
      db.prepare('DELETE FROM document_tags WHERE document_id = ?').run(id);
    }

    db.prepare(`
      INSERT OR REPLACE INTO documents (id, path, title, type, scope, project, topic_key, session_id, tool_name, content_hash, file_mtime_ms, created_at, updated_at, indexed_at, deleted_at, revision_count, duplicate_count, embedding_status)
      VALUES (@id, @path, @title, @type, @scope, @project, @topic_key, @session_id, @tool_name, @content_hash, @file_mtime_ms, @created_at, @updated_at, @indexed_at, @deleted_at, @revision_count, @duplicate_count, @embedding_status)
    `).run(docRow);

    const titleNorm = normalizeForFts(docRow.title);
    const topicKeyNorm = normalizeForFts(docRow.topic_key);
    const typeNorm = normalizeForFts(docRow.type);
    const scopeNorm = normalizeForFts(docRow.scope);
    const projectNorm = normalizeForFts(docRow.project);

    chunks.forEach((chunk, idx) => {
      const cid = chunkId(id, idx);
      const chunkHash = contentHash(chunk.content);
      const headingPathNorm = normalizeForFts(chunk.headingPath);
      const bodyNorm = normalizeForFts(chunk.content);

      db.prepare(`
        INSERT INTO document_chunks (id, document_id, chunk_index, heading_path, heading_level, content, content_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(cid, id, idx, chunk.headingPath || '', chunk.headingLevel || 0, chunk.content, chunkHash, now, now);

      db.prepare(`
        INSERT INTO document_chunks_fts (chunk_id, document_id, title, topic_key, type, scope, project, heading_path, body)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(cid, id, titleNorm, topicKeyNorm, typeNorm, scopeNorm, projectNorm, headingPathNorm, bodyNorm);
    });

    const tags = frontmatter.tags || [];
    for (const tag of tags) {
      db.prepare('INSERT OR IGNORE INTO document_tags (document_id, tag) VALUES (?, ?)').run(id, tag);
    }
  })();

  if (config?.embeddings?.enabled) {
    const newChunkIds = Array.from({ length: chunks.length }, (_, idx) => chunkId(id, idx));
    import('../embeddings/queue.js')
      .then(({ enqueueChunks, markStale }) => {
        if (oldChunkIds.length) markStale(config, oldChunkIds);
        enqueueChunks(config, newChunkIds);
      })
      .catch((err) => {
        if (typeof process !== 'undefined' && process.stderr) {
          process.stderr.write(`[mixgram] embeddings queue error: ${err?.message ?? err}\n`);
        }
      });
    if (oldChunkIds.length) {
      import('../embeddings/vectorStore.js')
        .then(({ removeChunks }) => removeChunks(config, oldChunkIds))
        .catch(() => {});
    }
  }

  return { id, chunkCount: chunks.length };
}

function removeDocumentFromIndex(config, documentId) {
  const db = getDb(config);
  const chunkIds = db.prepare('SELECT id FROM document_chunks WHERE document_id = ?').all(documentId).map((r) => r.id);
  if (config?.embeddings?.enabled && chunkIds.length) {
    import('../embeddings/queue.js')
      .then(({ markStale }) => markStale(config, chunkIds))
      .catch((err) => {
        if (typeof process !== 'undefined' && process.stderr) {
          process.stderr.write(`[mixgram] embeddings markStale error: ${err?.message ?? err}\n`);
        }
      });
    import('../embeddings/vectorStore.js')
      .then(({ removeChunks }) => removeChunks(config, chunkIds))
      .catch(() => {});
  }
  for (const cid of chunkIds) {
    db.prepare('DELETE FROM embedding_jobs WHERE chunk_id = ?').run(cid);
  }
  const ftsRowids = db.prepare('SELECT rowid FROM document_chunks_fts WHERE document_id = ?').all(documentId);
  db.transaction(() => {
    for (const { rowid } of ftsRowids) {
      db.prepare('DELETE FROM document_chunks_fts WHERE rowid = ?').run(rowid);
    }
    db.prepare('DELETE FROM document_chunks WHERE document_id = ?').run(documentId);
    db.prepare('DELETE FROM document_tags WHERE document_id = ?').run(documentId);
    db.prepare('DELETE FROM documents WHERE id = ?').run(documentId);
  })();
}

export { indexDocument, removeDocumentFromIndex, normalizeForFts };
