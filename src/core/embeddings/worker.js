/**
 * Background worker that processes embedding jobs when embeddings are enabled.
 */
import { processNextJob } from './queue.js';

const DEFAULT_POLL_MS = 2000;
let intervalId = null;

function startWorker(config) {
  if (!config?.embeddings?.enabled || intervalId != null) return;
  const pollMs = config.embeddings?.workerPollMs ?? DEFAULT_POLL_MS;
  intervalId = setInterval(async () => {
    try {
      const processed = await processNextJob(config);
      if (!processed) return;
    } catch (_) {}
  }, pollMs);
}

function stopWorker() {
  if (intervalId != null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export { startWorker, stopWorker };
