#!/usr/bin/env node
/**
 * Black-box scenario tests for Mixgram.
 * Run: node spec/run-tests.js
 * Visual mode (narrative + inputs/outputs in console): node spec/run-tests.js --visual
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { loadConfig } from '../src/config.js';
import { createToolHandlers } from '../src/mcp/tools.js';
import { getToolDefinitions } from '../src/mcp/tool-registry.js';
import { closeDb, getDb } from '../src/db/sqlite.js';
import { scenarios } from './scenarios/scenarios.js';
import * as reporter from './reporter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mixgram-test-'));
const config = loadConfig({
  homeMemoryRoot: path.join(tmpDir, 'home', 'memory'),
  projectMemoryRoot: path.join(tmpDir, 'mixgram'),
  sqlitePath: path.join(tmpDir, '.mixgram', 'index.db')
});
fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true });

const h = createToolHandlers(config);

// Ensure every tool in the registry has a handler (CLI and MCP both use the same registry)
const definitions = getToolDefinitions();
for (const def of definitions) {
  if (!h[def.name]) throw new Error(`Tool "${def.name}" in registry has no handler in createToolHandlers`);
}
if (definitions.length === 0) throw new Error('Tool registry is empty');

function parse(res) {
  return JSON.parse(res.content[0].text);
}

let totalPassed = 0;
let totalFailed = 0;

const ctx = {
  h,
  parse,
  config,
  fs: fs,
  reporter,
  shared: {}
};

function runCliSetupChecks() {
  const cliTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mixgram-cli-test-'));
  const repoRoot = path.dirname(__dirname);

  if (reporter.VISUAL) {
    reporter.startScenario('CLI setup cursor config', 'Verify Cursor setup writes workspace cwd for project-scoped memory.');
  }

  let p = 0;
  let f = 0;
  const ok = (cond, msg) => {
    if (cond) p++;
    else f++;
    if (reporter.VISUAL) reporter.check(msg, cond);
  };

  try {
    const result = spawnSync(process.execPath, [path.join(repoRoot, 'bin', 'mixgram.js'), 'setup', 'cursor'], {
      cwd: repoRoot,
      env: { ...process.env, HOME: cliTmpDir },
      encoding: 'utf8'
    });

    ok(result.status === 0, 'setup cursor exits successfully');

    const cursorConfigPath = path.join(cliTmpDir, '.cursor', 'mcp.json');
    ok(fs.existsSync(cursorConfigPath), 'cursor mcp.json created');

    const cursorConfig = JSON.parse(fs.readFileSync(cursorConfigPath, 'utf8'));
    const entry = cursorConfig?.mcpServers?.mixgram;
    ok(entry?.command === 'mixgram', 'cursor entry command preserved');
    ok(Array.isArray(entry?.args) && entry.args[0] === 'mcp', 'cursor entry args preserved');
    ok(entry?.cwd === '${workspaceFolder}', 'cursor entry uses workspace cwd');
  } catch (err) {
    if (reporter.VISUAL) reporter.check('CLI setup cursor config threw', false, err.message);
    f += 1;
  } finally {
    try { fs.rmSync(cliTmpDir, { recursive: true, force: true }); } catch (_) {}
  }

  if (reporter.VISUAL) reporter.endScenario(p, f);
  totalPassed += p;
  totalFailed += f;
}

async function runScenarios() {
  for (const scenario of scenarios) {
    if (scenario.name === 'Semantic / embeddings (save and search)' && !ctx.hSemantic) {
      const configSemantic = loadConfig({
        homeMemoryRoot: config.homeMemoryRoot,
        projectMemoryRoot: config.projectMemoryRoot,
        sqlitePath: config.sqlitePath,
        embeddings: { enabled: true }
      });
      ctx.hSemantic = createToolHandlers(configSemantic);
    }

    try {
      const { passed, failed } = await scenario.run(ctx);
      totalPassed += passed;
      totalFailed += failed;
    } catch (err) {
      if (reporter.VISUAL) {
        reporter.check(scenario.name + ' run', false, err.message);
      }
      console.error('Scenario "' + scenario.name + '" threw:', err.message);
      totalFailed += 1;
    }
  }
}

async function runLegacySemanticKnn() {
  const configSemantic = ctx.hSemantic
    ? loadConfig({
        homeMemoryRoot: config.homeMemoryRoot,
        projectMemoryRoot: config.projectMemoryRoot,
        sqlitePath: config.sqlitePath,
        embeddings: { enabled: true }
      })
    : null;
  if (!configSemantic) return;

  const { getEmbedder } = await import('../src/core/embeddings/embedder.js');
  const { getVectorStore } = await import('../src/core/embeddings/vectorStore.js');
  const embedder = await getEmbedder(configSemantic);
  const vectorStore = await getVectorStore(configSemantic);

  if (reporter.VISUAL) {
    reporter.startScenario('Embedder and vector store (KNN)', 'Verify embedder and vectorStore APIs and semantic search for persistence doc.');
  }

  let p = 0, f = 0;
  const ok = (cond, msg) => { if (cond) p++; else f++; if (reporter.VISUAL) reporter.check(msg, cond); };

  if (embedder) {
    const vec = await embedder.embed('Embedding test phrase.');
    ok(vec instanceof Float32Array && vec.length === embedder.dimensions, 'embedder.embed returns Float32Array of correct dimensions');
  }
  if (vectorStore) {
    ok(typeof vectorStore.insert === 'function' && typeof vectorStore.search === 'function', 'vectorStore has insert and search');
  }

  const hSemantic = ctx.hSemantic || createToolHandlers(configSemantic);
  const docPersistence = 'Los datos se guardan en SQLite y la búsqueda es una forma de persistencia.';
  const savePersist = await hSemantic.mem_save({
    title: 'Persistencia y búsqueda',
    type: 'reference',
    scope: 'project',
    project: 'castlebravo',
    topic_key: 'test/persistencia-sqlite',
    content: docPersistence
  });
  const persistId = parse(savePersist).id;
  ok(!!persistId, 'saved persistence doc');
  const db = getDb(configSemantic);
  const chunkRow = db.prepare('SELECT id, document_id, content_hash, content FROM document_chunks WHERE document_id = ? LIMIT 1').get(persistId);
  ok(!!chunkRow, 'chunk exists for persistence doc');
  if (embedder && vectorStore && chunkRow) {
    const embedding = await embedder.embed(chunkRow.content);
    await vectorStore.ensureTables(configSemantic);
    await vectorStore.insert(configSemantic, {
      chunk_id: chunkRow.id,
      document_id: chunkRow.document_id,
      content_hash: chunkRow.content_hash,
      embedding
    });
    const queryEmb = await embedder.embed('dónde se persisten los datos');
    const knnResults = await vectorStore.search(configSemantic, queryEmb, 5, { similarityThreshold: 0.5 });
    ok(knnResults.length >= 1, 'KNN search returns at least one result');
    const found = knnResults.some((r) => r.document_id === persistId);
    ok(found, 'persistence doc found by semantic search');
  }

  if (reporter.VISUAL) reporter.endScenario(p, f);
  totalPassed += p;
  totalFailed += f;
}

async function run() {
  runCliSetupChecks();
  await runScenarios();
  await runLegacySemanticKnn();

  closeDb();
  try { fs.rmSync(tmpDir, { recursive: true }); } catch (_) {}

  reporter.summary(totalPassed, totalFailed);
  process.exitCode = totalFailed > 0 ? 1 : 0;
}

run().catch((err) => {
  console.error(err);
  closeDb();
  try { fs.rmSync(tmpDir, { recursive: true }); } catch (_) {}
  process.exitCode = 1;
});
