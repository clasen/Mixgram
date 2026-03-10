import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';
import { parse as parseMarkdownWithFrontmatter } from '../../utils/markdown.js';

/**
 * Recursively extract plain text from an mdast node (strips emphasis, links, etc.).
 */
function extractTextFromNode(node) {
  if (!node) return '';
  if (node.type === 'text' || node.type === 'inlineCode') {
    return node.value || '';
  }
  if (node.children && Array.isArray(node.children)) {
    return node.children.map((child) => extractTextFromNode(child)).join('');
  }
  return '';
}

/**
 * Build mdast from raw markdown and extract title, h1–h6, body, structure, sectionsIndex.
 * One parse, one tree walk; no chunking. Compatible with the remark-parse indexing model.
 *
 * @param {string} markdown - Full markdown body (no frontmatter)
 * @param {{ includeCodeBlocks?: boolean }} options
 * @returns {{ title: string, h1: string, h2: string, h3: string, h4: string, h5: string, h6: string, body: string, structure: object[], sectionsIndex: object }}
 */
export function extractMarkdownFields(markdown, { includeCodeBlocks = false } = {}) {
  const tree = unified().use(remarkParse).parse(markdown);

  const h1 = [];
  const h2 = [];
  const h3 = [];
  const h4 = [];
  const h5 = [];
  const h6 = [];
  const bodyParts = [];
  const structure = [];
  const stack = [];
  const sectionsIndex = {};
  let currentSection = null;
  let sectionIdCounter = 0;
  let title = '';

  visit(tree, (node) => {
    if (node.type === 'heading') {
      const text = (node.children || []).map((child) => extractTextFromNode(child)).join('').trim();
      const depth = node.depth;

      switch (depth) {
        case 1: h1.push(text); break;
        case 2: h2.push(text); break;
        case 3: h3.push(text); break;
        case 4: h4.push(text); break;
        case 5: h5.push(text); break;
        case 6: h6.push(text); break;
        default: break;
      }
      if (!title && depth === 1) title = text;

      const section = {
        id: `s${++sectionIdCounter}`,
        depth,
        heading: text,
        parentId: null,
        childrenIds: []
      };

      while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
        stack.pop();
      }
      if (stack.length > 0) {
        const parent = stack[stack.length - 1];
        section.parentId = parent.id;
        parent.childrenIds.push(section.id);
      } else {
        structure.push(section);
      }
      stack.push(section);
      sectionsIndex[section.id] = section;
      currentSection = section;
      return;
    }

    if (node.type === 'paragraph') {
      const text = (node.children || []).map((child) => extractTextFromNode(child)).join('').trim();
      if (text) bodyParts.push(text);
      return;
    }

    if (includeCodeBlocks && node.type === 'code') {
      const text = node.value?.trim();
      if (text) bodyParts.push(text);
    }
  });

  const body = bodyParts.join('\n\n');

  return {
    title: title || (h1[0] ?? ''),
    h1: h1.join('\n'),
    h2: h2.join('\n'),
    h3: h3.join('\n'),
    h4: h4.join('\n'),
    h5: h5.join('\n'),
    h6: h6.join('\n'),
    body,
    structure,
    sectionsIndex
  };
}

/**
 * Parse raw content: frontmatter (gray-matter) + AST-based extraction of body fields.
 * Returns one object per document (no chunking).
 *
 * @param {string} rawContent - Full file content including optional frontmatter
 * @param {{ includeCodeBlocks?: boolean }} options
 */
export function parseMarkdown(rawContent, options = {}) {
  const { frontmatter, body: rawBody } = parseMarkdownWithFrontmatter(rawContent);
  const fields = extractMarkdownFields(rawBody, options);
  const body = (fields.body && fields.body.trim()) ? fields.body : (rawBody || '').trim();
  return { frontmatter, ...fields, body };
}
