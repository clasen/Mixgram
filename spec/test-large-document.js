#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig } from '../src/config.js';
import { saveDocument, getDocument } from '../src/core/documents/documents.js';
import { search } from '../src/core/search/search.js';
import { reindex } from '../src/core/indexing/reindex.js';
import { closeDb } from '../src/db/sqlite.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mixgram-large-'));
const config = loadConfig({ collections: { general: path.join(root, 'docs') }, sqlitePath: path.join(root, 'index.db') });
try {
  const content = '# Large document\n\n' + 'A paragraph with ordinary text. '.repeat(4000) + '\n\nNeedleInHaystack100k';
  assert.ok(content.length > 100000);
  const saved = saveDocument(config, { title: 'Large', content, tags: ['large'] });
  assert.equal(saved.indexed, true);
  assert.equal(getDocument(config, saved.id).content.trim(), content);
  assert.equal((await search(config, { query: 'NeedleInHaystack100k' })).results[0].id, saved.id);
  assert.deepEqual(reindex(config, { full: true }).errors, []);
  assert.equal((await search(config, { query: 'NeedleInHaystack100k', tags: ['large'] })).results[0].id, saved.id);
  console.log('Large document: save, read, search and rebuild passed (>100k characters).');
} finally {
  closeDb(config);
  fs.rmSync(root, { recursive: true, force: true });
}
