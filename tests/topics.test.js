import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankThreads, dropEchoes, createTopics, NoRelativesError, looksLikeTopic } from '../src/topics.js';
import { ServiceError } from '../src/services/http.js';

const kindOf = (kind) => (err) => err instanceof ServiceError && err.kind === kind;

// The opening of a real article and the links the API lists for it
// (alphabetical, with a few that only appear in the infobox or citations).
const EXTRACT =
  'Scott Winston Colom (born December 24, 1982) is an American politician, lawyer, and jurist who is the United States senator-elect from Mississippi. A member of the Democratic Party, Colom has served since 2016 as district attorney.\n' +
  'The Democratic nominee in the 2026 election, Colom narrowly defeated Republican incumbent Cindy Hyde-Smith in what observers described as an upset. Colom is the first Democrat elected to represent Mississippi in the U.S. Senate since John C. Stennis in 1982, and the first Black Senator from Mississippi since Blanche Bruce in 1874.';
const LINKS = [
  '1874–75 United States Senate elections', 'Associated Press', 'Bachelor of Arts', 'Blanche Bruce', 'CNN',
  'Cindy Hyde-Smith', 'Democratic Party (United States)', 'Doi (identifier)', 'Incumbent', 'John C. Stennis',
  'Juris Doctor', 'Mississippi', 'Scott Colom', 'Template:Cite web', 'Upset (competition)',
];

function wiki(overrides = {}) {
  return {
    intro: async (title) => ({ title, description: 'American politician and lawyer (born 1982)', extract: EXTRACT, missing: false }),
    introLinks: async () => LINKS,
    descriptions: async (titles) => new Map(titles.map((title) => [title, `about ${title}`])),
    moreLike: async () => [],
    search: async () => null,
    ...overrides,
  };
}
const topic = (title) => ({ word: title, title, kind: 'topic' });

// ---------- ranking ----------

test('threads named in the opening prose come first, in reading order, with their sentence', () => {
  const threads = rankThreads(LINKS, EXTRACT, 'Scott Colom');
  const mentioned = threads.filter((thread) => thread.mentioned);
  assert.deepEqual(
    mentioned.map((thread) => thread.word),
    ['Mississippi', 'Democratic Party', 'Incumbent', 'Cindy Hyde-Smith', 'Upset', 'John C. Stennis', 'Blanche Bruce'],
  );
  assert.match(mentioned[0].sentence, /^Scott Winston Colom .* senator-elect from Mississippi\.$/);
  assert.equal(
    mentioned[3].sentence,
    'The Democratic nominee in the 2026 election, Colom narrowly defeated Republican incumbent Cindy Hyde-Smith in what observers described as an upset.',
  );
  assert.deepEqual(
    threads.filter((thread) => !thread.mentioned).map((thread) => thread.title),
    ['1874–75 United States Senate elections', 'Associated Press', 'Bachelor of Arts', 'CNN', 'Juris Doctor'],
  );
});

test('ranking leaves out the article itself, plumbing, and repeats; plurals still count as mentions', () => {
  const threads = rankThreads(LINKS, EXTRACT, 'Scott Colom');
  const titles = threads.map((thread) => thread.title);
  for (const gone of ['Scott Colom', 'Doi (identifier)', 'Template:Cite web']) assert.ok(!titles.includes(gone), gone);

  const plural = rankThreads(['Large language model', 'Art'], 'Large language models are smart. They start with data.', 'x');
  assert.equal(plural[0].mentioned, true);
  assert.equal(plural[1].mentioned, false, '"Art" is not found inside "smart" or "start"');

  const repeats = rankThreads(['Mercury (planet)', 'Mercury (element)'], 'Mercury is close to the Sun.', 'x');
  assert.deepEqual(repeats.map((thread) => thread.title), ['Mercury (planet)']);
  assert.deepEqual(rankThreads([], EXTRACT), []);
  assert.deepEqual(rankThreads(['Mississippi'], '').map((thread) => thread.mentioned), [false]);
});

test('a redirect and its target are shown once', () => {
  const threads = [
    { word: 'Saint Anthony of Padua', desc: 'Portuguese Catholic saint (1195–1231)' },
    { word: 'Anthony of Padua', desc: 'Portuguese Catholic saint (1195–1231)' },
    { word: 'Texas', desc: 'U.S. state' },
    { word: 'Mississippi', desc: 'U.S. state' },
    { word: 'Padua', desc: null },
  ];
  assert.deepEqual(dropEchoes(threads).map((thread) => thread.word), ['Saint Anthony of Padua', 'Texas', 'Mississippi', 'Padua']);
});

// ---------- an article ----------

test('an article arrives with its opening, description and described threads, and is fetched once', async () => {
  let fetched = 0;
  const topics = createTopics({ wikipedia: wiki({ intro: async (title) => (fetched++, wiki().intro(title)) }) });
  const [first, second] = await Promise.all([topics.article('Scott Colom'), topics.article('scott colom')]);
  assert.equal(first, second);
  assert.equal(fetched, 1);
  assert.equal(first.missing, false);
  assert.equal(first.description, 'American politician and lawyer (born 1982)');
  assert.equal(first.threads[0].title, 'Mississippi');
  assert.equal(first.threads[0].desc, 'about Mississippi');
});

test('a failed fetch is not remembered: the next try asks again', async () => {
  let online = false;
  const topics = createTopics({
    wikipedia: wiki({
      intro: async (title) => {
        if (!online) throw new ServiceError('Request failed (network)', { kind: 'network' });
        return wiki().intro(title);
      },
    }),
  });
  await assert.rejects(topics.article('Scott Colom'), kindOf('network'));
  online = true;
  assert.equal((await topics.article('Scott Colom')).threads.length > 0, true);
});

test('an article that no longer exists is reported as missing, not as an error', async () => {
  const topics = createTopics({
    wikipedia: wiki({ intro: async (title) => ({ title, description: null, extract: '', missing: true }), introLinks: async () => [] }),
  });
  const article = await topics.article('Gone');
  assert.deepEqual(article, { title: 'Gone', missing: true, description: null, extract: '', threads: [] });
});

test('descriptions failing leaves the threads in place, undescribed', async () => {
  const partial = [];
  const topics = createTopics({
    wikipedia: wiki({ descriptions: async () => { throw new ServiceError('slow', { kind: 'timeout' }); } }),
    onPartial: (err) => partial.push(err),
  });
  const article = await topics.article('Scott Colom');
  assert.equal(article.threads.length, 12);
  assert.ok(article.threads.every((thread) => thread.desc === null));
  assert.equal(partial.length, 1);
});

// ---------- branching ----------

test('branching picks a thread from the prose, carrying the sentence that connects it', async () => {
  const topics = createTopics({ wikipedia: wiki(), rng: () => 0 });
  const entry = await topics.related(topic('Scott Colom'));
  assert.deepEqual(entry, {
    word: 'Mississippi',
    title: 'Mississippi',
    kind: 'topic',
    origin: 'thread',
    desc: 'about Mississippi',
    why: EXTRACT.split('. ')[0] + '.',
    link: null,
  });
});

test('branching skips what is already on the tree, then falls back to links outside the prose', async () => {
  const topics = createTopics({ wikipedia: wiki(), rng: () => 0 });
  const used = new Set(['mississippi', 'democratic party (united states)']);
  assert.equal((await topics.related(topic('Scott Colom'), used)).title, 'Incumbent');

  const prose = ['Mississippi', 'Democratic Party (United States)', 'Incumbent', 'Cindy Hyde-Smith', 'Upset (competition)', 'John C. Stennis', 'Blanche Bruce'];
  const allProse = new Set(prose.map((title) => title.toLowerCase()));
  const fallback = await topics.related(topic('Scott Colom'), allProse);
  assert.equal(fallback.title, '1874–75 United States Senate elections');
  assert.equal(fallback.why, null, 'no sentence to quote');
});

test('an article with no usable links falls back to similar articles', async () => {
  const topics = createTopics({
    wikipedia: wiki({
      introLinks: async () => ['Template:Cite web', 'Doi (identifier)', '2026'],
      moreLike: async () => ['List of district attorneys', 'Scott Colom', 'Shuwaski Young', 'Portal:Law'],
    }),
    rng: () => 0,
  });
  const entry = await topics.related(topic('Scott Colom'));
  assert.equal(entry.title, 'Shuwaski Young');
  assert.equal(entry.origin, 'thread');
  assert.equal(entry.desc, 'about Shuwaski Young');
});

test('with no links and nothing similar, branching says there is nothing', async () => {
  const topics = createTopics({ wikipedia: wiki({ introLinks: async () => [], moreLike: async () => [] }) });
  await assert.rejects(topics.related(topic('Scott Colom')), (err) => err instanceof NoRelativesError && err.word === 'Scott Colom');
  // A note of your own has no article to branch from.
  await assert.rejects(topics.related({ word: 'ask mum', kind: 'note', title: null }), NoRelativesError);
});

test('branching offline fails as a network error rather than as "nothing"', async () => {
  const down = async () => { throw new ServiceError('Request failed (network)', { kind: 'network' }); };
  const topics = createTopics({ wikipedia: wiki({ intro: down, introLinks: down }) });
  await assert.rejects(topics.related(topic('Scott Colom')), kindOf('network'));
});

// ---------- your own words ----------

test('typed text resolves to an article with its description, or to nothing', async () => {
  const topics = createTopics({
    wikipedia: wiki({ search: async (text) => (text === 'ai regulation' ? 'Regulation of artificial intelligence' : null) }),
  });
  assert.deepEqual(await topics.resolve('ai regulation'), {
    title: 'Regulation of artificial intelligence',
    desc: 'about Regulation of artificial intelligence',
  });
  assert.equal(await topics.resolve('qqqzzxxy wwvvk'), null);

  const plumbing = createTopics({ wikipedia: wiki({ search: async () => 'List of things' }) });
  assert.equal(await plumbing.resolve('things'), null);
  const down = createTopics({ wikipedia: wiki({ search: async () => { throw new ServiceError('x', { kind: 'network' }); } }) });
  await assert.rejects(down.resolve('anything'), kindOf('network'));
});

test('questions and sentences are notes to self, not names to look up', () => {
  assert.equal(looksLikeTopic('ai regulation'), true);
  assert.equal(looksLikeTopic('Scott Colom'), true);
  assert.equal(looksLikeTopic('why did turnout rise?'), false);
  assert.equal(looksLikeTopic('compare this with the 2018 race in the same state'), false);
});
