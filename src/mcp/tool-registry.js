import { z } from 'zod';

const text = z.string().optional();
const name = z.string().min(1);
const tags = z.array(name).optional();
const definitions = [
  { name: 'mem_save', description: 'Create a document, update by id, or upsert by explicit key within a collection. Omitted fields are preserved.', inputSchema: {
    id: name.optional(), collection: name.optional(), title: text, content: text, type: name.optional(), key: name.nullable().optional(), tags
  } },
  { name: 'mem_search', description: 'Search documents or list recent documents without query. All supplied tags must match.', inputSchema: {
    query: text, collection: name.optional(), type: name.optional(), tags, limit: z.number().int().positive().optional(), offset: z.number().int().nonnegative().optional()
  } },
  { name: 'mem_get', description: 'Read a full document with metadata separate from content.', inputSchema: { id: name } },
  { name: 'mem_delete', description: 'Soft delete a document; hardDelete permanently removes its file.', inputSchema: { id: name, hardDelete: z.boolean().optional() } },
  { name: 'mem_stats', description: 'Report document counts, index location and embedding queue status.', inputSchema: {} },
  { name: 'mem_reindex', description: 'Synchronize Markdown files; full rebuilds the derived text index. Reports errors per file.', inputSchema: { full: z.boolean().optional() } }
];

for (const tool of definitions) tool.schema = z.object(tool.inputSchema).strict();

export function getToolDefinitions() { return definitions; }
export function getToolByName(name) { return definitions.find(tool => tool.name === name); }
export function validateToolArgs(name, args) {
  const tool = getToolByName(name);
  if (!tool) throw new Error('Unknown tool');
  return tool.schema.parse(args);
}
