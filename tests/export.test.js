import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createForest, addRoot, addChild } from '../src/tree.js';
import { toMarkdown } from '../src/export.js';

const color = { l: 0.8, c: 0.1, h: 120 };

test('a day exports as a nested Markdown list with descriptions, links, whys and notes', () => {
  const forest = createForest();
  const colom = addRoot(forest, {
    word: 'Scott Colom', title: 'Scott Colom', kind: 'topic', origin: 'current', color,
    desc: 'American politician and lawyer (born 1982)',
    why: 'CNN projects the election for Scott Colom.',
    link: { url: 'https://www.cnn.com/2026/11/11/politics/live-news/x', name: 'CNN' },
  });
  forest.nodes[colom].readAt = '2026-11-12T01:14:51.003Z';
  forest.nodes[colom].note = 'first Democrat since 1982\n\nlook up Stennis';
  const state = addChild(forest, colom, {
    word: 'Mississippi', title: 'Mississippi', kind: 'topic', origin: 'thread', color,
    desc: 'U.S. state', why: 'He is the senator-elect from Mississippi.',
  });
  addChild(forest, state, { word: 'why did turnout rise?', kind: 'note', origin: 'own', color });
  addChild(forest, colom, {
    word: 'Wicked', title: 'Wicked (2024 film)', kind: 'topic', origin: 'own', color, desc: null,
  });
  addRoot(forest, {
    word: 'Thomas Massie', title: 'Thomas Massie', kind: 'topic', origin: 'current', color,
    desc: 'American politician (born 1971)', why: '#9 most read on wikipedia on nov 10 · 166,628 views',
  });

  assert.equal(
    toMarkdown(forest, { day: '2026-11-11', name: 'fathom' }),
    [
      '# fathom · 2026-11-11',
      '',
      '- [Scott Colom](https://en.wikipedia.org/wiki/Scott_Colom) — American politician and lawyer (born 1982) *(read)*',
      '  - _why now:_ CNN projects the election for Scott Colom. ([CNN](https://www.cnn.com/2026/11/11/politics/live-news/x))',
      '  - _note:_ first Democrat since 1982',
      '    look up Stennis',
      '  - [Mississippi](https://en.wikipedia.org/wiki/Mississippi) — U.S. state',
      '    - why did turnout rise?',
      '  - [Wicked](https://en.wikipedia.org/wiki/Wicked_%282024_film%29)',
      '',
      '- [Thomas Massie](https://en.wikipedia.org/wiki/Thomas_Massie) — American politician (born 1971)',
      '  - _why now:_ #9 most read on wikipedia on nov 10 · 166,628 views',
      '',
    ].join('\n'),
  );
});

test('text that looks like Markdown is escaped rather than obeyed', () => {
  const forest = createForest();
  const id = addRoot(forest, { word: '*bold* [link](x) <b>', kind: 'note', origin: 'own', color });
  forest.nodes[id].note = '_under_ `code`';
  const markdown = toMarkdown(forest, { day: '2026-11-11', name: 'fathom' });
  assert.ok(markdown.includes('- \\*bold\\* \\[link\\](x) \\<b\\>'));
  assert.ok(markdown.includes('_note:_ \\_under\\_ \\`code\\`'));
});

test('an empty day exports as just its heading', () => {
  assert.equal(toMarkdown(createForest(), { day: '2026-11-11', name: 'fathom' }), '# fathom · 2026-11-11\n\n');
});
