import matter from 'gray-matter';
import { z } from 'zod';

const metadata = z.object({
  id: z.string().min(1).optional(),
  title: z.string().optional(),
  type: z.string().min(1).optional(),
  key: z.string().min(1).nullable().optional(),
  tags: z.array(z.string().min(1)).optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
  deleted_at: z.string().datetime().nullable().optional()
}).strict();

export function parse(content) {
  const parsed = matter(content);
  return { frontmatter: metadata.parse(parsed.data), body: parsed.content };
}

export function toMarkdown(frontmatter, body) {
  const header = matter.stringify('', metadata.parse(frontmatter), { lineWidth: -1 });
  return header.slice(0, -1) + body;
}
