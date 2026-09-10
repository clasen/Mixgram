#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig } from '../src/config.js';
import { saveDocument } from '../src/core/documents/documents.js';
import { search } from '../src/core/search/search.js';
import { processNextJob } from '../src/core/embeddings/queue.js';
import { getEmbedder } from '../src/core/embeddings/embedder.js';
import { getDb, closeDb } from '../src/db/sqlite.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mixgram-demo-'));
const config = loadConfig({ collections: { general: path.join(root, 'docs') }, sqlitePath: path.join(root, 'index.db') });
try {
  for (const [title, content] of [
    ['Baking', 'Feed the sourdough starter daily and bake bread in a hot oven.'],
    ['Research', 'Record sources and methods alongside observations in a research notebook.'],
    ['Memory', 'Keep durable knowledge in Markdown files that people can edit.']
  ]) saveDocument(config, { title, content });
  const query = 'preserving information for future use';
  console.log('Text only:', JSON.stringify(await search(config, { query }), null, 2));
  config.embeddings.enabled = true;
  const { reindex } = await import('../src/core/indexing/reindex.js');
  reindex(config, { full: true });
  while (await processNextJob(config)) {}
  const failed = getDb(config).prepare("SELECT last_error FROM embedding_jobs WHERE status='failed'").all();
  if (failed.length) throw new Error(JSON.stringify(failed));
  const embedder = await getEmbedder(config);
  config.getQueryEmbedding = text => embedder.embed(text);
  console.log('Hybrid:', JSON.stringify(await search(config, { query }), null, 2));
} finally {
  closeDb(config);
  fs.rmSync(root, { recursive: true, force: true });
}
