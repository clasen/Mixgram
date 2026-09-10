#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadConfig } from '../src/config.js';
import { saveDocument } from '../src/core/documents/documents.js';
import { search } from '../src/core/search/search.js';
import { processNextJob } from '../src/core/embeddings/queue.js';
import { getEmbedder } from '../src/core/embeddings/embedder.js';
import { closeDb } from '../src/db/sqlite.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mixgram-search-bench-'));
const config = loadConfig({ collections: { general: path.join(root, 'docs') }, sqlitePath: path.join(root, 'index.db'), embeddings: { enabled: process.argv.includes('--embed') } });
try {
  for (let i = 0; i < 100; i++) saveDocument(config, { title: `Document ${i}`, content: 'Memory contains reusable knowledge. '.repeat(i === 99 ? 3000 : 10), tags: [i % 2 ? 'odd' : 'even'] });
  if (config.embeddings.enabled) {
    while (await processNextJob(config)) {}
    const embedder = await getEmbedder(config);
    config.getQueryEmbedding = text => embedder.embed(text);
  }
  for (const options of [{ query: 'knowledge' }, { query: 'knowledge', tags: ['even'], offset: 10 }, {}]) {
    const samples = [];
    for (let i = 0; i < 7; i++) {
      const start = performance.now();
      const result = await search(config, options);
      if (result.degraded) throw new Error(result.reason);
      if (i >= 2) samples.push(performance.now() - start);
    }
    samples.sort((a,b) => a-b);
    console.log(JSON.stringify({ options, medianMilliseconds: samples[2] }));
  }
} finally {
  closeDb(config);
  fs.rmSync(root, { recursive: true, force: true });
}
