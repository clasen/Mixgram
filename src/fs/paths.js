import path from 'path';
import fs from 'fs';

const TYPE_TO_DIR = {
  architecture: 'architecture',
  decision: 'decisions',
  decisions: 'decisions',
  bug: 'bugs',
  bugs: 'bugs',
  learning: 'learnings',
  learnings: 'learnings',
  discovery: 'discoveries',
  discoveries: 'discoveries',
  pattern: 'patterns',
  patterns: 'patterns',
  reference: 'reference',
  session_summary: 'sessions',
  sessions: 'sessions',
  prompt: 'prompts',
  prompts: 'prompts',
  generated_note: 'generated',
  generated: 'generated'
};

function slugFromTopicKey(topicKey) {
  if (!topicKey || typeof topicKey !== 'string') return 'note';
  return topicKey
    .replace(/\//g, '-')
    .replace(/[^a-z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .replace(/^-|-$/g, '') || 'note';
}

function documentPath(config, { scope, project, type, topic_key, id }) {
  const typeDir = TYPE_TO_DIR[type] || 'generated';
  const slug = slugFromTopicKey(topic_key);
  const baseName = `${type}--${slug}.md`;

  if (scope === 'home') {
    const root = config.homeMemoryRoot;
    return path.join(root, typeDir, baseName);
  }

  if (scope === 'project') {
    const root = config.projectMemoryRoot;
    return path.join(root, typeDir, baseName);
  }

  const root = config.projectMemoryRoot;
  return path.join(root, typeDir, baseName);
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function mixgramDir(config) {
  return path.dirname(config.sqlitePath);
}

function ensureMixgramDir(config) {
  const dir = mixgramDir(config);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export {
  documentPath,
  ensureDir,
  mixgramDir,
  ensureMixgramDir,
  TYPE_TO_DIR,
  slugFromTopicKey
};
