// Wikipedia's public APIs, one method per question the site asks. No key
// required. Every method returns plain data in a fixed shape or throws a
// ServiceError; nothing downstream sees a raw response.

import { ServiceError } from './http.js';

const ACTION = 'https://en.wikipedia.org/w/api.php';
const FEED = 'https://en.wikipedia.org/api/rest_v1/feed/featured';
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const BATCH = 50; // most titles the API accepts in one request

const malformed = (what) =>
  new ServiceError(`Wikipedia returned an unexpected ${what}`, { kind: 'malformed' });

const actionUrl = (params) =>
  `${ACTION}?${new URLSearchParams({ ...params, format: 'json', formatversion: '2', origin: '*' })}`;

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const spaced = (title) => title.replaceAll('_', ' ');
const isArticle = (entry) => entry?.namespace?.id == null || entry.namespace.id === 0;

// The action API answers HTTP 200 even when it refuses a request.
function checked(data, what) {
  if (!data || typeof data !== 'object') throw malformed(what);
  if (data.error && data.error.code !== 'missingtitle') {
    throw new ServiceError(`Wikipedia refused the request (${data.error.code})`, { kind: 'malformed' });
  }
  return data;
}

export function createWikipedia({ getJson }) {
  async function describeBatch(titles) {
    const data = checked(
      await getJson(actionUrl({ action: 'query', prop: 'description', redirects: '1', titles: titles.join('|') })),
      'description list',
    );
    const pages = data.query?.pages;
    if (!Array.isArray(pages)) throw malformed('description list');
    // Answers come back in another order and under their final names.
    const renamed = new Map();
    for (const step of [...(data.query.normalized ?? []), ...(data.query.redirects ?? [])]) {
      if (typeof step?.from === 'string' && typeof step?.to === 'string') renamed.set(step.from, step.to);
    }
    const described = new Map(pages.map((page) => [page?.title, text(page?.description)]));
    const found = new Map();
    for (const title of titles) {
      let name = title;
      for (let hops = 0; hops < 3 && renamed.has(name); hops++) name = renamed.get(name);
      if (described.get(name)) found.set(title, described.get(name));
    }
    return found;
  }

  return {
    // The wikitext of the current-events page for a UTC day, or null when
    // that day's page does not exist.
    async currentEvents(date) {
      const page = `Portal:Current events/${date.getUTCFullYear()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
      const data = checked(await getJson(actionUrl({ action: 'parse', page, prop: 'wikitext' })), 'events page');
      if (data.error) return null;
      if (typeof data.parse?.wikitext !== 'string') throw malformed('events page');
      return data.parse.wikitext;
    },

    // The front page's feed for a UTC day: `news` (stories as HTML, each with
    // the articles it links, the main one first) and `mostread` (the day's
    // most-viewed articles), either of which may be absent.
    async featured(date) {
      const yyyy = date.getUTCFullYear();
      const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(date.getUTCDate()).padStart(2, '0');
      const data = await getJson(`${FEED}/${yyyy}/${mm}/${dd}`);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw malformed('feed');

      const article = (entry) => ({
        title: spaced(text(entry.normalizedtitle) ?? entry.title),
        description: text(entry.description),
      });
      const usable = (entry) => entry && typeof entry.title === 'string' && isArticle(entry);

      const news = (Array.isArray(data.news) ? data.news : [])
        .filter((story) => typeof story?.story === 'string' && Array.isArray(story.links))
        .map((story) => ({ html: story.story, links: story.links.filter(usable).map(article) }))
        .filter((story) => story.links.length);

      const read = Array.isArray(data.mostread?.articles) ? data.mostread.articles.filter(usable) : [];
      const mostread = read.length
        ? {
            date: text(data.mostread.date)?.slice(0, 10) ?? null,
            articles: read.map((entry) => ({
              ...article(entry),
              views: Number.isFinite(entry.views) ? entry.views : null,
              rank: Number.isFinite(entry.rank) ? entry.rank : null,
            })),
          }
        : null;
      return { news, mostread };
    },

    // Titles of the articles linked from an article's opening section.
    async introLinks(title) {
      const data = checked(
        await getJson(actionUrl({ action: 'parse', page: title, prop: 'links', section: '0', redirects: '1' })),
        'link list',
      );
      if (data.error) return [];
      if (!Array.isArray(data.parse?.links)) throw malformed('link list');
      return data.parse.links
        .filter((link) => link?.ns === 0 && link.exists !== false && typeof link.title === 'string')
        .map((link) => link.title);
    },

    // An article's opening section as plain text, with its one-line
    // description. `missing` is true when there is no such article.
    async intro(title) {
      const data = checked(
        await getJson(
          actionUrl({
            action: 'query',
            prop: 'extracts|description',
            exintro: '1',
            explaintext: '1',
            redirects: '1',
            titles: title,
          }),
        ),
        'article',
      );
      const page = data.query?.pages?.[0];
      if (!page || typeof page !== 'object') throw malformed('article');
      return {
        title: text(page.title) ?? title,
        description: text(page.description),
        extract: text(page.extract) ?? '',
        missing: page.missing === true || page.invalid === true,
      };
    },

    // One-line descriptions for many titles: a Map from each title as asked
    // to its description (titles without one are left out). Asked in batches;
    // fails only when every batch does.
    async descriptions(titles) {
      const wanted = [...new Set(titles)];
      const batches = [];
      for (let i = 0; i < wanted.length; i += BATCH) batches.push(wanted.slice(i, i + BATCH));
      const settled = await Promise.allSettled(batches.map(describeBatch));
      const failed = settled.find((result) => result.status === 'rejected');
      if (failed && settled.every((result) => result.status === 'rejected')) throw failed.reason;
      const found = new Map();
      for (const result of settled) {
        if (result.status === 'fulfilled') for (const [title, description] of result.value) found.set(title, description);
      }
      return found;
    },

    // The article that best matches free text, or null.
    async search(query) {
      const data = checked(
        await getJson(
          actionUrl({ action: 'query', list: 'search', srsearch: query, srlimit: '1', srnamespace: '0', srprop: '' }),
        ),
        'search result',
      );
      if (!Array.isArray(data.query?.search)) throw malformed('search result');
      return text(data.query.search[0]?.title);
    },

    // Titles of articles that read like the given one.
    async moreLike(title) {
      const data = checked(
        await getJson(
          actionUrl({
            action: 'query',
            list: 'search',
            srsearch: `morelike:${title}`,
            srnamespace: '0',
            srlimit: '30',
            srprop: '',
          }),
        ),
        'search result',
      );
      if (!Array.isArray(data.query?.search)) throw malformed('search result');
      return data.query.search.map((hit) => hit?.title).filter((t) => typeof t === 'string');
    },
  };
}
