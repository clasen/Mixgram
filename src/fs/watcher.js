import chokidar from 'chokidar';
import { getDb } from '../db/sqlite.js';
import { indexDocument, removeDocumentFromIndex } from '../core/indexing/indexer.js';

export function startWatcher(config, onError = error => process.stderr.write(`[mixgram] watch: ${error.message}\n`)) {
  const watcher = chokidar.watch(Object.values(config.collections), {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: config.indexing.watchStabilityMs }
  });
  const update = filePath => {
    if (!filePath.endsWith('.md')) return;
    try { indexDocument(config, filePath); }
    catch (error) { onError(error); }
  };
  watcher.on('add', update).on('change', update).on('unlink', filePath => {
    try {
      const row = getDb(config).prepare('SELECT id FROM documents WHERE path = ?').get(filePath);
      if (row) removeDocumentFromIndex(config, row.id);
    } catch (error) { onError(error); }
  }).on('error', onError);
  return watcher;
}
