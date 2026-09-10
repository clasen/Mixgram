const pipelines = new WeakMap();

export async function getEmbedder(config) {
  if (!config.embeddings.enabled) return null;
  if (!pipelines.has(config)) {
    const loading = import('@huggingface/transformers').then(({ pipeline }) => pipeline('feature-extraction', config.embeddings.model, { dtype: config.embeddings.dtype }));
    pipelines.set(config, loading);
    loading.catch(() => pipelines.delete(config));
  }
  const extractor = await pipelines.get(config);
  return {
    async embed(text) {
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      if (output.data.length !== config.embeddings.dimensions) throw new Error('Embedding model dimensions do not match configuration');
      return new Float32Array(output.data);
    }
  };
}
