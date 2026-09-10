import path from 'path';
import fs from 'fs';

export function collectionForPath(config, filePath) {
  const absolute = path.resolve(filePath);
  const real = fs.existsSync(absolute) ? fs.realpathSync(absolute) : absolute;
  for (const [name, root] of Object.entries(config.collections)) {
    if (absolute.startsWith(root + path.sep) && real.startsWith(root + path.sep)) return name;
  }
  throw new Error('Document is outside configured collections');
}

export function documentPath(config, { collection, title, id }) {
  const root = config.collections[collection];
  if (!root) throw new Error('Unknown collection');
  const slug = title.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80).toLowerCase() || 'note';
  return path.join(root, `${slug}-${id}.md`);
}
