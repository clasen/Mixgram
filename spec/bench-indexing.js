#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadConfig } from '../src/config.js';
import { saveDocument } from '../src/core/documents/documents.js';
import { reindex } from '../src/core/indexing/reindex.js';
import { processNextJob } from '../src/core/embeddings/queue.js';
import { getDb, closeDb } from '../src/db/sqlite.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mixgram-index-bench-'));
const config = loadConfig({ collections: { general: path.join(root, 'docs') }, sqlitePath: path.join(root, 'index.db'), embeddings: { enabled: process.argv.includes('--embed') } });
try {
  for (let i = 0; i < 100; i++) saveDocument(config, { title: `Document ${i}`, content: 'Example knowledge. '.repeat(i === 99 ? 6000 : 30) });
  for (const full of [true, false]) {
    const start = performance.now();
    const result = reindex(config, { full });
    console.log(JSON.stringify({ full, milliseconds: performance.now() - start, ...result }));
    if (result.errors.length) throw new Error('Indexing failed');
  }
  if (config.embeddings.enabled) {
    const start = performance.now();
    while (await processNextJob(config)) {}
    console.log(JSON.stringify({ embeddingMilliseconds: performance.now() - start,
      jobs: getDb(config).prepare('SELECT status,COUNT(*) AS count FROM embedding_jobs GROUP BY status').all() }));
    if (getDb(config).prepare("SELECT 1 FROM embedding_jobs WHERE status='failed'").get()) throw new Error('Embedding jobs failed');
  }
} finally {
  closeDb(config);
  fs.rmSync(root, { recursive: true, force: true });
}
