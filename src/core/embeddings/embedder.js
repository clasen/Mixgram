/**
 * Optional embedding provider using @huggingface/transformers (Xenova/multilingual-e5-large).
 * Dynamically imported so the app runs without it when embeddings are disabled.
 */
const MODEL = 'Xenova/multilingual-e5-large';
const DIM = 1024;
const DTYPE = 'q8';

const pipelineCache = new Map();

async function loadPipeline(options = {}) {
  const model = options.model ?? MODEL;
  const dtype = options.dtype ?? DTYPE;
  const key = `${model}:${dtype}`;
  if (pipelineCache.has(key)) return pipelineCache.get(key);
  try {
    const { pipeline } = await import('@huggingface/transformers');
    const pipe = pipeline('feature-extraction', model, {
      pooling: 'mean',
      normalize: true,
      dtype
    });
    pipelineCache.set(key, pipe);
    return pipe;
  } catch (err) {
    throw err;
  }
}

/**
 * Embed a single text with the given pipeline. Returns Float32Array (L2-normalized).
 */
async function embedWith(extractor, text, dimensions) {
  if (!text || typeof text !== 'string') text = '';
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  const arr = output.data || output.arraySync?.() || Array.from(output);
  return new Float32Array(arr.slice(0, dimensions));
}

export async function getEmbedder(config) {
  if (!config?.embeddings?.enabled) return null;
  try {
    const opts = config.embeddings;
    const extractor = await loadPipeline({
      model: opts.model ?? MODEL,
      dtype: opts.dtype ?? DTYPE
    });
    const dimensions = opts.dimensions ?? DIM;
    return {
      embed: (text) => embedWith(extractor, text, dimensions),
      dimensions
    };
  } catch {
    return null;
  }
}

export { embedWith as embed, DIM, MODEL, DTYPE };
