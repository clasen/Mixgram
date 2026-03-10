import path from 'path';
import fs from 'fs';
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

/** Infer scope, type and project from file path. Path shape: <project>/docs/<type>/<title>.md → project = dirname(docs). */
function inferMetadataFromPath(config, docPath) {
  let norm = path.normalize(path.resolve(docPath));
  let homeRoot = config.homeMemoryRoot ? path.normalize(path.resolve(config.homeMemoryRoot)) : '';
  let projectRoot = config.projectMemoryRoot ? path.normalize(path.resolve(config.projectMemoryRoot)) : '';
  try {
    if (norm && fs.existsSync(norm)) norm = fs.realpathSync(norm);
    if (homeRoot && fs.existsSync(homeRoot)) homeRoot = fs.realpathSync(homeRoot);
    if (projectRoot && fs.existsSync(projectRoot)) projectRoot = fs.realpathSync(projectRoot);
  } catch (_) {}

  const dirToType = {
    architecture: 'architecture',
    decisions: 'decision',
    bugs: 'bug',
    learnings: 'learning',
    discoveries: 'discovery',
    patterns: 'pattern',
    reference: 'reference',
    sessions: 'session_summary',
    prompts: 'prompt',
    generated: 'generated_note'
  };
  let scope = 'project';
  let type = 'generated_note';
  let project = null;

  const underHome = homeRoot && (() => {
    if (norm === homeRoot) return true;
    const sep = path.sep;
    return norm.startsWith(homeRoot + sep);
  })();
  const underProject = projectRoot && (() => {
    if (norm === projectRoot) return true;
    const sep = path.sep;
    return norm.startsWith(projectRoot + sep);
  })();

  if (underHome) {
    scope = 'home';
    const rel = path.relative(homeRoot, path.dirname(norm));
    const firstDir = rel.split(path.sep)[0];
    type = dirToType[firstDir] ?? 'generated_note';
  } else if (underProject) {
    scope = 'project';
    const rel = path.relative(projectRoot, path.dirname(norm));
    const firstDir = rel.split(path.sep)[0];
    type = dirToType[firstDir] ?? 'generated_note';
    const projectDir = path.dirname(projectRoot);
    if (projectDir && projectDir !== path.dirname(norm)) project = path.basename(projectDir);
  }
  return { scope, type, project };
}

/** Load metadata from DB by path when no override provided. */
function loadMetadataByPath(db, docPath) {
  const norm = path.normalize(docPath);
  const row = db.prepare(
    'SELECT id, path, title, type, scope, project, topic_key, session_id, tool_name, created_at, updated_at, revision_count, duplicate_count, deleted_at, embedding_status FROM documents WHERE path = ?'
  ).get(norm);
  if (!row) return null;
  const tagRows = db.prepare('SELECT tag FROM document_tags WHERE document_id = ?').all(row.id);
  const tags = tagRows.map((r) => r.tag);
  return {
    id: row.id,
    title: row.title ?? '',
    type: row.type ?? 'generated_note',
    scope: row.scope ?? 'project',
    project: row.project ?? null,
    topic_key: row.topic_key ?? null,
    session_id: row.session_id ?? null,
    tool_name: row.tool_name ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    revision_count: row.revision_count ?? 1,
    duplicate_count: row.duplicate_count ?? 0,
    deleted: !!row.deleted_at,
    tags: Array.isArray(tags) ? tags : [],
    embedding_status: row.embedding_status ?? 'disabled',
    deleted_at: row.deleted_at ?? null
  };
}

function indexDocument(config, docPath, rawContent, fileMtimeMs = null, options = {}) {
  const db = getDb(config);
  const includeCodeBlocks = config.indexing?.includeCodeBlocks ?? false;
  const parsed = parseMarkdown(rawContent, { includeCodeBlocks });

  const { frontmatter, title, h1, h2, h3, h4, h5, h6, body, structure, sectionsIndex } = parsed;
  /** Prefer caller override, then DB row by path, then parsed front matter. */
  let fm = options.overrideFrontmatter;
  let byPath = null;
  if (!fm) {
    byPath = loadMetadataByPath(db, docPath);
    fm = byPath ? { ...frontmatter, ...byPath } : frontmatter;
  } else {
    fm = { ...frontmatter, ...fm };
  }

  /** When metadata did not come from DB (full reindex or new file), infer scope/type/project from path. */
  if (!options.overrideFrontmatter && !byPath) {
    const inferred = inferMetadataFromPath(config, docPath);
    const fileCreatedAt = options.fileCreatedAt ?? (fileMtimeMs != null ? new Date(fileMtimeMs).toISOString() : null);
    fm = {
      ...fm,
      scope: inferred.scope,
      type: fm.type ?? inferred.type,
      project: inferred.project,
      created_at: fm.created_at || fileCreatedAt || undefined,
      updated_at: fm.updated_at || fileCreatedAt || undefined
    };
  }

  /** If still no id (e.g. full reindex of file with no front matter), generate from path and set created/updated. */
  if (!fm.id) {
    const inferred = inferMetadataFromPath(config, docPath);
    const fileCreatedAt = options.fileCreatedAt ?? (fileMtimeMs != null ? new Date(fileMtimeMs).toISOString() : null) ?? new Date().toISOString();
    fm = {
      ...fm,
      id: contentHash(docPath).slice(0, 10),
      scope: inferred.scope,
      type: fm.type ?? inferred.type,
      project: inferred.project,
      created_at: fm.created_at || fileCreatedAt,
      updated_at: fm.updated_at || fileCreatedAt
    };
  }

  const id = fm.id;
  const now = new Date().toISOString();
  const docHash = contentHash(rawContent);
  const docTitle = fm.title || title || '';

  const existing = db.prepare('SELECT content_hash, file_mtime_ms, path FROM documents WHERE id = ?').get(id);
  if (existing && existing.content_hash === docHash && (fileMtimeMs == null || existing.file_mtime_ms === fileMtimeMs)) {
    /** If path changed (move), update row so path stays in sync. */
    const normPath = path.normalize(docPath);
    if (existing.path && path.normalize(existing.path) !== normPath) {
      db.prepare('UPDATE documents SET path = ?, file_mtime_ms = ? WHERE id = ?').run(path.normalize(docPath), fileMtimeMs, id);
    }
    return { id };
  }

  const docRow = {
    id,
    path: path.normalize(docPath),
    title: docTitle,
    type: fm.type || 'generated_note',
    scope: fm.scope || 'project',
    project: fm.project || null,
    topic_key: fm.topic_key || null,
    session_id: fm.session_id || null,
    tool_name: fm.tool_name || null,
    content_hash: docHash,
    file_mtime_ms: fileMtimeMs,
    created_at: fm.created_at || now,
    updated_at: fm.updated_at || now,
    indexed_at: now,
    deleted_at: fm.deleted_at || null,
    revision_count: fm.revision_count ?? 1,
    duplicate_count: fm.duplicate_count ?? 0,
    embedding_status: fm.embedding_status || 'disabled',
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

    const tags = fm.tags || [];
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
