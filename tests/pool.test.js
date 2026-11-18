import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPool, drawFrom, whyOf, toEntry, createPool, isPoolItem, NothingHereError } from '../src/pool.js';
import { parsePortal } from '../src/portal.js';
import { createWikipedia } from '../src/services/wikipedia.js';
import { isPerson } from '../src/classify.js';
import { ServiceError } from '../src/services/http.js';

const read = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const portal = { '2026-11-12': read('portal-2026-11-12.wikitext'), '2026-11-11': read('portal-2026-11-11.wikitext'), '2026-11-10': read('portal-2026-11-10.wikitext') };
const feeds = { '2026-11-12': JSON.parse(read('feed-2026-11-12.json')), '2026-11-11': JSON.parse(read('feed-2026-11-11.json')) };

// The real feed responses, passed through the real service wrapper.
const normalise = (raw) => createWikipedia({ getJson: async () => raw }).featured(new Date());
const NOW = new Date('2026-11-12T00:56:00Z'); // early in the UTC day: today's pages are still thin
const isoDay = (date) => date.toISOString().slice(0, 10);
const kindOf = (kind) => (err) => err instanceof ServiceError && err.kind === kind;
const sequence = (...values) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};

// A stand-in for the Wikipedia service that answers from the saved pages.
function fakeWikipedia(overrides = {}) {
  return {
    currentEvents: async (date) => portal[isoDay(date)] ?? null,
    featured: async (date) => {
      const raw = feeds[isoDay(date)];
      if (!raw) throw new ServiceError('Request failed (HTTP 404)', { kind: 'http', status: 404 });
      return normalise(raw);
    },
    descriptions: async (titles) =>
      new Map(
        [
          ['Scott Colom', 'American politician and lawyer (born 1982)'],
          ['Germany', 'Country in Europe'],
          ['Pakistan', 'Country in South Asia'],
          ['Web Summit', 'Annual technology conference'],
        ].filter(([title]) => titles.includes(title)),
      ),
    ...overrides,
  };
}

async function realPool() {
  const [today, yesterday] = await Promise.all([normalise(feeds['2026-11-12']), normalise(feeds['2026-11-11'])]);
  return buildPool({
    days: ['2026-11-12', '2026-11-11', '2026-11-10'].map((date) => ({ date, events: parsePortal(portal[date]) })),
    news: today.news,
    mostread: yesterday.mostread,
  });
}
const find = (items, title) => items.find((item) => item.title === title);

// ---------- building ----------

test('the three sources merge into one list with a why for every word', async () => {
  const items = await realPool();
  assert.ok(items.length > 150, `${items.length} items`);
  assert.equal(new Set(items.map((item) => item.title.toLowerCase())).size, items.length, 'one item per title');
  for (const item of items) {
    assert.ok(['news', 'portal', 'mostread'].includes(item.origin));
    assert.ok(item.weight > 0);
    assert.ok(whyOf(item), `${item.title} has a why`);
    assert.ok(item.word.length <= 40);
  }
});

test('a reported person carries the report, its source and its day', async () => {
  const colom = find(await realPool(), 'Scott Colom');
  assert.equal(colom.origin, 'portal');
  assert.equal(colom.category, 'Politics and elections');
  assert.equal(colom.date, '2026-11-11');
  assert.match(colom.why, /^After a week of counting affidavit ballots, CNN projects the election/);
  assert.equal(colom.link.name, 'CNN');
  assert.deepEqual(toEntry(colom), {
    word: 'Scott Colom', title: 'Scott Colom', kind: 'topic', origin: 'current',
    desc: null, why: colom.why, link: colom.link,
  });
});

test('ongoing stories outweigh names, names outweigh asides, common nouns stay out', async () => {
  const items = await realPool();
  assert.equal(find(items, 'Insurgency in Khyber Pakhtunkhwa').weight, 4);
  assert.equal(find(items, 'Kohat District').weight, 2);
  assert.equal(find(items, 'Khyber Pakhtunkhwa Police').weight, 1, 'linked from the word "police"');
  assert.equal(find(items, 'Ambush'), undefined);
  assert.equal(find(items, 'Ocean liner'), undefined);
  assert.equal(find(items, '2026 United States Senate election in Mississippi'), undefined, 'too long for a word');
  assert.equal(find(items, 'Deaths in 2026'), undefined);
  assert.equal(find(items, 'Russo-Ukrainian war (2022–present)').word, 'Russo-Ukrainian war');
});

test('in the news: the bolded article leads, and its story is the why', async () => {
  const items = await realPool();
  const series = find(items, '2026 NASCAR Cup Series');
  assert.equal(series.origin, 'news');
  assert.equal(series.weight, 5);
  assert.equal(series.why, 'In stock car racing, Kyle Larson wins the NASCAR Cup Series.');
  assert.equal(series.description, 'American motorsport championship season');
  assert.equal(find(items, 'Kyle Larson').weight, 2);
  assert.equal(find(items, 'Kyle Larson').link.url, 'https://en.wikipedia.org/wiki/2026_NASCAR_Cup_Series');
});

test('most read: rank, views and the day they were counted', async () => {
  const items = await realPool();
  const massie = find(items, 'Thomas Massie');
  assert.equal(massie.origin, 'mostread');
  assert.equal(whyOf(massie), '#9 most read on wikipedia on nov 10 · 166,628 views');
  assert.equal(find(items, 'Ramayana: Part 1').weight, 4, 'the top ten weigh more');
});

test('a word that is both reported and widely read keeps the report and adds its rank', async () => {
  const items = await realPool();
  // In the news and in the most-read list.
  const shooting = find(items, '2026 Kraków shooting');
  assert.equal(shooting.origin, 'news');
  assert.equal(shooting.rank, 46);
  assert.match(whyOf(shooting), /^A mass shooting in the Main Square of Kraków.* · #46 most read on wikipedia$/);
  // In the news outranks the portal for the same title.
  assert.equal(find(items, '2026 United States elections').origin, 'news');
});

test('nothing in, nothing out', () => {
  assert.deepEqual(buildPool(), []);
  assert.deepEqual(buildPool({ days: [{ date: '2026-11-12', events: [] }], news: [], mostread: null }), []);
  assert.equal(whyOf({ why: null, rank: null }), null);
});

// ---------- drawing ----------

const item = (title, origin, weight, description = null, category = null) => ({
  title, word: title, origin, weight, description, category,
});

test('a draw respects the lens and avoids what is already used', () => {
  const items = [
    item('Scott Colom', 'portal', 2, 'American politician (born 1982)'),
    item('Nvidia', 'mostread', 3, 'American multinational technology company'),
    item('Black Doves', 'mostread', 3, 'British television series'),
  ];
  assert.equal(drawFrom(items, 'people', new Set(), () => 0.5).title, 'Scott Colom');
  assert.equal(drawFrom(items, 'tech', new Set(), () => 0.5).title, 'Nvidia');
  assert.equal(drawFrom(items, 'culture', new Set(), () => 0.5).title, 'Black Doves');
  assert.equal(drawFrom(items, 'news', new Set(), () => 0.99).title, 'Scott Colom');
  // Everything else used up: the one left is the one drawn, whatever the dice say.
  for (const roll of [0, 0.5, 0.999]) {
    assert.equal(drawFrom(items, 'anything', new Set(['scott colom', 'nvidia']), () => roll).title, 'Black Doves');
  }
  // All used: repeats are allowed rather than running dry.
  assert.ok(drawFrom(items, 'people', new Set(['scott colom']), () => 0));
});

test('an empty lens says so instead of inventing a word', () => {
  assert.throws(
    () => drawFrom([item('Nvidia', 'mostread', 3, 'American multinational technology company')], 'people'),
    (err) => err instanceof NothingHereError && err.lens === 'people',
  );
  assert.throws(() => drawFrom([], 'anything'), NothingHereError);
});

test('under "anything" the source is chosen first, so the long portal list cannot drown the rest', () => {
  const items = [
    ...Array.from({ length: 200 }, (_, i) => item(`Event ${i}`, 'portal', 4)),
    item('Widely Read', 'mostread', 3),
  ];
  let seed = 11;
  const rng = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let read = 0;
  for (let i = 0; i < 400; i++) if (drawFrom(items, 'anything', new Set(), rng).origin === 'mostread') read += 1;
  assert.ok(read > 120 && read < 280, `most-read drawn ${read} of 400 times`);
});

test('places are drawn far less often than the stories set in them', () => {
  const items = [item('Germany', 'portal', 2, 'Country in Europe'), item('Merz cabinet', 'portal', 2, 'Government of Germany')];
  let seed = 3;
  const rng = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let germany = 0;
  for (let i = 0; i < 400; i++) if (drawFrom(items, 'news', new Set(), rng).title === 'Germany') germany += 1;
  assert.ok(germany < 130, `Germany drawn ${germany} of 400 times`);
});

// ---------- loading ----------

test('loading reads the last three portal days and takes news and most-read from whichever feed has them', async () => {
  const asked = { portal: [], feed: [], described: [] };
  const wikipedia = fakeWikipedia();
  const spy = {
    currentEvents: (date) => (asked.portal.push(isoDay(date)), wikipedia.currentEvents(date)),
    featured: (date) => (asked.feed.push(isoDay(date)), wikipedia.featured(date)),
    descriptions: (titles) => (asked.described.push(titles), wikipedia.descriptions(titles)),
  };
  const partial = [];
  const pool = createPool({ wikipedia: spy, now: () => NOW, onPartial: (err) => partial.push(err) });
  const items = await pool.load();

  assert.deepEqual(asked.portal, ['2026-11-12', '2026-11-11', '2026-11-10']);
  assert.deepEqual(asked.feed, ['2026-11-12', '2026-11-11']);
  assert.ok(find(items, 'Scott Colom'), 'yesterday’s portal fills in for today’s empty page');
  assert.ok(find(items, 'Kyle Larson'), 'news from today’s feed');
  assert.ok(find(items, 'Thomas Massie'), 'most-read from yesterday’s feed');
  assert.equal(find(items, 'Scott Colom').description, 'American politician and lawyer (born 1982)');
  assert.ok(asked.described[0].length <= 200);
  assert.ok(!asked.described[0].includes('Thomas Massie'), 'feed items already have descriptions');
  assert.deepEqual(partial, []);

  // A second load within the half hour does not ask again.
  await pool.load();
  assert.equal(asked.portal.length, 3);
  for (let i = 0; i < 25; i++) {
    const drawn = await pool.draw('people');
    assert.ok(isPerson(drawn.description), `${drawn.title} — ${drawn.description}`);
  }
});

test('one source missing: the others carry on, and the gap is reported, not shown', async () => {
  const partial = [];
  const pool = createPool({
    wikipedia: fakeWikipedia({
      featured: async () => { throw new ServiceError('Request failed (HTTP 503)', { kind: 'busy', status: 503 }); },
    }),
    now: () => NOW,
    onPartial: (err) => partial.push(err),
  });
  const items = await pool.load();
  assert.ok(find(items, 'Scott Colom'));
  assert.equal(find(items, 'Thomas Massie'), undefined);
  assert.equal(partial.length, 2, 'both feed days failed');
  assert.ok((await pool.draw('news')).title);
});

test('a feed day that is not published yet is ordinary, not a failure', async () => {
  const partial = [];
  const pool = createPool({
    wikipedia: fakeWikipedia({
      featured: async (date) => {
        if (isoDay(date) === '2026-11-12') throw new ServiceError('Request failed (HTTP 404)', { kind: 'http', status: 404 });
        return normalise(feeds['2026-11-11']);
      },
    }),
    now: () => NOW,
    onPartial: (err) => partial.push(err),
  });
  assert.ok(find(await pool.load(), 'Thomas Massie'));
  assert.deepEqual(partial, []);
});

test('descriptions failing only thins the lenses', async () => {
  const partial = [];
  const pool = createPool({
    wikipedia: fakeWikipedia({ descriptions: async () => { throw new ServiceError('nope', { kind: 'timeout' }); } }),
    now: () => NOW,
    onPartial: (err) => partial.push(err),
  });
  const items = await pool.load();
  assert.equal(find(items, 'Scott Colom').description, null);
  assert.equal(partial.length, 1);
  assert.ok((await pool.draw('people')).description, 'people from the feeds are still there');
});

test('offline: the load fails as a network error, and the next try starts over', async () => {
  let online = false;
  const down = async () => { throw new ServiceError('Request failed (network)', { kind: 'network' }); };
  const wikipedia = fakeWikipedia();
  const pool = createPool({
    wikipedia: {
      currentEvents: (date) => (online ? wikipedia.currentEvents(date) : down()),
      featured: (date) => (online ? wikipedia.featured(date) : down()),
      descriptions: (titles) => (online ? wikipedia.descriptions(titles) : down()),
    },
    now: () => NOW,
  });
  await assert.rejects(pool.draw('anything'), kindOf('network'));
  await assert.rejects(pool.load(), kindOf('network'));
  online = true;
  assert.ok((await pool.draw('anything')).title);
});

test('malformed answers everywhere surface as such; empty pages as "empty"', async () => {
  const bad = async () => { throw new ServiceError('Wikipedia returned an unexpected feed', { kind: 'malformed' }); };
  const broken = createPool({ wikipedia: { currentEvents: bad, featured: bad, descriptions: bad }, now: () => NOW });
  await assert.rejects(broken.load(), kindOf('malformed'));

  const hollow = createPool({
    wikipedia: {
      currentEvents: async () => null,
      featured: async () => ({ news: [], mostread: null }),
      descriptions: async () => new Map(),
    },
    now: () => NOW,
  });
  await assert.rejects(hollow.load(), kindOf('empty'));

  // A timeout among other failures is the one worth telling the user about.
  const mixed = createPool({
    wikipedia: {
      currentEvents: bad,
      featured: async () => { throw new ServiceError('slow', { kind: 'timeout' }); },
      descriptions: bad,
    },
    now: () => NOW,
  });
  await assert.rejects(mixed.load(), kindOf('timeout'));
});

test('after half an hour the pool refreshes; a failed refresh keeps the words in hand', async () => {
  let clock = NOW.getTime();
  let calls = 0;
  let online = true;
  const wikipedia = fakeWikipedia();
  const pool = createPool({
    wikipedia: {
      ...wikipedia,
      currentEvents: async (date) => {
        calls += 1;
        if (!online) throw new ServiceError('Request failed (network)', { kind: 'network' });
        return wikipedia.currentEvents(date);
      },
    },
    now: () => new Date(clock),
    rng: sequence(0.2),
  });
  await pool.load();
  assert.equal(calls, 3);
  clock += 31 * 60 * 1000;
  await pool.load();
  assert.equal(calls, 6, 'refreshed');

  clock += 31 * 60 * 1000;
  online = false;
  const kept = await pool.load();
  assert.ok(find(kept, 'Thomas Massie'), 'most-read came from the feed, which still answers');
  // Now cut everything: the earlier words are still served.
  const dark = createPool({
    wikipedia: {
      currentEvents: async (date) => (online ? wikipedia.currentEvents(date) : Promise.reject(new ServiceError('x', { kind: 'network' }))),
      featured: async (date) => (online ? wikipedia.featured(date) : Promise.reject(new ServiceError('x', { kind: 'network' }))),
      descriptions: wikipedia.descriptions,
    },
    now: () => new Date(clock),
  });
  online = true;
  const first = await dark.load();
  online = false;
  clock += 31 * 60 * 1000;
  assert.equal(await dark.load(), first);
});

// ---------- keeping the pool between visits ----------

function counting(wikipedia = fakeWikipedia()) {
  const calls = { count: 0 };
  const counted = (method) => (...args) => {
    calls.count += 1;
    return wikipedia[method](...args);
  };
  return {
    calls,
    wikipedia: { currentEvents: counted('currentEvents'), featured: counted('featured'), descriptions: counted('descriptions') },
  };
}

function memoryCache(initial = null) {
  const box = { kept: initial, writes: 0 };
  return { box, read: () => box.kept, write: (kept) => { box.kept = JSON.parse(JSON.stringify(kept)); box.writes += 1; } };
}

test('a reload within half an hour reuses the kept pool instead of asking Wikipedia again', async () => {
  const cache = memoryCache();
  const first = counting();
  const items = await createPool({ wikipedia: first.wikipedia, now: () => NOW, cache }).load();
  assert.ok(first.calls.count >= 5);
  assert.equal(cache.box.kept.fetchedAt, '2026-11-12T00:56:00.000Z', 'kept with a UTC timestamp');
  assert.ok(cache.box.kept.items.every(isPoolItem));

  const later = new Date(NOW.getTime() + 20 * 60 * 1000);
  const second = counting();
  const again = await createPool({ wikipedia: second.wikipedia, now: () => later, cache }).load();
  assert.equal(second.calls.count, 0);
  assert.deepEqual(again, JSON.parse(JSON.stringify(items)));

  const stale = new Date(NOW.getTime() + 31 * 60 * 1000);
  const third = counting();
  await createPool({ wikipedia: third.wikipedia, now: () => stale, cache }).load();
  assert.ok(third.calls.count >= 5, 'after half an hour it is fetched afresh');
  assert.equal(cache.box.kept.fetchedAt, stale.toISOString());
});

test('a kept pool that is damaged, empty or from the future is ignored, not trusted', async () => {
  const good = { title: 'Scott Colom', word: 'Scott Colom', origin: 'portal', weight: 2, why: 'x', link: null };
  const at = NOW.toISOString();
  const damaged = [
    'not json at all',
    { fetchedAt: at, items: [] },
    { fetchedAt: at, items: 'many' },
    { fetchedAt: at, items: [good, { ...good, title: 'Special:Search' }] },
    { fetchedAt: at, items: [{ ...good, weight: 'heavy' }] },
    { fetchedAt: at, items: [{ ...good, origin: 'rumour' }] },
    { fetchedAt: at, items: [{ ...good, link: { url: 'javascript:alert(1)', name: 'AP' } }] },
    { fetchedAt: at, items: [{ ...good, why: { html: '<img onerror=x>' } }] },
    { fetchedAt: 'last week', items: [good] },
    { fetchedAt: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(), items: [good] },
    { items: [good] },
  ];
  for (const kept of damaged) {
    const { calls, wikipedia } = counting();
    const items = await createPool({ wikipedia, now: () => NOW, cache: memoryCache(kept) }).load();
    assert.ok(calls.count >= 5, JSON.stringify(kept).slice(0, 60));
    assert.ok(find(items, 'Thomas Massie'));
  }
  // And one that is fine is used as it is.
  const { calls, wikipedia } = counting();
  assert.deepEqual(await createPool({ wikipedia, now: () => NOW, cache: memoryCache({ fetchedAt: at, items: [good] }) }).load(), [good]);
  assert.equal(calls.count, 0);
});

test('storage that cannot be read or written costs nothing but a report', async () => {
  const partial = [];
  const broken = {
    read: () => { throw new SyntaxError('Unexpected token'); },
    write: () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); },
  };
  const pool = createPool({ wikipedia: fakeWikipedia(), now: () => NOW, cache: broken, onPartial: (err) => partial.push(err.name) });
  assert.ok(find(await pool.load(), 'Scott Colom'));
  assert.deepEqual(partial, ['SyntaxError', 'QuotaExceededError']);
  assert.ok((await pool.draw('anything')).title, 'and it keeps working from memory');
});

test('a pool with a source missing is tried for again after five minutes, not thirty', async () => {
  let clock = NOW.getTime();
  let feedDown = true;
  const real = fakeWikipedia();
  const { calls, wikipedia } = counting({
    ...real,
    featured: async (date) => {
      if (feedDown) throw new ServiceError('Request failed (HTTP 429)', { kind: 'busy', status: 429 });
      return real.featured(date);
    },
  });
  const cache = memoryCache();
  const pool = createPool({ wikipedia, now: () => new Date(clock), cache });
  assert.equal(find(await pool.load(), 'Thomas Massie'), undefined);
  const afterFirst = calls.count;

  clock += 4 * 60 * 1000;
  await pool.load();
  assert.equal(calls.count, afterFirst, 'not yet');

  clock += 2 * 60 * 1000;
  feedDown = false;
  assert.ok(find(await pool.load(), 'Thomas Massie'), 'the feed is back, and so are its words');
  // A fresh page in between would have made the same choice from the kept copy.
  assert.equal(Date.parse(cache.box.kept.fetchedAt), clock);
});
