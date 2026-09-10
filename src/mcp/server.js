import { fork } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../config.js';
import { closeDb } from '../db/sqlite.js';
import { reindex } from '../core/indexing/reindex.js';
import { startWatcher } from '../fs/watcher.js';
import { createToolHandlers } from './tools.js';
import { getToolDefinitions } from './tool-registry.js';

const version = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const workers = new WeakMap();

export function startEmbeddingWorker(config) {
  if (!config.embeddings.enabled) return () => {};
  if (workers.has(config)) return workers.get(config);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mixgram-worker-'));
  const configPath = path.join(directory, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  const child = fork(new URL('../core/embeddings/worker-process.js', import.meta.url), [], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'], env: { ...process.env, MIXGRAM_WORKER_CONFIG: configPath }
  });
  const pending = new Map();
  let closed = false;
  const settle = (id, error, vector) => {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    clearTimeout(request.timer);
    if (error) request.reject(error); else request.resolve(new Float32Array(vector));
  };
  child.on('message', msg => {
    if (msg?.type === 'embedResult') settle(msg.id, msg.err ? new Error(msg.err) : null, msg.vector);
  });
  const cleanup = () => {
    if (closed) return;
    closed = true;
    for (const id of pending.keys()) settle(id, new Error('Embedding worker stopped'));
    delete config.getQueryEmbedding;
    child.kill();
    fs.rmSync(directory, { recursive: true, force: true });
    workers.delete(config);
  };
  child.once('exit', cleanup);
  child.once('error', cleanup);
  config.getQueryEmbedding = text => new Promise((resolve, reject) => {
    if (!child.connected || closed) { reject(new Error('Embedding worker unavailable')); return; }
    const id = randomUUID();
    const timer = setTimeout(() => settle(id, new Error('Query embedding timed out')), config.embeddings.queryTimeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.send({ type: 'embed', id, text }, error => { if (error) settle(id, error); });
  });
  workers.set(config, cleanup);
  return cleanup;
}

export function createServer(overrides = {}, baseDir) {
  const config = loadConfig(overrides, baseDir);
  const mcpServer = new McpServer({ name: 'mixgram', version });
  const handlers = createToolHandlers(config);
  for (const tool of getToolDefinitions()) {
    mcpServer.registerTool(tool.name, { description: tool.description, inputSchema: tool.schema }, handlers[tool.name]);
  }
  return { mcpServer, config };
}

export async function run(overrides = {}, baseDir) {
  const { mcpServer, config } = createServer(overrides, baseDir);
  if (config.indexing.reindexOnStartup) {
    const result = reindex(config);
    for (const error of result.errors) process.stderr.write(`[mixgram] ${error.path}: ${error.error}\n`);
  }
  const watcher = config.watch ? startWatcher(config) : null;
  const stopWorker = startEmbeddingWorker(config);
  const cleanup = async () => { await watcher?.close(); stopWorker(); closeDb(config); };
  const transport = new StdioServerTransport();
  mcpServer.server.onclose = cleanup;
  const exit = async () => { await mcpServer.close(); await cleanup(); };
  process.once('SIGINT', exit);
  process.once('SIGTERM', exit);
  try { await mcpServer.connect(transport); }
  catch (error) { await cleanup(); throw error; }
}
