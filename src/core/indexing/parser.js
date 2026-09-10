import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';

function extractText(node) {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  return (node.children ?? []).map(extractText).join('');
}

export function extractMarkdownFields(markdown, { includeCodeBlocks }) {
  const tree = unified().use(remarkParse).parse(markdown);
  const headings = Array.from({ length: 6 }, () => []);
  const paragraphs = [];
  visit(tree, node => {
    if (node.type === 'heading') headings[node.depth - 1].push(extractText(node));
    else if (node.type === 'paragraph') paragraphs.push(extractText(node));
    else if (includeCodeBlocks && node.type === 'code') paragraphs.push(node.value);
  });
  return {
    title: headings[0][0] ?? '',
    ...Object.fromEntries(headings.map((values,i) => [`h${i+1}`, values.join('\n')])),
    body: paragraphs.join('\n\n')
  };
}
