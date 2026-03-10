import fs from 'fs';
import { documentPath, ensureDir } from '../../fs/paths.js';
import { toMarkdown, parse } from '../../utils/markdown.js';
import { observationId } from '../../utils/ids.js';
import { contentHash } from '../../utils/hash.js';
import { indexDocument, removeDocumentFromIndex } from '../indexing/indexer.js';
import { getDb } from '../../db/sqlite.js';

/**
 * Resolve existing document by id (takes precedence) or by topic_key + scope + project.
 * @returns {{ path: string, frontmatter: object, body: string } | null}
 */
function resolveDocument(config, { id, topic_key, scope, project }) {
  const db = getDb(config);
  if (id) {
    const row = db.prepare('SELECT path FROM documents WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!row) return null;
    const fullPath = row.path;
    if (!fs.existsSync(fullPath)) return null;
    const raw = fs.readFileSync(fullPath, 'utf8');
    const parsed = parse(raw);
    return { path: fullPath, frontmatter: parsed.frontmatter, body: parsed.body };
  }
  if (topic_key != null && scope != null) {
    const row = db.prepare(
      'SELECT id, path FROM documents WHERE topic_key = ? AND scope = ? AND (project = ? OR (project IS NULL AND ? IS NULL)) AND deleted_at IS NULL'
    ).get(topic_key, scope, project ?? null, project ?? null);
    if (!row) return null;
    const fullPath = row.path;
    if (!fs.existsSync(fullPath)) return null;
    const raw = fs.readFileSync(fullPath, 'utf8');
    const parsed = parse(raw);
    return { path: fullPath, frontmatter: parsed.frontmatter, body: parsed.body };
  }
  return null;
}

/**
 * Build frontmatter for a new or updated document.
 */
function buildFrontmatter(overrides = {}, existing = null) {
  const now = new Date().toISOString();
  if (existing) {
    const rev = (existing.revision_count ?? 1) + 1;
    return {
      ...existing,
      ...overrides,
      updated_at: now,
      revision_count: rev,
      id: existing.id
    };
  }
  return {
    id: overrides.id || observationId(),
    title: overrides.title ?? '',
    type: overrides.type ?? 'generated_note',
    scope: overrides.scope ?? 'project',
    project: overrides.project ?? null,
    topic_key: overrides.topic_key ?? null,
    session_id: overrides.session_id ?? null,
    tool_name: overrides.tool_name ?? null,
    created_at: overrides.created_at ?? now,
    updated_at: now,
    revision_count: 1,
    duplicate_count: 0,
    deleted: false,
    tags: Array.isArray(overrides.tags) ? overrides.tags : [],
    embedding_status: 'disabled'
  };
}

/**
 * Save or update a memory document (mem_save semantics).
 * Resolution: 1) by id, 2) by topic_key in scope, 3) create new.
 * @returns {{ id: string, path: string, created: boolean }}
 */
function saveDocument(config, payload) {
  const { title, type, scope, project, topic_key, content, session_id, id: givenId, tags } = payload;
  const resolved = givenId
    ? resolveDocument(config, { id: givenId })
    : topic_key != null && scope != null
      ? resolveDocument(config, { topic_key, scope, project })
      : null;

  let docPath;
  let frontmatter;
  let body = typeof content === 'string' ? content : (content && content.text) || '';

  if (resolved) {
    docPath = resolved.path;
    frontmatter = buildFrontmatter(
      { title, type, scope, project, topic_key, session_id, tags },
      { ...resolved.frontmatter, revision_count: resolved.frontmatter.revision_count ?? 1 }
    );
    body = body || resolved.body;
  } else {
    frontmatter = buildFrontmatter({
      id: givenId || observationId(),
      title,
      type: type || 'generated_note',
      scope: scope || 'project',
      project: project || null,
      topic_key: topic_key || null,
      session_id: session_id || null,
      tool_name: 'mem_save',
      tags: tags || []
    });
    docPath = documentPath(config, frontmatter);
    ensureDir(docPath);
  }

  const raw = toMarkdown(frontmatter, body);
  fs.writeFileSync(docPath, raw, 'utf8');
  const stats = fs.statSync(docPath);
  indexDocument(config, docPath, raw, stats.mtimeMs);
  return {
    id: frontmatter.id,
    path: docPath,
    created: !resolved
  };
}

/**
 * Update document by id (mem_update semantics).
 * @returns {{ id: string } | null}
 */
function updateDocument(config, { id, title, content, tags }) {
  const resolved = resolveDocument(config, { id });
  if (!resolved) return null;
  const body = typeof content === 'string' ? content : (content && content.text) || resolved.body;
  const frontmatter = buildFrontmatter(
    { title: title ?? resolved.frontmatter.title, tags },
    resolved.frontmatter
  );
  const raw = toMarkdown(frontmatter, body);
  fs.writeFileSync(resolved.path, raw, 'utf8');
  const stats = fs.statSync(resolved.path);
  indexDocument(config, resolved.path, raw, stats.mtimeMs);
  return { id: frontmatter.id };
}

/**
 * Soft or hard delete (mem_delete semantics).
 * @param {{ hardDelete?: boolean }} options
 * @returns {boolean} true if document existed and was handled
 */
function deleteDocument(config, documentId, options = {}) {
  const resolved = resolveDocument(config, { id: documentId });
  if (!resolved) return false;
  if (options.hardDelete) {
    try { fs.unlinkSync(resolved.path); } catch (_) {}
    removeDocumentFromIndex(config, documentId);
  } else {
    const now = new Date().toISOString();
    const frontmatter = { ...resolved.frontmatter, deleted_at: now, deleted: true };
    const raw = toMarkdown(frontmatter, resolved.body);
    fs.writeFileSync(resolved.path, raw, 'utf8');
    const db = getDb(config);
    db.prepare('UPDATE documents SET deleted_at = ? WHERE id = ?').run(now, documentId);
    const ftsRowids = db.prepare('SELECT rowid FROM document_fts WHERE document_id = ?').all(documentId);
    for (const { rowid } of ftsRowids) {
      db.prepare('DELETE FROM document_fts WHERE rowid = ?').run(rowid);
    }
  }
  return true;
}

/**
 * Get full document content by id (mem_get_observation).
 * @returns {{ id: string, title: string, type: string, scope: string, project: string | null, topic_key: string | null, content: string } | null}
 */
function getObservation(config, documentId) {
  const resolved = resolveDocument(config, { id: documentId });
  if (!resolved) return null;
  const fullContent = toMarkdown(resolved.frontmatter, resolved.body);
  return {
    id: resolved.frontmatter.id,
    title: resolved.frontmatter.title,
    type: resolved.frontmatter.type,
    scope: resolved.frontmatter.scope,
    project: resolved.frontmatter.project ?? null,
    topic_key: resolved.frontmatter.topic_key ?? null,
    session_id: resolved.frontmatter.session_id ?? null,
    content: fullContent
  };
}

/**
 * List document ids in a session ordered by updated_at (for mem_timeline).
 */
function getObservationsBySession(config, sessionId) {
  const db = getDb(config);
  const rows = db.prepare(
    'SELECT id FROM documents WHERE session_id = ? AND deleted_at IS NULL ORDER BY updated_at ASC'
  ).all(sessionId);
  return rows.map((r) => r.id);
}

export {
  resolveDocument,
  buildFrontmatter,
  saveDocument,
  updateDocument,
  deleteDocument,
  getObservation,
  getObservationsBySession
};
