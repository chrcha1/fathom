import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createForest, addRoot, addChild, replaceEntry, countNodes, usedKeys, keyOf,
  worthKeeping, carryOver, isValidForest,
} from '../src/tree.js';
import { dayKey, isDayKey, dayLabel, readStore, emptyStore, visitableDays, neighbours } from '../src/journal.js';
import { whatLine, whyLine } from '../src/lines.js';
import { randomColor } from '../src/color.js';

const color = { l: 0.8, c: 0.1, h: 120 };
const current = (word, extra = {}) => ({
  word, title: word, kind: 'topic', origin: 'current', color,
  desc: 'American politician (born 1982)', why: 'Something happened.',
  link: { url: 'https://apnews.com/a', name: 'AP' }, addedAt: '2026-11-12T01:00:00.000Z', ...extra,
});
const thread = (word, extra = {}) => ({ word, title: word, kind: 'topic', origin: 'thread', color, ...extra });
const note = (word) => ({ word, kind: 'note', origin: 'own', color });

function sample() {
  const forest = createForest();
  const colom = addRoot(forest, current('Scott Colom'));
  const state = addChild(forest, colom, thread('Mississippi', { why: 'He is the senator-elect from Mississippi.' }));
  const mine = addChild(forest, state, note('why did turnout rise?'));
  return { forest, colom, state, mine };
}
const clone = (value) => JSON.parse(JSON.stringify(value));

// ---------- the tree ----------

test('a new word carries what it is, why it is here, and starts unread with no note', () => {
  const { forest, colom, mine } = sample();
  assert.deepEqual(forest.nodes[colom], {
    id: colom, parent: null, children: [2],
    word: 'Scott Colom', kind: 'topic', title: 'Scott Colom', origin: 'current', color,
    desc: 'American politician (born 1982)', why: 'Something happened.',
    link: { url: 'https://apnews.com/a', name: 'AP' },
    note: '', readAt: null, addedAt: '2026-11-12T01:00:00.000Z',
  });
  assert.equal(forest.nodes[mine].title, null);
  assert.equal(forest.active, mine);
  assert.equal(countNodes(forest), 3);
});

test('words are told apart by their article, or by their own text', () => {
  const { forest } = sample();
  addChild(forest, 1, { ...thread('Wicked'), title: 'Wicked (2024 film)' });
  assert.deepEqual([...usedKeys(forest)].sort(), ['mississippi', 'scott colom', 'why did turnout rise?', 'wicked (2024 film)']);
  assert.equal(keyOf({ title: null, word: 'My Note' }), 'my note');
});

test('replacing a word keeps its place but not the old word’s note or read mark', () => {
  const { forest, colom, state } = sample();
  forest.nodes[state].note = 'about the old word';
  forest.nodes[state].readAt = '2026-11-12T02:00:00.000Z';
  replaceEntry(forest, state, thread('Blanche Bruce'));
  const node = forest.nodes[state];
  assert.equal(node.word, 'Blanche Bruce');
  assert.equal(node.note, '');
  assert.equal(node.readAt, null);
  assert.equal(node.parent, colom);
  assert.equal(node.children.length, 1);
  assert.equal(forest.active, state);
  assert.throws(() => replaceEntry(forest, 99, thread('x')));
  assert.throws(() => addChild(forest, 99, thread('x')));
});

test('a canvas earns its place in the journal by a branch, a read or a note', () => {
  const lone = createForest();
  const id = addRoot(lone, current('Scott Colom'));
  assert.equal(worthKeeping(createForest()), false);
  assert.equal(worthKeeping(lone), false);
  lone.nodes[id].note = 'hm';
  assert.equal(worthKeeping(lone), true);
  lone.nodes[id].note = '';
  lone.nodes[id].readAt = '2026-11-12T02:00:00.000Z';
  assert.equal(worthKeeping(lone), true);
  assert.equal(worthKeeping(sample().forest), true);
});

test('undo keeps the reading and notes done since, for words that are still there', () => {
  const { forest, colom, state } = sample();
  const before = clone(forest); // the snapshot an undo would restore
  forest.nodes[colom].note = 'written after the snapshot';
  forest.nodes[colom].readAt = '2026-11-12T03:00:00.000Z';
  replaceEntry(forest, state, thread('Blanche Bruce'));
  forest.nodes[state].note = 'about Bruce';

  const restored = carryOver(before, forest);
  assert.equal(restored.nodes[colom].note, 'written after the snapshot');
  assert.equal(restored.nodes[colom].readAt, '2026-11-12T03:00:00.000Z');
  assert.equal(restored.nodes[state].word, 'Mississippi');
  assert.equal(restored.nodes[state].note, '', 'a note about a different word does not follow');
  assert.equal(isValidForest(restored), true);
});

test('a saved tree survives a JSON round trip', () => {
  const { forest, colom } = sample();
  forest.nodes[colom].readAt = '2026-11-12T03:00:00.000Z';
  assert.equal(isValidForest(clone(forest)), true);
});

test('damaged saved trees are rejected', () => {
  const damage = (change) => {
    const parts = sample();
    change(parts.forest, parts);
    return parts.forest;
  };
  const broken = [
    null,
    'tree',
    {},
    createForest(),
    damage((forest) => { forest.active = 99; }),
    damage((forest, { state }) => { forest.nodes[state].children.push(42); }),
    damage((forest, { state }) => { forest.nodes[state].parent = null; }),
    damage((forest, { state }) => { delete forest.nodes[state].color; }),
    damage((forest, { state }) => { forest.nodes[state].word = 7; }),
    damage((forest, { state }) => { forest.nodes[state].kind = 'word'; }),
    damage((forest, { state }) => { forest.nodes[state].origin = 'elsewhere'; }),
    damage((forest, { state }) => { forest.nodes[state].title = null; }), // a topic needs its article
    damage((forest, { state }) => { forest.nodes[state].note = null; }),
    damage((forest, { state }) => { forest.nodes[state].readAt = 'yesterday-ish'; }),
    damage((forest, { state }) => { forest.nodes[state].desc = { html: '<b>' }; }),
    damage((forest, { colom }) => { forest.nodes[colom].link = { url: 'javascript:alert(1)', name: 'AP' }; }),
    damage((forest, { colom }) => { forest.nodes[colom].link = { url: 'https://apnews.com/a' }; }),
    damage((forest) => { forest.nextId = 1; }),
    damage((forest) => { forest.roots = [1, 1]; }),
  ];
  broken.forEach((forest, i) => assert.equal(isValidForest(forest), false, `case ${i}`));
});

test('colours stay out of the low-contrast middle and move away from the last hue', () => {
  for (let i = 0; i < 500; i++) {
    const previous = Math.random() * 360;
    const { l, c, h } = randomColor(Math.random, previous);
    assert.ok(l <= 0.48 || l >= 0.74, `lightness ${l}`);
    assert.ok(c >= 0.05 && c <= 0.2);
    assert.ok(h >= 0 && h < 360);
    const gap = Math.abs(h - previous) % 360;
    assert.ok(Math.min(gap, 360 - gap) >= 44, `hue gap ${gap}`);
  }
});

// ---------- the two lines under a word ----------

test('what a word is, and why it is on the tree', () => {
  const { forest, colom, state, mine } = sample();
  const nodes = forest.nodes;
  assert.equal(whatLine(nodes[colom]), 'American politician (born 1982)');
  assert.deepEqual(whyLine(nodes[colom]), {
    label: 'why now', text: 'Something happened.', link: { url: 'https://apnews.com/a', name: 'AP' },
  });
  assert.deepEqual(whyLine(nodes[state], nodes[colom]), {
    label: 'how it connects to Scott Colom', text: '“He is the senator-elect from Mississippi.”', link: null,
  });
  assert.equal(whyLine({ ...nodes[state], why: null }, nodes[colom]).text, 'linked from the opening of “Scott Colom”');
  assert.equal(whatLine(nodes[mine]), 'your own note');
  assert.deepEqual(whyLine(nodes[mine], nodes[state]), { label: '', text: '', link: null });

  // A word of your own says which article it was matched to when the names differ.
  const own = { word: 'ai regulation', kind: 'topic', origin: 'own', title: 'Regulation of artificial intelligence', desc: 'Guidelines and laws to regulate AI' };
  assert.equal(whatLine(own), '→ Regulation of artificial intelligence · Guidelines and laws to regulate AI');
  assert.equal(whatLine({ ...own, word: 'Wicked', title: 'Wicked (2024 film)', desc: null }), '');
});

// ---------- the journal ----------

test('a day is named by the local calendar date, whatever the UTC date is', () => {
  // Built from local parts, so this holds in any timezone the tests run in.
  assert.equal(dayKey(new Date(2026, 10, 11, 23, 59)), '2026-11-11');
  assert.equal(dayKey(new Date(2026, 10, 12, 0, 1)), '2026-11-12');
  assert.equal(dayKey(new Date(2026, 0, 5, 12)), '2026-01-05');
  assert.match(dayKey(), /^\d{4}-\d{2}-\d{2}$/);
});

test('only real dates are day names', () => {
  for (const key of ['2026-11-11', '2024-02-29']) assert.equal(isDayKey(key), true, key);
  for (const key of ['2026-02-30', '2026-13-01', '2026-1-5', 'today', '', null, 20261111, '__proto__']) {
    assert.equal(isDayKey(key), false, String(key));
  }
});

test('days are labelled the way the control shows them', () => {
  assert.equal(dayLabel('2026-11-11', '2026-11-11'), 'today');
  assert.equal(dayLabel('2026-11-10', '2026-11-11'), 'nov 10');
  assert.equal(dayLabel('2025-12-31', '2026-01-01'), 'dec 31, 2025');
});

test('saved data comes back intact', () => {
  const { forest } = sample();
  const raw = JSON.stringify({ lens: 'people', days: { '2026-11-10': { forest, updatedAt: '2026-11-11T04:00:00.000Z' } } });
  const { store, problems } = readStore(raw);
  assert.deepEqual(problems, []);
  assert.equal(store.lens, 'people');
  assert.deepEqual(store.days['2026-11-10'], { forest, updatedAt: '2026-11-11T04:00:00.000Z' });
});

test('nothing saved, or nothing readable, starts fresh and says which', () => {
  assert.deepEqual(readStore(null), { store: emptyStore(), problems: [] });
  for (const raw of ['{not json', '"text"', '[1,2]', 'null', '42']) {
    assert.deepEqual(readStore(raw), { store: emptyStore(), problems: ['unreadable'] }, raw);
  }
  assert.deepEqual(readStore('{}'), { store: emptyStore(), problems: [] });
  assert.deepEqual(readStore('{"lens":"sports","days":[]}'), { store: emptyStore(), problems: ['days'] });
});

test('damaged days are left out one by one; the intact ones still open', () => {
  const good = sample().forest;
  const bad = sample().forest;
  bad.active = 99;
  const raw = JSON.stringify({
    lens: 'tech',
    days: {
      '2026-11-08': { forest: good, updatedAt: 'not a time' },
      '2026-11-09': { forest: bad, updatedAt: '2026-11-09T10:00:00.000Z' },
      '2026-11-10': null,
      'last tuesday': { forest: good },
      '2026-11-11': { forest: good, updatedAt: '2026-11-11T10:00:00.000Z' },
    },
  });
  const { store, problems } = readStore(raw);
  assert.deepEqual(Object.keys(store.days), ['2026-11-08', '2026-11-11']);
  assert.equal(store.days['2026-11-08'].updatedAt, null, 'a bad timestamp is dropped, the day is kept');
  assert.deepEqual(problems.sort(), ['2026-11-09', '2026-11-10', 'last tuesday']);
  assert.equal(store.lens, 'tech');
});

test('the days that can be visited are the saved ones, today, and the one on screen', () => {
  const store = { lens: 'anything', days: { '2026-11-08': {}, '2026-11-10': {} } };
  assert.deepEqual(visitableDays(store, '2026-11-11'), ['2026-11-08', '2026-11-10', '2026-11-11']);
  assert.deepEqual(visitableDays(emptyStore(), '2026-11-11'), ['2026-11-11']);
  assert.deepEqual(neighbours(store, '2026-11-11', '2026-11-11'), { earlier: '2026-11-10', later: null });
  assert.deepEqual(neighbours(store, '2026-11-10', '2026-11-11'), { earlier: '2026-11-08', later: '2026-11-11' });
  assert.deepEqual(neighbours(store, '2026-11-08', '2026-11-11'), { earlier: null, later: '2026-11-10' });
  // A day with nothing saved (undone back to one word) still has neighbours.
  assert.deepEqual(neighbours(store, '2026-11-09', '2026-11-11'), { earlier: '2026-11-08', later: '2026-11-10' });
});
