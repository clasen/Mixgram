/**
 * Standalone process for embedding jobs and query embeddings. Isolates
 * @huggingface/transformers (and any native/ONNX crashes) from the MCP server.
 * Invoked via child_process.fork() with env MIXGRAM_WORKER_CONFIG pointing to
 * a JSON file with the resolved config. Listens for IPC 'embed' to embed query
 * text for hybrid search so the main process never loads transformers.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_POLL_MS = 2000;

function loadWorkerConfig() {
  const configPath = process.env.MIXGRAM_WORKER_CONFIG;
  if (!configPath || !fs.existsSync(configPath)) return null;
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

let embedderInstance = null;

async function getEmbedder(config) {
  if (embedderInstance) return embedderInstance;
  const { getEmbedder: getEmbedderFn } = await import('./embedder.js');
  embedderInstance = await getEmbedderFn(config);
  return embedderInstance;
}

function setupIpc(config) {
  process.on('message', async (msg) => {
    if (msg?.type !== 'embed' || typeof msg.text !== 'string') return;
    try {
      const embedder = await getEmbedder(config);
      if (!embedder) {
        process.send?.({ type: 'embedResult', id: msg.id, err: 'embeddings not available' });
        return;
      }
      const vector = await embedder.embed(msg.text);
      process.send?.({ type: 'embedResult', id: msg.id, vector: Array.from(vector) });
    } catch (err) {
      process.send?.({ type: 'embedResult', id: msg.id, err: String(err?.message ?? err) });
    }
  });
}

async function runLoop(config) {
  const { processNextJob } = await import('./queue.js');
  const pollMs = config?.embeddings?.workerPollMs ?? DEFAULT_POLL_MS;
  const run = async () => {
    try {
      await processNextJob(config);
    } catch (err) {
      if (process.stderr) {
        process.stderr.write(`[mixgram-worker] job error: ${err?.message ?? err}\n`);
      }
    }
  };
  await run();
  setInterval(run, pollMs);
}

function main() {
  const config = loadWorkerConfig();
  if (!config?.embeddings?.enabled) {
    process.exit(0);
    return;
  }
  if (process.send) setupIpc(config);
  runLoop(config).catch((err) => {
    if (process.stderr) {
      process.stderr.write(`[mixgram-worker] fatal: ${err?.message ?? err}\n`);
    }
    process.exit(1);
  });
}

main();
