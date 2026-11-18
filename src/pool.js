// Today's pool of current words: everything the tree can open on, each with
// the line that says why it is current. Built from three Wikipedia sources
// that fail independently: the current-events portal (reported events), the
// front page's "in the news", and the most-read articles.

import { displayName, presentable, stripHtml, monthDay, wikiUrl, isWebUrl } from './text.js';
import { inLens, isPlace } from './classify.js';
import { parsePortal } from './portal.js';
import { ServiceError } from './services/http.js';

// How readily a word is drawn. Ongoing stories and the names a report is
// about make better opening words than its passing links.
const WEIGHT = { story: 4, named: 2, aside: 1, newsMain: 5, newsOther: 2, read: 3, readTop: 4 };
const TOP_RANK = 10;
const PLACE_FACTOR = 0.25; // "Germany" is rarely the interesting part of a report
const CHANNELS = { news: 15, portal: 45, mostread: 40 }; // the mix under "anything"
const PRECEDENCE = { news: 3, portal: 2, mostread: 1 }; // whose "why" wins for a shared title
const PORTAL_DAYS = 3; // today's page is often still empty, so read back a little
const FEED_DAYS = 2;
const MAX_DESCRIBED = 150;
const REFRESH_MS = 30 * 60 * 1000;
const RETRY_MS = 60 * 1000; // after a failed refresh, keep the old words this long
const PARTIAL_MS = 5 * 60 * 1000; // a pool with a source missing is retried this soon

export class NothingHereError extends Error {
  constructor(lens) {
    super(`No current words under "${lens}"`);
    this.name = 'NothingHereError';
    this.lens = lens;
  }
}

const present = (object) =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => value != null));

// Merges the three sources into one list, one item per article title:
// { title, word, origin: 'news' | 'portal' | 'mostread', weight, why, link,
//   date, category, description, rank, views, readOn }.
// `days` are parsed portal days, newest first: [{ date: 'YYYY-MM-DD', events }].
export function buildPool({ days = [], news = [], mostread = null } = {}) {
  const items = new Map();
  const add = (candidate) => {
    if (!presentable(candidate.title)) return;
    const key = candidate.title.toLowerCase();
    const known = items.get(key);
    if (!known) {
      items.set(key, {
        why: null, link: null, date: null, category: null,
        description: null, rank: null, views: null, readOn: null,
        ...present(candidate),
        word: displayName(candidate.title),
      });
      return;
    }
    const leads = PRECEDENCE[candidate.origin] > PRECEDENCE[known.origin];
    const [first, second] = leads ? [candidate, known] : [known, candidate];
    items.set(key, {
      ...known,
      ...present(second),
      ...present(first),
      word: known.word,
      weight: Math.max(known.weight, candidate.weight),
    });
  };

  for (const story of news) {
    const why = stripHtml(story.html);
    const [main] = story.links;
    if (!why || !main) continue;
    story.links.forEach((link, i) => {
      add({
        title: link.title,
        origin: 'news',
        weight: i === 0 ? WEIGHT.newsMain : WEIGHT.newsOther,
        why,
        link: { url: wikiUrl(main.title), name: 'wikipedia' },
        description: link.description,
      });
    });
  }

  for (const day of days) {
    for (const event of day.events) {
      const report = {
        origin: 'portal',
        why: event.text,
        link: event.sources[0] ?? null,
        date: day.date,
        category: event.category,
      };
      for (const story of event.stories) add({ ...report, title: story.title, weight: WEIGHT.story });
      for (const link of event.links) {
        if (link.common) continue; // [[ambush]]: a thread to pull, not a headline
        const named = /^[\p{Lu}\d]/u.test(link.label);
        add({ ...report, title: link.title, weight: named ? WEIGHT.named : WEIGHT.aside });
      }
    }
  }

  for (const article of mostread?.articles ?? []) {
    add({
      title: article.title,
      origin: 'mostread',
      weight: article.rank != null && article.rank <= TOP_RANK ? WEIGHT.readTop : WEIGHT.read,
      description: article.description,
      rank: article.rank,
      views: article.views,
      readOn: mostread.date,
    });
  }

  return [...items.values()];
}

// The one line that says why a word is current.
export function whyOf(item) {
  const place = item.rank != null ? `#${item.rank} most read on wikipedia` : null;
  if (item.why) return place ? `${item.why} · ${place}` : item.why;
  if (!place) return null;
  const when = monthDay(item.readOn);
  const views = item.views != null ? ` · ${item.views.toLocaleString('en-US')} views` : '';
  return `${place}${when ? ` on ${when}` : ''}${views}`;
}

// A pool item as a word ready to go on the tree.
export function toEntry(item) {
  return {
    word: item.word,
    title: item.title,
    kind: 'topic',
    origin: 'current',
    desc: item.description,
    why: whyOf(item),
    link: item.link,
  };
}

const drawWeight = (item) => item.weight * (isPlace(item.description) ? PLACE_FACTOR : 1);

function pickWeighted(entries, weightOf, rng) {
  let roll = rng() * entries.reduce((sum, entry) => sum + weightOf(entry), 0);
  for (const entry of entries) {
    roll -= weightOf(entry);
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

// Chooses one word for a lens, avoiding the titles in `exclude` (lowercase)
// until there is nothing else left. Pure given `rng`.
export function drawFrom(items, lens, exclude = new Set(), rng = Math.random) {
  const matching = items.filter((item) => inLens(item, lens));
  if (!matching.length) throw new NothingHereError(lens);
  const unused = matching.filter((item) => !exclude.has(item.title.toLowerCase()));
  let candidates = unused.length ? unused : matching;
  if (lens === 'anything') {
    // Pick the source first, or the portal's long list would drown the rest.
    const channels = Object.keys(CHANNELS).filter((name) => candidates.some((item) => item.origin === name));
    const channel = pickWeighted(channels, (name) => CHANNELS[name], rng);
    candidates = candidates.filter((item) => item.origin === channel);
  }
  return pickWeighted(candidates, drawWeight, rng);
}

// The failure most worth telling the user about: being offline explains
// everything else.
function worst(failures) {
  const kind = (name) => failures.find((err) => err instanceof ServiceError && err.kind === name);
  return kind('network') ?? kind('timeout') ?? failures[0] ?? null;
}

const utcDay = (date, daysAgo) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysAgo));
const isoDay = (date) => date.toISOString().slice(0, 10);
const range = (length) => Array.from({ length }, (_, i) => i);

const ORIGINS = new Set(Object.keys(PRECEDENCE));
const textOrNull = (value) => value == null || typeof value === 'string';
const numberOrNull = (value) => value == null || Number.isFinite(value);

// Guards a pool read back from the browser's storage.
export function isPoolItem(item) {
  return (
    Boolean(item) &&
    typeof item === 'object' &&
    typeof item.title === 'string' &&
    presentable(item.title) &&
    typeof item.word === 'string' &&
    item.word.trim() !== '' &&
    ORIGINS.has(item.origin) &&
    Number.isFinite(item.weight) &&
    item.weight > 0 &&
    textOrNull(item.why) &&
    textOrNull(item.description) &&
    textOrNull(item.category) &&
    textOrNull(item.date) &&
    textOrNull(item.readOn) &&
    numberOrNull(item.rank) &&
    numberOrNull(item.views) &&
    (item.link == null || (isWebUrl(item.link.url) && typeof item.link.name === 'string'))
  );
}

// `wikipedia` is the service from services/wikipedia.js. `onPartial` hears
// about sources that failed while others carried on. `cache`, if given, keeps
// the pool between visits so that reloading the page does not ask Wikipedia
// for the same five pages again: { read() -> { fetchedAt, items } | null,
// write({ fetchedAt, items }) }, with `fetchedAt` a UTC ISO string.
export function createPool({
  wikipedia,
  now = () => new Date(),
  rng = Math.random,
  onPartial = () => {},
  cache = null,
}) {
  let items = null;
  let loadedAt = -Infinity;
  let loading = null;

  const isFresh = (at) => {
    const age = now().getTime() - at;
    return age >= 0 && age < REFRESH_MS;
  };

  function recall() {
    if (!cache) return null;
    try {
      const saved = cache.read();
      const at = Date.parse(saved?.fetchedAt);
      const intact = Array.isArray(saved?.items) && saved.items.length > 0 && saved.items.every(isPoolItem);
      return intact && isFresh(at) ? { at, items: saved.items } : null;
    } catch (err) {
      onPartial(err); // unreadable: fetch as if nothing had been kept
      return null;
    }
  }

  function remember() {
    if (!cache) return;
    try {
      cache.write({ fetchedAt: new Date(loadedAt).toISOString(), items });
    } catch (err) {
      onPartial(err); // storage full or blocked: the pool still works for this visit
    }
  }

  async function fetchAll() {
    const today = now();
    const portalDates = range(PORTAL_DAYS).map((ago) => utcDay(today, ago));
    const feedDates = range(FEED_DAYS).map((ago) => utcDay(today, ago));
    const settled = await Promise.allSettled([
      ...portalDates.map((date) => wikipedia.currentEvents(date)),
      ...feedDates.map((date) => wikipedia.featured(date)),
    ]);
    const value = (i) => (settled[i].status === 'fulfilled' ? settled[i].value : null);
    const failures = settled.filter((result) => result.status === 'rejected').map((result) => result.reason);

    const days = portalDates.map((date, i) => ({ date: isoDay(date), events: parsePortal(value(i)) }));
    const feeds = feedDates.map((_, i) => value(PORTAL_DAYS + i)).filter(Boolean);
    const news = feeds.find((feed) => feed.news.length)?.news ?? [];
    const mostread = feeds.find((feed) => feed.mostread)?.mostread ?? null;

    const built = buildPool({ days, news, mostread });
    if (!built.length) {
      throw worst(failures) ?? new ServiceError('Nothing current to show', { kind: 'empty' });
    }
    // A feed that is not published yet (404) is ordinary, not worth a report.
    for (const failure of failures) if (failure?.status !== 404) onPartial(failure);

    // Portal links arrive without descriptions; the lenses need them.
    const lacking = built
      .filter((item) => !item.description)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, MAX_DESCRIBED)
      .map((item) => item.title);
    if (lacking.length) {
      try {
        const described = await wikipedia.descriptions(lacking);
        for (const item of built) item.description ??= described.get(item.title) ?? null;
      } catch (err) {
        onPartial(err); // the words still work; "people" and friends will be thinner
      }
    }
    return { built, complete: failures.every((failure) => failure?.status === 404) };
  }

  function load() {
    if (items && isFresh(loadedAt)) return Promise.resolve(items);
    if (!items) {
      const kept = recall();
      if (kept) {
        items = kept.items;
        loadedAt = kept.at;
        return Promise.resolve(items);
      }
    }
    loading ??= fetchAll().then(
      ({ built, complete }) => {
        items = built;
        // A pool with a source missing counts as older than it is, so the
        // whole of it is tried for again soon.
        loadedAt = now().getTime() - (complete ? 0 : REFRESH_MS - PARTIAL_MS);
        loading = null;
        remember();
        return built;
      },
      (err) => {
        loading = null; // let the next request try again
        if (items) {
          // A failed refresh keeps the words already in hand for a while.
          loadedAt = now().getTime() - REFRESH_MS + RETRY_MS;
          return items;
        }
        throw err;
      },
    );
    return loading;
  }

  return {
    load,
    async draw(lens = 'anything', exclude = new Set()) {
      return drawFrom(await load(), lens, exclude, rng);
    },
  };
}
