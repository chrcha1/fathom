import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getJson, polite, ServiceError } from '../src/services/http.js';
import { createWikipedia } from '../src/services/wikipedia.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const kindOf = (kind) => (err) => err instanceof ServiceError && err.kind === kind;
const answering = (body) => createWikipedia({ getJson: async () => body });
const DAY = new Date(Date.UTC(2026, 10, 5));

// ---------- http ----------

test('getJson returns parsed JSON', async () => {
  assert.deepEqual(await getJson('https://x.test', { fetchImpl: async () => ok([1]) }), [1]);
});

test('getJson reports a dropped connection', async () => {
  const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(getJson('https://x.test', { fetchImpl }), kindOf('network'));
});

test('getJson gives up on a server that never answers', async () => {
  const fetchImpl = (_url, { signal }) =>
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  await assert.rejects(getJson('https://x.test', { fetchImpl, timeoutMs: 10 }), kindOf('timeout'));
});

test('getJson reports HTTP errors with their status, and "too many requests" as busy', async () => {
  await assert.rejects(
    getJson('https://x.test', { fetchImpl: async () => ({ ok: false, status: 500 }) }),
    (err) => kindOf('http')(err) && err.status === 500,
  );
  const limited = { ok: false, status: 429, headers: new Map([['Retry-After', '2']]) };
  await assert.rejects(
    getJson('https://x.test', { fetchImpl: async () => limited }),
    (err) => kindOf('busy')(err) && err.status === 429 && err.retryAfterMs === 2000,
  );
  await assert.rejects(
    getJson('https://x.test', { fetchImpl: async () => ({ ok: false, status: 503 }) }),
    (err) => kindOf('busy')(err) && err.retryAfterMs === null,
  );
});

test('getJson reports a body that is not JSON', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('<html>'); } });
  await assert.rejects(getJson('https://x.test', { fetchImpl }), kindOf('malformed'));
});

// ---------- good manners ----------

test('a turned-away request is asked again after the pause the server names', async () => {
  const waits = [];
  let calls = 0;
  const request = async () => {
    calls += 1;
    if (calls < 3) throw new ServiceError('busy', { kind: 'busy', status: 429, retryAfterMs: calls === 1 ? 1500 : null });
    return 'answer';
  };
  const get = polite(request, { wait: async (ms) => waits.push(ms), baseDelayMs: 700 });
  assert.equal(await get('https://x.test'), 'answer');
  assert.deepEqual(waits, [1500, 1400], 'the server’s pause, then our own growing one');
});

test('retries are bounded, capped, and only for "busy"', async () => {
  const waits = [];
  let calls = 0;
  const always = async () => { calls += 1; throw new ServiceError('busy', { kind: 'busy', status: 429, retryAfterMs: 60000 }); };
  const get = polite(always, { retries: 2, maxDelayMs: 4000, wait: async (ms) => waits.push(ms) });
  await assert.rejects(get('https://x.test'), kindOf('busy'));
  assert.equal(calls, 3);
  assert.deepEqual(waits, [4000, 4000]);

  let tries = 0;
  const offline = polite(async () => { tries += 1; throw new ServiceError('down', { kind: 'network' }); }, { wait: async () => {} });
  await assert.rejects(offline('https://x.test'), kindOf('network'));
  assert.equal(tries, 1, 'being offline is not retried behind the user’s back');
});

test('only a couple of requests are in flight at once, and a failure frees its place', async () => {
  let inFlight = 0;
  let peak = 0;
  const release = [];
  const request = (url) =>
    new Promise((resolve, reject) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      release.push(() => {
        inFlight -= 1;
        if (url.endsWith('/bad')) reject(new ServiceError('nope', { kind: 'http', status: 500 }));
        else resolve(url);
      });
    });
  const get = polite(request, { concurrency: 2 });
  const all = Promise.allSettled(['a', 'bad', 'c', 'd', 'e'].map((name) => get(`https://x.test/${name}`)));
  for (let done = 0; done < 5; done++) {
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(release.length > done, 'the next request has started');
    release[done]();
  }
  const results = await all;
  assert.equal(peak, 2);
  assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled']);
});

// ---------- wikipedia: current events ----------

test('current events asks for the UTC day by its page name and returns the wikitext', async () => {
  let asked;
  const wiki = createWikipedia({
    getJson: async (url) => {
      asked = new URL(url);
      return { parse: { title: 'x', wikitext: "'''Sports'''\n*Something happens." } };
    },
  });
  assert.equal(await wiki.currentEvents(DAY), "'''Sports'''\n*Something happens.");
  assert.equal(asked.origin, 'https://en.wikipedia.org');
  assert.equal(asked.searchParams.get('page'), 'Portal:Current events/2026 November 5');
  assert.equal(asked.searchParams.get('origin'), '*');
});

test('a day with no page is null; an API refusal or odd shape is malformed', async () => {
  assert.equal(await answering({ error: { code: 'missingtitle', info: 'nope' } }).currentEvents(DAY), null);
  await assert.rejects(answering({ error: { code: 'ratelimited' } }).currentEvents(DAY), kindOf('malformed'));
  await assert.rejects(answering({ parse: {} }).currentEvents(DAY), kindOf('malformed'));
  await assert.rejects(answering('<html>').currentEvents(DAY), kindOf('malformed'));
  await assert.rejects(answering(null).currentEvents(DAY), kindOf('malformed'));
});

// ---------- wikipedia: the front-page feed ----------

test('the feed is asked by UTC date and trimmed to what the site reads', async () => {
  let asked;
  const wiki = createWikipedia({
    getJson: async (url) => {
      asked = url;
      return {
        tfa: { title: 'Ignored' },
        news: [
          {
            story: '<!--Nov 8--><b><a href="./A">A thing</a></b> happens to <a href="./B_C">B C</a>.',
            links: [
              { title: 'A_thing', normalizedtitle: 'A thing', description: 'Event', namespace: { id: 0 } },
              { title: 'B_C', description: '', namespace: { id: 0 } },
              { title: 'Template:Junk', namespace: { id: 10 } },
              null,
            ],
          },
          { story: 'No links at all', links: [] },
          { links: [{ title: 'Storyless' }] },
        ],
        mostread: {
          date: '2026-11-04Z',
          articles: [
            { title: 'Thomas_Massie', description: 'American politician (born 1971)', views: 166628, rank: 9, namespace: { id: 0 } },
            { title: 'Special:Search', namespace: { id: -1 }, views: 5, rank: 1 },
            { title: 'No_numbers' },
            { views: 3 },
          ],
        },
      };
    },
  });
  const feed = await wiki.featured(DAY);
  assert.ok(asked.endsWith('/feed/featured/2026/11/05'));
  assert.deepEqual(feed.news, [
    {
      html: '<!--Nov 8--><b><a href="./A">A thing</a></b> happens to <a href="./B_C">B C</a>.',
      links: [{ title: 'A thing', description: 'Event' }, { title: 'B C', description: null }],
    },
  ]);
  assert.deepEqual(feed.mostread, {
    date: '2026-11-04',
    articles: [
      { title: 'Thomas Massie', description: 'American politician (born 1971)', views: 166628, rank: 9 },
      { title: 'No numbers', description: null, views: null, rank: null },
    ],
  });
});

test('a feed with neither part is empty, not an error; a non-object is malformed', async () => {
  assert.deepEqual(await answering({ tfa: {} }).featured(DAY), { news: [], mostread: null });
  assert.deepEqual(await answering({ news: 'soon', mostread: { articles: [] } }).featured(DAY), { news: [], mostread: null });
  for (const body of [null, 'text', [1, 2]]) await assert.rejects(answering(body).featured(DAY), kindOf('malformed'));
});

// ---------- wikipedia: one article ----------

test('opening links keep real, existing articles only', async () => {
  const wiki = answering({
    parse: {
      links: [
        { ns: 0, title: 'CNN', exists: true },
        { ns: 0, title: 'Red link', exists: false },
        { ns: 10, title: 'Template:Cite web', exists: true },
        { ns: 0, exists: true },
        null,
      ],
    },
  });
  assert.deepEqual(await wiki.introLinks('Scott Colom'), ['CNN']);
  assert.deepEqual(await answering({ error: { code: 'missingtitle' } }).introLinks('Nope'), []);
  await assert.rejects(answering({ parse: { links: 'many' } }).introLinks('X'), kindOf('malformed'));
});

test('an opening comes back with its final title and description, or as missing', async () => {
  const page = { title: 'Large language model', extract: ' An LLM is a model. ', description: 'Type of machine learning model' };
  assert.deepEqual(await answering({ query: { pages: [page] } }).intro('LLM'), {
    title: 'Large language model',
    description: 'Type of machine learning model',
    extract: 'An LLM is a model.',
    missing: false,
  });
  assert.deepEqual(await answering({ query: { pages: [{ title: 'Nope', missing: true }] } }).intro('Nope'), {
    title: 'Nope', description: null, extract: '', missing: true,
  });
  await assert.rejects(answering({ query: { pages: [] } }).intro('X'), kindOf('malformed'));
  await assert.rejects(answering({ batchcomplete: true }).intro('X'), kindOf('malformed'));
});

test('bulk descriptions are mapped back to the titles as asked, through renames and redirects', async () => {
  const wiki = answering({
    query: {
      normalized: [{ from: 'ambush', to: 'Ambush' }],
      redirects: [{ from: 'LLM', to: 'Large language model' }],
      pages: [
        { title: 'No such page xyzzy', missing: true },
        { title: 'Ambush', description: 'Military attack from concealed positions' },
        { title: 'Germany', description: 'Country in Europe' },
        { title: 'Large language model', description: 'Type of machine learning model' },
        { title: 'Undescribed' },
      ],
    },
  });
  const found = await wiki.descriptions(['ambush', 'LLM', 'No such page xyzzy', 'Germany', 'Undescribed', 'Germany']);
  assert.deepEqual([...found], [
    ['ambush', 'Military attack from concealed positions'],
    ['LLM', 'Type of machine learning model'],
    ['Germany', 'Country in Europe'],
  ]);
});

test('descriptions are asked fifty at a time; one failed batch does not lose the others', async () => {
  const batches = [];
  const wiki = createWikipedia({
    getJson: async (url) => {
      const titles = new URL(url).searchParams.get('titles').split('|');
      batches.push(titles.length);
      if (titles.includes('T60')) throw new ServiceError('slow', { kind: 'timeout' });
      return { query: { pages: titles.map((title) => ({ title, description: `d ${title}` })) } };
    },
  });
  const titles = Array.from({ length: 120 }, (_, i) => `T${i}`);
  const found = await wiki.descriptions(titles);
  assert.deepEqual(batches, [50, 50, 20]);
  assert.equal(found.size, 70);
  assert.equal(found.get('T119'), 'd T119');

  const down = createWikipedia({ getJson: async () => { throw new ServiceError('down', { kind: 'network' }); } });
  await assert.rejects(down.descriptions(['A']), kindOf('network'));
  assert.deepEqual([...(await down.descriptions([]))], []);
  await assert.rejects(answering({ query: {} }).descriptions(['A']), kindOf('malformed'));
});

test('search returns the best title or null; similar articles return titles', async () => {
  assert.equal(await answering({ query: { search: [{ title: 'Regulation of artificial intelligence' }] } }).search('ai regulation'), 'Regulation of artificial intelligence');
  assert.equal(await answering({ query: { searchinfo: { totalhits: 0 }, search: [] } }).search('qqq'), null);
  await assert.rejects(answering({ query: {} }).search('x'), kindOf('malformed'));
  assert.deepEqual(await answering({ query: { search: [{ title: 'A' }, { pageid: 2 }, { title: 'B' }] } }).moreLike('X'), ['A', 'B']);
  await assert.rejects(answering({}).moreLike('X'), kindOf('malformed'));
});
