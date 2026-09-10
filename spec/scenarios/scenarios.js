import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { once } from 'events';
import Database from 'better-sqlite3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../../src/config.js';
import { getDb, closeDb } from '../../src/db/sqlite.js';
import { saveDocument, getDocument, deleteDocument } from '../../src/core/documents/documents.js';
import { reindex } from '../../src/core/indexing/reindex.js';
import { search } from '../../src/core/search/search.js';
import { parse, toMarkdown } from '../../src/utils/markdown.js';
import { startWatcher } from '../../src/fs/watcher.js';
import { getVectorStore } from '../../src/core/embeddings/vectorStore.js';
import { createServer, startEmbeddingWorker } from '../../src/mcp/server.js';
import { createToolHandlers } from '../../src/mcp/tools.js';
import { parseToolArgs, getToolByName } from '../../src/mcp/cli-adapter.js';

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mixgram-v2-test-'));
  const config = loadConfig({ collections: { general: path.join(root, 'general'), research: path.join(root, 'research') }, sqlitePath: path.join(root, 'index.db'), watch: false, ...overrides });
  t.after(() => { closeDb(config); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, config };
}
const unpack = result => JSON.parse(result.content[0].text);

function edit(filePath, fn) {
  const doc = parse(fs.readFileSync(filePath, 'utf8'));
  fn(doc);
  fs.writeFileSync(filePath, toMarkdown(doc.frontmatter, doc.body));
}

async function eventually(check) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.ok(check(), 'Timed out waiting for filesystem event');
}

test('save creates distinct identities, upserts only explicit keys and preserves omitted fields', t => {
  const { config } = fixture(t);
  const a = saveDocument(config, { title: 'Same', content: 'Body', key: 'topic', tags: ['a'], type: 'recipe' });
  const b = saveDocument(config, { title: 'Same' });
  assert.notEqual(a.path, b.path);
  assert.equal(fs.existsSync(a.path), true);
  const updated = saveDocument(config, { key: 'topic', title: 'Renamed' });
  assert.equal(updated.id, a.id);
  assert.equal(updated.path, a.path);
  assert.equal(updated.created, false);
  assert.deepEqual(getDocument(config, a.id).tags, ['a']);
  assert.equal(getDocument(config, a.id).content.trim(), 'Body');
  assert.equal(getDocument(config, a.id).type, 'recipe');
  const other = saveDocument(config, { collection: 'research', key: 'topic' });
  assert.notEqual(other.id, a.id);
  saveDocument(config, { id: a.id, content: '', tags: [], key: null });
  assert.equal(getDocument(config, a.id).content, '');
  assert.deepEqual(getDocument(config, a.id).tags, []);
  assert.equal(getDocument(config, a.id).key, null);
  assert.throws(() => saveDocument(config, { id: 'missing' }), /not found/);
  assert.throws(() => saveDocument(config, { id: a.id, collection: 'research' }), /Move the file/);
  assert.throws(() => saveDocument(config, { collection: 'missing' }), /Unknown collection/);
});

test('key conflicts fail before writing', t => {
  const { config } = fixture(t);
  const a = saveDocument(config, { key: 'one', content: 'original' });
  saveDocument(config, { key: 'two' });
  assert.throws(() => saveDocument(config, { id: a.id, key: 'two', content: 'changed' }), /Key already/);
  assert.equal(getDocument(config, a.id).content.trim(), 'original');
});

test('rebuild from an empty SQLite file preserves durable metadata and deletion', async t => {
  const { config } = fixture(t);
  const a = saveDocument(config, { key: 'a', tags: ['durable'], type: 'custom', content: 'needle' });
  const b = saveDocument(config, { collection: 'research', content: 'deleted' });
  deleteDocument(config, b.id);
  const before = getDocument(config, a.id);
  closeDb(config);
  fs.unlinkSync(config.sqlitePath);
  const result = reindex(config, { full: true });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(getDocument(config, a.id), before);
  assert.throws(() => getDocument(config, b.id), /not found/);
  assert.equal(getDb(config).prepare('SELECT deleted_at FROM documents WHERE id=?').get(b.id).deleted_at !== null, true);
  assert.equal((await search(config, { tags: ['durable'] })).results[0].id, a.id);
  deleteDocument(config, b.id, { hardDelete: true });
  assert.equal(fs.existsSync(b.path), false);
});

test('manual frontmatter edits and file moves are authoritative in both reindex modes', t => {
  const { config } = fixture(t);
  const a = saveDocument(config, { title: 'Before', tags: ['old'], content: 'before' });
  edit(a.path, doc => { doc.frontmatter.title = 'After'; doc.frontmatter.tags = ['new']; doc.body = 'after'; });
  assert.equal(reindex(config).indexed, 1);
  assert.equal(getDocument(config, a.id).title, 'After');
  assert.deepEqual(getDocument(config, a.id).tags, ['new']);
  assert.equal(reindex(config).skipped, 1);
  fs.mkdirSync(config.collections.research, { recursive: true });
  fs.renameSync(a.path, path.join(config.collections.research, path.basename(a.path)));
  assert.deepEqual(reindex(config).errors, []);
  assert.equal(getDocument(config, a.id).collection, 'research');
  assert.deepEqual(reindex(config, { full: true }).errors, []);
  assert.equal(getDocument(config, a.id).title, 'After');
});

test('reindex reports invalid files and duplicate ids', t => {
  const { config } = fixture(t);
  const a = saveDocument(config, { content: 'valid' });
  fs.copyFileSync(a.path, path.join(config.collections.general, 'duplicate.md'));
  fs.writeFileSync(path.join(config.collections.general, 'broken.md'), '---\ntags: nope\n---\ninvalid');
  const result = reindex(config, { full: true });
  assert.equal(result.errors.length, 2);
  assert.equal(result.indexed, 1);
});

test('watcher handles add, metadata changes, delete and errors', async t => {
  const { config } = fixture(t, { indexing: { watchStabilityMs: 20 } });
  for (const root of Object.values(config.collections)) fs.mkdirSync(root, { recursive: true });
  const errors = [];
  const previousPolling = process.env.CHOKIDAR_USEPOLLING;
  process.env.CHOKIDAR_USEPOLLING = 'true';
  const watcher = startWatcher(config, error => errors.push(error));
  if (previousPolling === undefined) delete process.env.CHOKIDAR_USEPOLLING;
  else process.env.CHOKIDAR_USEPOLLING = previousPolling;
  t.after(() => watcher.close());
  await once(watcher, 'ready');
  const file = path.join(config.collections.general, 'manual.md');
  fs.writeFileSync(file, toMarkdown({ id: 'manual', title: 'Manual' }, 'body'));
  await eventually(() => getDb(config).prepare('SELECT id FROM documents WHERE id=?').get('manual'));
  edit(file, doc => { doc.frontmatter.tags = ['watched']; doc.frontmatter.title = 'Changed'; });
  await eventually(() => getDb(config).prepare('SELECT title FROM documents WHERE id=?').get('manual')?.title === 'Changed');
  assert.deepEqual(getDocument(config, 'manual').tags, ['watched']);
  fs.unlinkSync(file);
  await eventually(() => !getDb(config).prepare('SELECT id FROM documents WHERE id=?').get('manual'));
  fs.writeFileSync(file, '---\ntags: nope\n---\n');
  await eventually(() => errors.length > 0);
  await watcher.close();
});

test('text and recent searches apply collection, type and all tags before pagination', async t => {
  const { config } = fixture(t);
  saveDocument(config, { collection: 'research', title: 'needle needle', tags: ['x','y'], type: 'recipe' });
  saveDocument(config, { title: 'needle', tags: ['x'], type: 'recipe' });
  saveDocument(config, { title: 'needle', tags: ['x','y'], type: 'note' });
  const a = saveDocument(config, { title: 'needle', tags: ['x','y'], type: 'recipe' });
  const b = saveDocument(config, { title: 'needle', tags: ['x','y'], type: 'recipe' });
  for (const query of [undefined, 'needle']) {
    const options = { query, collection: 'general', type: 'recipe', tags: ['x','y'] };
    const all = (await search(config, options)).results;
    assert.deepEqual(new Set(all.map(r => r.id)), new Set([a.id,b.id]));
    const page = (await search(config, { ...options, limit: 1, offset: 1 })).results;
    assert.deepEqual(page, [all[1]]);
  }
  assert.equal((await search(config)).results.length, 5);
  assert.equal((await search(config, { query: 'absent OR needle' })).results.length, 5);
  await assert.rejects(search(config, { limit: 0 }), /Invalid pagination/);
});

test('real vector store filters before ranking, fuses duplicate matches and ignores stale vectors', async t => {
  const { config } = fixture(t, { embeddings: { enabled: true, dimensions: 2, similarityThreshold: 0 } });
  config.getQueryEmbedding = async () => new Float32Array([1,0]);
  const store = await getVectorStore(config);
  const add = async (payload, vector) => {
    const doc = saveDocument(config, payload);
    const row = getDb(config).prepare('SELECT content_hash FROM documents WHERE id=?').get(doc.id);
    await store.insert(config, { id: doc.id, content_hash: row.content_hash, embedding: vector });
    return doc;
  };
  for (let i = 0; i < 25; i++) await add({ collection: 'research', title: 'needle' }, [1,0]);
  const both = await add({ title: 'needle', tags: ['x','y'], type: 'custom' }, [0.9,0.1]);
  const semantic = await add({ title: 'different', tags: ['x','y'], type: 'custom' }, [0.8,0.2]);
  await add({ title: 'needle', tags: ['x'], type: 'custom' }, [1,0]);
  const options = { query: 'needle', collection: 'general', tags: ['x','y'], type: 'custom' };
  const result = await search(config, options);
  assert.equal(result.mode, 'hybrid');
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].id, both.id);
  assert.equal(result.results[1].id, semantic.id);
  assert.deepEqual((await search(config, { ...options, limit: 1, offset: 1 })).results, [result.results[1]]);
  await store.insert(config, { id: both.id, content_hash: getDb(config).prepare('SELECT content_hash FROM documents WHERE id=?').get(both.id).content_hash, embedding: [1,0] });
  assert.equal((await search(config, options)).results.length, 2);
  saveDocument(config, { id: semantic.id, content: 'new content' });
  assert.equal((await search(config, options)).results.length, 1);
  config.getQueryEmbedding = async () => { throw new Error('unavailable'); };
  const degraded = await search(config, options);
  assert.equal(degraded.degraded, true);
  assert.equal(degraded.mode, 'text');
  assert.equal(degraded.results[0].id, both.id);
});

test('a committed file survives an indexing failure and can be repaired', t => {
  const { config } = fixture(t);
  const a = saveDocument(config, { content: 'before' });
  getDb(config).exec("CREATE TRIGGER fail_index BEFORE UPDATE ON documents BEGIN SELECT RAISE(ABORT,'index unavailable'); END");
  const result = saveDocument(config, { id: a.id, content: 'after' });
  assert.equal(result.saved, true);
  assert.equal(result.indexed, false);
  assert.match(result.error, /index unavailable/);
  assert.equal(parse(fs.readFileSync(a.path, 'utf8')).body.trim(), 'after');
  getDb(config).exec('DROP TRIGGER fail_index');
  assert.deepEqual(reindex(config).errors, []);
  assert.equal(getDb(config).prepare('SELECT body FROM documents WHERE id=?').get(a.id).body.trim(), 'after');
});

test('configuration deep merges, rejects overlap and refuses legacy databases without modifying them', t => {
  const { root, config } = fixture(t, { embeddings: { enabled: true } });
  assert.equal(config.embeddings.dimensions, 1024);
  assert.equal(Object.keys(config.collections).length, 2);
  assert.throws(() => loadConfig({ collections: { general: root, nested: path.join(root, 'sub') } }), /overlap/);
  const legacyPath = path.join(root, 'legacy.db');
  const legacy = new Database(legacyPath);
  legacy.exec("CREATE TABLE documents (id TEXT); INSERT INTO documents VALUES ('keep')");
  legacy.close();
  const before = fs.readFileSync(legacyPath);
  const oldConfig = loadConfig({ sqlitePath: legacyPath });
  assert.throws(() => getDb(oldConfig), /Legacy database/);
  assert.deepEqual(fs.readFileSync(legacyPath), before);
});

test('two configurations isolate database connections, vector extensions and worker cleanup', async t => {
  const a = fixture(t, { embeddings: { enabled: true, dimensions: 2 } }).config;
  const b = fixture(t, { embeddings: { enabled: true, dimensions: 2 } }).config;
  saveDocument(a, { title: 'Only A' });
  assert.equal(getDb(b).prepare('SELECT COUNT(*) AS n FROM documents').get().n, 0);
  await getVectorStore(a);
  await getVectorStore(b);
  const stopA = startEmbeddingWorker(a);
  const stopB = startEmbeddingWorker(b);
  assert.notEqual(a.getQueryEmbedding, b.getQueryEmbedding);
  stopA();
  assert.equal(a.getQueryEmbedding, undefined);
  assert.equal(typeof b.getQueryEmbedding, 'function');
  stopB();
  closeDb(a);
  assert.equal(getDb(b).prepare('SELECT COUNT(*) AS n FROM documents').get().n, 0);
});

test('MCP and CLI expose the same six tools and preserve omitted, empty and invalid values', async t => {
  const { root, config } = fixture(t);
  const configPath = path.join(root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  const instance = createServer(config);
  t.after(() => closeDb(instance.config));
  const client = new Client({ name: 'test', version: '1' });
  const [a,b] = InMemoryTransport.createLinkedPair();
  await instance.mcpServer.connect(a);
  await client.connect(b);
  t.after(() => client.close());
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(t => t.name).sort(), ['mem_delete','mem_get','mem_reindex','mem_save','mem_search','mem_stats']);
  const saved = unpack(await client.callTool({ name: 'mem_save', arguments: { title: 'Shared', tags: ['keep'], content: 'body' } }));
  const cli = (...args) => spawnSync(process.execPath, ['bin/mixgram.js', ...args, '--config', configPath], { cwd: new URL('../../', import.meta.url), encoding: 'utf8' });
  const update = cli('mem_save', '--id', saved.id, '--title', 'Renamed');
  assert.equal(update.status, 0, update.stderr);
  const read = unpack(await client.callTool({ name: 'mem_get', arguments: { id: saved.id } }));
  assert.deepEqual(read.tags, ['keep']);
  assert.equal(read.title, 'Renamed');
  const clear = cli('mem_save', '--id', saved.id, '--content', '', '--no-tags');
  assert.equal(clear.status, 0, clear.stderr);
  const cleared = unpack(await client.callTool({ name: 'mem_get', arguments: { id: saved.id } }));
  assert.equal(cleared.content, '');
  assert.deepEqual(cleared.tags, []);
  const cliSearch = cli('mem_search', '--query', 'Renamed');
  const mcpSearch = unpack(await client.callTool({ name: 'mem_search', arguments: { query: 'Renamed' } }));
  assert.deepEqual(JSON.parse(cliSearch.stdout), mcpSearch);
  assert.notEqual(cli('mem_search', '--limit', '-1').status, 0);
  assert.equal((await createToolHandlers(config).mem_search({ limit: -1 })).isError, true);
  assert.notEqual(cli('mem_save', '--typo', 'x').status, 0);
  assert.equal((await client.callTool({ name: 'mem_save', arguments: { typo: 'x' } })).isError, true);
  assert.equal((await client.callTool({ name: 'mem_search', arguments: { limit: -1 } })).isError, true);
  assert.deepEqual(parseToolArgs(getToolByName('mem_save'), ['--title', 'x']), { title: 'x' });
  await client.close();
});


test('enabling embeddings queues existing documents without restarting unchanged work', t => {
  const { config } = fixture(t);
  const saved = saveDocument(config, { content: 'existing knowledge' });
  config.embeddings.enabled = true;
  reindex(config);
  const db = getDb(config);
  const job = () => db.prepare('SELECT * FROM embedding_jobs WHERE document_id=?').get(saved.id);
  assert.equal(job().status, 'pending');
  db.prepare("UPDATE embedding_jobs SET status='completed'").run();
  reindex(config);
  assert.equal(job().status, 'completed');
  saveDocument(config, { id: saved.id, content: 'changed knowledge' });
  assert.equal(job().status, 'pending');
  assert.notEqual(job().content_hash, undefined);
});
