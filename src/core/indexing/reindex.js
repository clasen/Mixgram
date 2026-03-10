import path from 'path';
import fs from 'fs';
import { globSync } from 'glob';
import { getDb } from '../../db/sqlite.js';
import { indexDocument, removeDocumentFromIndex } from './indexer.js';
import { TYPE_TO_DIR } from '../../fs/paths.js';

/**
 * Load document metadata from DB by path (for reindex/watcher).
 * Returns frontmatter-like object or null.
 */
function getDocumentMetaByPath(config, filePath) {
  const db = getDb(config);
  const norm = path.normalize(filePath);
  const row = db.prepare(
    'SELECT id, path, title, type, scope, project, topic_key, session_id, tool_name, created_at, updated_at, revision_count, duplicate_count, deleted_at, embedding_status FROM documents WHERE path = ?'
  ).get(norm);
  if (!row) return null;
  const tagRows = db.prepare('SELECT tag FROM document_tags WHERE document_id = ?').all(row.id);
  const tags = tagRows.map((r) => r.tag);
  return rowToFrontmatter(row, tags);
}

function rowToFrontmatter(row, tags = []) {
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

/**
 * List all Markdown file paths under home (cross-project) and project memory root (repo-local).
 */
function listMarkdownPaths(config) {
  const homeRoot = config.homeMemoryRoot;
  const projectRoot = config.projectMemoryRoot;
  const out = [];
  if (fs.existsSync(homeRoot)) {
    const homeFiles = globSync('**/*.md', { cwd: homeRoot });
    out.push(...homeFiles.map((p) => path.join(homeRoot, p)));
  }
  if (projectRoot && fs.existsSync(projectRoot)) {
    const projectFiles = globSync('**/*.md', { cwd: projectRoot });
    out.push(...projectFiles.map((p) => path.join(projectRoot, p)));
  }
  return out;
}

/**
 * Clear entire text index (documents, chunks, tags, FTS). Use before full rebuild.
 */
function clearIndex(config) {
  const db = getDb(config);
  db.transaction(() => {
    const ftsRowids = db.prepare('SELECT rowid FROM document_fts').all();
    for (const { rowid } of ftsRowids) {
      db.prepare('DELETE FROM document_fts WHERE rowid = ?').run(rowid);
    }
    db.prepare('DELETE FROM document_tags').run();
    db.prepare('DELETE FROM documents').run();
  })();
}

/**
 * Full reindex: clear index then index every .md file under home and projects.
 * Use for rebuild-from-scratch (e.g. after deleting SQLite).
 */
function fullReindex(config) {
  clearIndex(config);
  const paths = listMarkdownPaths(config);
  let indexed = 0;
  for (const filePath of paths) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const stat = fs.statSync(filePath);
      const fileCreatedAt = stat.birthtime && !Number.isNaN(stat.birthtime.getTime()) ? stat.birthtime.toISOString() : undefined;
      indexDocument(config, filePath, raw, stat.mtimeMs, { fileCreatedAt });
      indexed++;
    } catch (err) {
      // skip invalid or unreadable files
    }
  }
  return { indexed, total: paths.length };
}

/**
 * Incremental reindex: scan all .md files; skip unchanged (same path + file_mtime_ms);
 * index new or changed; remove from index documents whose path is no longer on disk.
 * Does not clear the index first.
 * @returns {{ scanned: number, skipped: number, indexed: number, removed: number, totalPaths: number }}
 */
function incrementalReindex(config) {
  const paths = listMarkdownPaths(config);
  const pathsSet = new Set(paths.map((p) => path.normalize(p)));
  const db = getDb(config);
  const getStored = db.prepare('SELECT id, file_mtime_ms FROM documents WHERE path = ?');
  let indexed = 0;
  let skipped = 0;
  for (const filePath of paths) {
    try {
      const norm = path.normalize(filePath);
      const stat = fs.statSync(filePath);
      const row = getStored.get(norm);
      if (row != null && row.file_mtime_ms != null && row.file_mtime_ms === stat.mtimeMs) {
        skipped++;
        continue;
      }
      const raw = fs.readFileSync(filePath, 'utf8');
      const dbMeta = getDocumentMetaByPath(config, filePath);
      const fileCreatedAt = stat.birthtime && !Number.isNaN(stat.birthtime.getTime()) ? stat.birthtime.toISOString() : undefined;
      indexDocument(config, filePath, raw, stat.mtimeMs, { overrideFrontmatter: dbMeta ?? undefined, fileCreatedAt });
      indexed++;
    } catch (_) {}
  }
  const allDocs = db.prepare('SELECT id, path FROM documents').all();
  let removed = 0;
  for (const row of allDocs) {
    const norm = path.normalize(row.path);
    if (!pathsSet.has(norm)) {
      removeDocumentFromIndex(config, row.id);
      removed++;
    }
  }
  return { scanned: paths.length, skipped, indexed, removed, totalPaths: paths.length };
}

/**
 * Get document id by file path (for watcher on delete).
 */
function getDocumentIdByPath(config, filePath) {
  const db = getDb(config);
  const norm = path.normalize(filePath);
  const row = db.prepare('SELECT id FROM documents WHERE path = ?').get(norm);
  return row?.id ?? null;
}

export { listMarkdownPaths, clearIndex, fullReindex, incrementalReindex, getDocumentIdByPath, getDocumentMetaByPath };
