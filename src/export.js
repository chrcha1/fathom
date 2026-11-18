// A day's canvas as Markdown: what "copy" puts on the clipboard. A nested
// list of the words, each with its description and link, and beneath it why
// it was there and any note you wrote. Pure.

import { wikiUrl } from './text.js';
import { whyLine } from './lines.js';

const escapeText = (text) => text.replace(/([\\`*_[\]<>])/g, '\\$1');
const linkUrl = (url) => url.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20');
const link = (label, url) => `[${escapeText(label)}](${linkUrl(url)})`;

function wordLine(node) {
  const name = node.kind === 'topic' && node.title ? link(node.word, wikiUrl(node.title)) : escapeText(node.word);
  const what = node.desc ? ` — ${escapeText(node.desc)}` : '';
  return `${name}${what}${node.readAt ? ' *(read)*' : ''}`;
}

export function toMarkdown(forest, { day, name }) {
  const lines = [`# ${name} · ${day}`, ''];
  const walk = (id, depth) => {
    const node = forest.nodes[id];
    const pad = '  '.repeat(depth);
    lines.push(`${pad}- ${wordLine(node)}`);
    if (node.origin === 'current' && node.why) {
      const why = whyLine(node);
      const source = why.link ? ` (${link(why.link.name, why.link.url)})` : '';
      lines.push(`${pad}  - _why now:_ ${escapeText(why.text)}${source}`);
    }
    if (node.note.trim()) {
      const [first, ...rest] = node.note.trim().split(/\n+/);
      lines.push(`${pad}  - _note:_ ${escapeText(first)}`);
      for (const more of rest) lines.push(`${pad}    ${escapeText(more.trim())}`);
    }
    for (const kid of node.children) walk(kid, depth + 1);
  };
  forest.roots.forEach((root, i) => {
    if (i > 0) lines.push('');
    walk(root, 0);
  });
  return `${lines.join('\n')}\n`;
}
