import path from 'path';
import chokidar from 'chokidar';
import fs from 'fs';
import { indexDocument, removeDocumentFromIndex } from '../core/indexing/indexer.js';
import { getDocumentIdByPath, getDocumentMetaByPath } from '../core/indexing/reindex.js';

/**
 * Start watching home (cross-project) and project memory root (repo-local) for .md changes.
 * On add/change: index the file (using DB metadata when path already known). On unlink: remove from index by path.
 * @param {object} config - resolved config
 * @returns {import('chokidar').FSWatcher} watcher instance (call .close() to stop)
 */
function startWatcher(config) {
  const homeRoot = config.homeMemoryRoot;
  const projectRoot = config.projectMemoryRoot;
  const patterns = [];
  if (homeRoot) patterns.push(path.join(homeRoot, '**/*.md'));
  if (projectRoot) patterns.push(path.join(projectRoot, '**/*.md'));
  if (patterns.length === 0) return null;

  const watcher = chokidar.watch(patterns, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200 }
  });

  watcher
    .on('add', (filePath) => {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const stat = fs.statSync(filePath);
        const dbMeta = getDocumentMetaByPath(config, filePath);
        const fileCreatedAt = stat.birthtime && !Number.isNaN(stat.birthtime.getTime()) ? stat.birthtime.toISOString() : undefined;
        indexDocument(config, filePath, raw, stat.mtimeMs, { overrideFrontmatter: dbMeta ?? undefined, fileCreatedAt });
      } catch (_) {}
    })
    .on('change', (filePath) => {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const stat = fs.statSync(filePath);
        const dbMeta = getDocumentMetaByPath(config, filePath);
        const fileCreatedAt = stat.birthtime && !Number.isNaN(stat.birthtime.getTime()) ? stat.birthtime.toISOString() : undefined;
        indexDocument(config, filePath, raw, stat.mtimeMs, { overrideFrontmatter: dbMeta ?? undefined, fileCreatedAt });
      } catch (_) {}
    })
    .on('unlink', (filePath) => {
      try {
        const id = getDocumentIdByPath(config, filePath);
        if (id) removeDocumentFromIndex(config, id);
      } catch (_) {}
    });

  return watcher;
}

export { startWatcher };
