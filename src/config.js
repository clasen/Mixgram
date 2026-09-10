import path from 'path';
import os from 'os';
import fs from 'fs';
import { z } from 'zod';

const DEFAULT_CONFIG = {
  collections: { general: '~/.mixgram/v2/general' },
  defaultCollection: 'general',
  sqlitePath: '~/.mixgram/v2/index.db',
  watch: true,
  indexing: {
    reindexOnStartup: true,
    includeCodeBlocks: false,
    watchStabilityMs: 200,
    ftsWeights: { title: 10, h1: 8, h2: 6, h3: 5, h4: 4, h5: 3, h6: 2, body: 1 }
  },
  embeddings: {
    enabled: false,
    model: 'Xenova/multilingual-e5-large',
    dimensions: 1024,
    dtype: 'q8',
    maxRetries: 3,
    workerPollMs: 2000,
    queryTimeoutMs: 60000,
    jobLeaseMs: 300000,
    similarityThreshold: 0.80
  },
  search: { defaultLimit: 10, maxLimit: 100, snippetLength: 300, ftsWeight: 0.7, semanticWeight: 0.3, fusionConstant: 60 }
};

const positive = z.number().int().positive();
const schema = z.object({
  collections: z.record(z.string().min(1), z.string().min(1)).refine(v => Object.keys(v).length > 0),
  defaultCollection: z.string().min(1),
  sqlitePath: z.string().min(1),
  watch: z.boolean(),
  indexing: z.object({ reindexOnStartup: z.boolean(), includeCodeBlocks: z.boolean(), watchStabilityMs: positive,
    ftsWeights: z.object(Object.fromEntries(Object.keys(DEFAULT_CONFIG.indexing.ftsWeights).map(k => [k, z.number().nonnegative()]))) }).strict(),
  embeddings: z.object({ enabled: z.boolean(), model: z.string().min(1), dimensions: positive, dtype: z.string().min(1),
    maxRetries: positive, workerPollMs: positive, queryTimeoutMs: positive, jobLeaseMs: positive, similarityThreshold: z.number().min(-1).max(1) }).strict(),
  search: z.object({ defaultLimit: positive, maxLimit: positive, snippetLength: positive, ftsWeight: z.number().nonnegative(),
    semanticWeight: z.number().nonnegative(), fusionConstant: positive }).strict()
}).strict();

export function mergeConfig(...layers) {
  const out = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      out[key] = key !== 'collections' && value && typeof value === 'object' && !Array.isArray(value)
        ? mergeConfig(out[key] ?? {}, value) : value;
    }
  }
  return out;
}

function resolvePath(value, base) {
  const expanded = value === '~' ? os.homedir() : value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
  const absolute = path.resolve(base, expanded);
  if (fs.existsSync(absolute)) return fs.realpathSync(absolute);
  const parent = path.dirname(absolute);
  return parent === absolute ? absolute : path.join(resolvePath(parent, base), path.basename(absolute));
}

export function loadConfig(overrides = {}, baseDir = process.cwd()) {
  const config = schema.parse(mergeConfig(DEFAULT_CONFIG, overrides));
  config.collections = Object.fromEntries(Object.entries(config.collections).map(([name, root]) => [name, resolvePath(root, baseDir)]));
  if (!Object.hasOwn(config.collections, config.defaultCollection)) throw new Error('defaultCollection must name a configured collection');
  const roots = Object.values(config.collections);
  for (let i = 0; i < roots.length; i++) {
    for (let j = i + 1; j < roots.length; j++) {
      if (roots[i] === roots[j] || roots[i].startsWith(roots[j] + path.sep) || roots[j].startsWith(roots[i] + path.sep)) {
        throw new Error('Collection roots must not overlap');
      }
    }
  }
  if (config.search.defaultLimit > config.search.maxLimit) throw new Error('defaultLimit exceeds maxLimit');
  if (config.search.ftsWeight + config.search.semanticWeight === 0) throw new Error('At least one search weight must be positive');
  config.sqlitePath = resolvePath(config.sqlitePath, baseDir);
  return config;
}
