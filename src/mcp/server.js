import { fork } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../config.js';
import { createToolHandlers } from './tools.js';
import { getToolDefinitions } from './tool-registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let embeddingWorkerChild = null;
let embeddingWorkerConfigPath = null;

const EMBED_TIMEOUT_MS = 60000;

function makeQueryEmbedder(child) {
  return function getQueryEmbedding(text) {
    if (!child?.connected) return Promise.resolve(null);
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('embedding timeout'));
      }, EMBED_TIMEOUT_MS);
      const onMessage = (msg) => {
        if (msg?.type !== 'embedResult' || msg.id !== id) return;
        cleanup();
        if (msg.err) {
          reject(new Error(msg.err));
          return;
        }
        resolve(msg.vector ? new Float32Array(msg.vector) : null);
      };
      const cleanup = () => {
        clearTimeout(timeout);
        child.off('message', onMessage);
      };
      child.on('message', onMessage);
      child.send({ type: 'embed', id, text });
    });
  };
}

/**
 * Start the embedding worker and set config.getQueryEmbedding for use by mem_search.
 * Used by the CLI when running tools with --embeddings so that semantic search works.
 * Returns a cleanup function to kill the worker and remove the temp config file.
 */
function startEmbeddingWorker(config) {
  if (!config?.embeddings?.enabled || config.getQueryEmbedding) {
    return () => {};
  }
  try {
    embeddingWorkerConfigPath = path.join(
      os.tmpdir(),
      `mixgram-worker-config-${process.pid}-${Date.now()}.json`
    );
    fs.writeFileSync(embeddingWorkerConfigPath, JSON.stringify(config), 'utf8');
    const workerPath = path.join(__dirname, '..', 'core', 'embeddings', 'worker-process.js');
    embeddingWorkerChild = fork(workerPath, [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...process.env, MIXGRAM_WORKER_CONFIG: embeddingWorkerConfigPath }
    });
    config.getQueryEmbedding = makeQueryEmbedder(embeddingWorkerChild);
    const cleanup = () => {
      if (embeddingWorkerChild) {
        try { embeddingWorkerChild.kill(); } catch (_) {}
        embeddingWorkerChild = null;
      }
      config.getQueryEmbedding = null;
      if (embeddingWorkerConfigPath && fs.existsSync(embeddingWorkerConfigPath)) {
        try { fs.unlinkSync(embeddingWorkerConfigPath); } catch (_) {}
        embeddingWorkerConfigPath = null;
      }
    };
    embeddingWorkerChild.on('exit', () => {
      config.getQueryEmbedding = null;
      if (embeddingWorkerConfigPath && fs.existsSync(embeddingWorkerConfigPath)) {
        try { fs.unlinkSync(embeddingWorkerConfigPath); } catch (_) {}
        embeddingWorkerConfigPath = null;
      }
    });
    return cleanup;
  } catch (err) {
    if (typeof process !== 'undefined' && process.stderr) {
      process.stderr.write(`[mixgram] embeddings worker start failed: ${err?.message ?? err}\n`);
    }
    return () => {};
  }
}

function createServer(configOverrides = {}, baseDir = null, projectBaseDir = null) {
  const config = loadConfig(configOverrides, baseDir, projectBaseDir);
  const mcpServer = new McpServer(
    { name: 'mixgram', version: '1.0.0' },
    { capabilities: { tools: { listChanged: true } } }
  );

  const handlers = createToolHandlers(config);
  const definitions = getToolDefinitions();

  for (const def of definitions) {
    const handler = handlers[def.name];
    if (!handler) continue;
    mcpServer.registerTool(def.name, {
      description: def.description,
      inputSchema: def.inputSchema
    }, async (args) => handler(args));
  }

  return { mcpServer, config };
}

async function run(configOverrides = {}, baseDir = null, projectBaseDir = null) {
  if (typeof process !== 'undefined') {
    process.on('unhandledRejection', (reason, promise) => {
      if (process.stderr) {
        process.stderr.write(`[mixgram] unhandledRejection: ${reason}\n`);
      }
    });
  }

  const { mcpServer, config } = createServer(configOverrides, baseDir, projectBaseDir);

  if (config.indexing?.reindexOnStartup) {
    try {
      const { fullReindex } = await import('../core/indexing/reindex.js');
      fullReindex(config);
    } catch (err) {
      if (typeof process !== 'undefined' && process.stderr) {
        process.stderr.write(`[mixgram] reindex on startup failed: ${err?.message ?? err}\n`);
      }
    }
  }
  if (config.watch) {
    try {
      const { startWatcher } = await import('../fs/watcher.js');
      startWatcher(config);
    } catch (err) {
      if (typeof process !== 'undefined' && process.stderr) {
        process.stderr.write(`[mixgram] watcher start failed: ${err?.message ?? err}\n`);
      }
    }
  }
  if (config.embeddings?.enabled) {
    const cleanup = startEmbeddingWorker(config);
    if (cleanup) {
      embeddingWorkerChild?.on('exit', (code, signal) => {
        if (code !== 0 && code != null && process.stderr) {
          process.stderr.write(`[mixgram] embeddings worker exited: code=${code} signal=${signal}\n`);
        }
        cleanup();
      });
      process.on('exit', () => cleanup());
    }
  }
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

export { createServer, run, startEmbeddingWorker };
