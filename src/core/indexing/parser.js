import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';
import { parse as parseFrontmatter } from '../../utils/markdown.js';

function stringifyNode(node) {
  if (node.value) return node.value;
  if (node.children) return node.children.map(stringifyNode).join('');
  return '';
}

function extractSections(mdBody) {
  const tree = unified().use(remarkParse).parse(mdBody);
  const sections = [];
  let currentHeading = null;
  let currentDepth = 0;
  let currentContent = [];

  const flush = () => {
    const text = currentContent.join('\n').trim();
    if (text) {
      sections.push({ headingPath: currentHeading || '', headingLevel: currentDepth, content: text });
    }
  };

  visit(tree, (node) => {
    if (node.type === 'heading') {
      flush();
      currentDepth = node.depth;
      const title = stringifyNode(node);
      currentHeading = currentHeading ? `${currentHeading} > ${title}` : title;
      currentContent = [title ? `#${'#'.repeat(node.depth - 1)} ${title}` : ''];
      return;
    }
    if (node.type === 'paragraph' || node.type === 'code' || node.type === 'blockquote' || node.type === 'list') {
      currentContent.push(stringifyNode(node));
    }
  });

  flush();

  if (sections.length === 0 && mdBody.trim()) {
    sections.push({ headingPath: '', headingLevel: 0, content: mdBody.trim() });
  }
  return sections;
}

function chunkSections(sections, chunkSize = 1200, chunkOverlap = 120) {
  const chunks = [];
  for (const sec of sections) {
    const { headingPath, headingLevel, content } = sec;
    if (content.length <= chunkSize) {
      chunks.push({ headingPath, headingLevel, content });
      continue;
    }
    let start = 0;
    while (start < content.length) {
      let end = Math.min(start + chunkSize, content.length);
      if (end < content.length) {
        const lastSpace = content.lastIndexOf(' ', end);
        if (lastSpace > start) end = lastSpace;
      }
      chunks.push({ headingPath, headingLevel, content: content.slice(start, end).trim() });
      start = end - (end - start < content.length ? chunkOverlap : 0);
    }
  }
  return chunks;
}

function parseAndChunk(rawContent, options = {}) {
  const { chunkSize = 1200, chunkOverlap = 120 } = options;
  const { frontmatter, body } = parseFrontmatter(rawContent);
  const sections = extractSections(body);
  const chunks = chunkSections(sections, chunkSize, chunkOverlap);
  return { frontmatter, body, chunks };
}

export { extractSections, chunkSections, parseAndChunk };
