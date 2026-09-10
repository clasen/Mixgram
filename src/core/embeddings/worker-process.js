import fs from 'fs';
import { getEmbedder } from './embedder.js';
import { processNextJob } from './queue.js';
import { closeDb } from '../../db/sqlite.js';

const config = JSON.parse(fs.readFileSync(process.env.MIXGRAM_WORKER_CONFIG, 'utf8'));
let stopped = false;
process.on('disconnect', () => { stopped = true; closeDb(config); process.exit(0); });
process.on('message', async msg => {
  if (msg?.type !== 'embed' || typeof msg.text !== 'string') return;
  try {
    const embedder = await getEmbedder(config);
    const vector = await embedder.embed(msg.text);
    if (process.connected) process.send({ type: 'embedResult', id: msg.id, vector: Array.from(vector) });
  } catch (error) {
    if (process.connected) process.send({ type: 'embedResult', id: msg.id, err: error.message });
  }
});

async function loop() {
  while (!stopped) {
    try {
      if (await processNextJob(config)) continue;
    } catch (error) { process.stderr.write(`[mixgram-worker] ${error.message}\n`); }
    await new Promise(resolve => setTimeout(resolve, config.embeddings.workerPollMs));
  }
}
loop().catch(error => { process.stderr.write(`${error.message}\n`); process.exit(1); });
