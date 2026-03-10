import path from 'path';
import fs from 'fs';
import { globSync } from 'glob';
import { getDb } from '../../db/sqlite.js';
import { indexDocument, removeDocumentFromIndex } from './indexer.js';

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
      indexDocument(config, filePath, raw, stat.mtimeMs);
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
      indexDocument(config, filePath, raw, stat.mtimeMs);
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

export { listMarkdownPaths, clearIndex, fullReindex, incrementalReindex, getDocumentIdByPath };
