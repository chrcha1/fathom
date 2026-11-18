// The two quiet lines that go with a word: what it is, and why it is here.
// Shared by the caption under the tree, the reading view and the export. Pure.

import { displayName } from './text.js';

// What the word is: Wikipedia's one-line description. A word of your own
// also says which article it was matched to, when the names differ.
export function whatLine(node) {
  if (node.kind === 'note') return 'your own note';
  const renamed = node.title && displayName(node.title).toLowerCase() !== node.word.toLowerCase();
  return [renamed ? `→ ${node.title}` : null, node.desc].filter(Boolean).join(' · ');
}

// Why the word is on the tree: { label, text, link }. `parent` is the word it
// hangs from, if any; `link` is the report's source ({ url, name }) or null.
// A word of your own needs no reason: its text is empty.
export function whyLine(node, parent = null) {
  if (node.origin === 'current') {
    return { label: 'why now', text: node.why ?? '', link: node.link ?? null };
  }
  if (node.origin === 'thread' && parent) {
    return {
      label: `how it connects to ${parent.word}`,
      text: node.why ? `“${node.why}”` : `linked from the opening of “${parent.word}”`,
      link: null,
    };
  }
  return { label: '', text: '', link: null };
}
