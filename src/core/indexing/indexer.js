import { getDb } from '../../db/sqlite.js';
import { parseMarkdown } from './parser.js';
import { contentHash } from '../../utils/hash.js';

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
  const includeCodeBlocks = config.indexing?.includeCodeBlocks ?? false;
  const parsed = parseMarkdown(rawContent, { includeCodeBlocks });

  const { frontmatter, title, h1, h2, h3, h4, h5, h6, body, structure, sectionsIndex } = parsed;
  const id = frontmatter.id;
  if (!id) throw new Error('Document frontmatter must include id');

  const now = new Date().toISOString();
  const docHash = contentHash(rawContent);
  const docTitle = frontmatter.title || title || '';

  const existing = db.prepare('SELECT content_hash, file_mtime_ms FROM documents WHERE id = ?').get(id);
  if (existing && existing.content_hash === docHash && (fileMtimeMs == null || existing.file_mtime_ms === fileMtimeMs)) {
    return { id };
  }

  const docRow = {
    id,
    path: docPath,
    title: docTitle,
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
    embedding_status: frontmatter.embedding_status || 'disabled',
    body: body || '',
    structure: JSON.stringify(structure),
    sections_index: JSON.stringify(sectionsIndex)
  };

  let wasExisting = false;
  db.transaction(() => {
    const existingDoc = db.prepare('SELECT id FROM documents WHERE id = ?').get(id);
    if (existingDoc) {
      wasExisting = true;
      const ftsRowids = db.prepare('SELECT rowid FROM document_fts WHERE document_id = ?').all(id);
      for (const { rowid } of ftsRowids) {
        db.prepare('DELETE FROM document_fts WHERE rowid = ?').run(rowid);
      }
      db.prepare('DELETE FROM document_tags WHERE document_id = ?').run(id);
    }

    db.prepare(`
      INSERT OR REPLACE INTO documents (id, path, title, type, scope, project, topic_key, session_id, tool_name, content_hash, file_mtime_ms, created_at, updated_at, indexed_at, deleted_at, revision_count, duplicate_count, embedding_status, body, structure, sections_index)
      VALUES (@id, @path, @title, @type, @scope, @project, @topic_key, @session_id, @tool_name, @content_hash, @file_mtime_ms, @created_at, @updated_at, @indexed_at, @deleted_at, @revision_count, @duplicate_count, @embedding_status, @body, @structure, @sections_index)
    `).run(docRow);

    const titleNorm = normalizeForFts(docTitle);
    const h1Norm = normalizeForFts(h1);
    const h2Norm = normalizeForFts(h2);
    const h3Norm = normalizeForFts(h3);
    const h4Norm = normalizeForFts(h4);
    const h5Norm = normalizeForFts(h5);
    const h6Norm = normalizeForFts(h6);
    const bodyNorm = normalizeForFts(body);

    db.prepare(`
      INSERT INTO document_fts (document_id, title, h1, h2, h3, h4, h5, h6, body)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, titleNorm, h1Norm, h2Norm, h3Norm, h4Norm, h5Norm, h6Norm, bodyNorm);

    const tags = frontmatter.tags || [];
    for (const tag of tags) {
      db.prepare('INSERT OR IGNORE INTO document_tags (document_id, tag) VALUES (?, ?)').run(id, tag);
    }
  })();

  if (config?.embeddings?.enabled) {
    import('../embeddings/queue.js')
      .then(({ enqueueChunks, markStale }) => {
        if (wasExisting) markStale(config, [id]);
        enqueueChunks(config, [id]);
      })
      .catch((err) => {
        if (typeof process !== 'undefined' && process.stderr) {
          process.stderr.write(`[mixgram] embeddings queue error: ${err?.message ?? err}\n`);
        }
      });
  }

  return { id };
}

function removeDocumentFromIndex(config, documentId) {
  const db = getDb(config);
  if (config?.embeddings?.enabled) {
    import('../embeddings/queue.js')
      .then(({ markStale }) => markStale(config, [documentId]))
      .catch(() => {});
    import('../embeddings/vectorStore.js')
      .then(({ removeChunks }) => removeChunks(config, [documentId]))
      .catch(() => {});
  }
  db.prepare('DELETE FROM embedding_jobs WHERE chunk_id = ?').run(documentId);
  db.transaction(() => {
    const ftsRowids = db.prepare('SELECT rowid FROM document_fts WHERE document_id = ?').all(documentId);
    for (const { rowid } of ftsRowids) {
      db.prepare('DELETE FROM document_fts WHERE rowid = ?').run(rowid);
    }
    db.prepare('DELETE FROM document_tags WHERE document_id = ?').run(documentId);
    db.prepare('DELETE FROM documents WHERE id = ?').run(documentId);
  })();
}

export { indexDocument, removeDocumentFromIndex, normalizeForFts };
