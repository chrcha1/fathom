// Going deeper into one topic: its opening text, the threads that lead out of
// it, a related word to branch to, and matching typed text to an article.

import { displayName, presentable, isArticleTitle, sentenceAt } from './text.js';

const DESCRIBED = 40; // threads that get a one-line description up front
const FALLBACK_POOL = 30; // pick among the closest N similar articles

export class NoRelativesError extends Error {
  constructor(word) {
    super(`No related topics found for "${word}"`);
    this.name = 'NoRelativesError';
    this.word = word;
  }
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const keyOf = (title) => title.toLowerCase();

// Orders an article's opening links for learning. The API lists them
// alphabetically and includes infobox and citation links; the ones whose
// names appear in the opening prose are the concepts the article leans on, so
// they come first, in reading order, each with the sentence it appears in.
// Returns [{ title, word, mentioned, sentence }].
export function rankThreads(links, extract, self = '') {
  const seen = new Set([displayName(self).toLowerCase()]);
  const mentioned = [];
  const others = [];
  for (const title of links) {
    if (!presentable(title)) continue;
    const word = displayName(title);
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?:e?s)?(?![\\p{L}\\p{N}])`, 'iu');
    const at = extract ? extract.search(pattern) : -1;
    if (at >= 0) mentioned.push({ title, word, mentioned: true, sentence: sentenceAt(extract, at), at });
    else others.push({ title, word, mentioned: false, sentence: null });
  }
  mentioned.sort((a, b) => a.at - b.at);
  return [...mentioned.map(({ at: _at, ...thread }) => thread), ...others];
}

// A redirect and the article it leads to both show up as links ("Saint
// Anthony of Padua", "Anthony of Padua"). They share a description and one
// name contains the other; keep whichever comes first.
export function dropEchoes(threads) {
  const kept = [];
  for (const thread of threads) {
    const name = thread.word.toLowerCase();
    const echo = kept.some((other) => {
      const otherName = other.word.toLowerCase();
      return thread.desc && thread.desc === other.desc && (name.includes(otherName) || otherName.includes(name));
    });
    if (!echo) kept.push(thread);
  }
  return kept;
}

export function createTopics({ wikipedia, rng = Math.random, onPartial = () => {} }) {
  const articles = new Map(); // title -> promise of the article

  const pick = (list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

  // Descriptions are a nicety: without them the threads are still there.
  async function describe(titles) {
    if (!titles.length) return new Map();
    try {
      return await wikipedia.descriptions(titles);
    } catch (err) {
      onPartial(err);
      return new Map();
    }
  }

  async function fetchArticle(title) {
    const [intro, links] = await Promise.all([wikipedia.intro(title), wikipedia.introLinks(title)]);
    if (intro.missing) {
      return { title, missing: true, description: null, extract: '', threads: [] };
    }
    const ranked = rankThreads(links, intro.extract, intro.title);
    const described = await describe(ranked.slice(0, DESCRIBED).map((thread) => thread.title));
    return {
      title: intro.title,
      missing: false,
      description: intro.description,
      extract: intro.extract,
      threads: dropEchoes(ranked.map((thread) => ({ ...thread, desc: described.get(thread.title) ?? null }))),
    };
  }

  // { title, missing, description, extract, threads: [{ title, word, desc,
  //   mentioned, sentence }] }. Remembered for the visit; a failed fetch is
  // forgotten so the next try starts clean.
  function article(title) {
    const key = keyOf(title);
    if (!articles.has(key)) {
      const loading = fetchArticle(title);
      articles.set(key, loading);
      loading.catch(() => articles.delete(key));
    }
    return articles.get(key);
  }

  const asEntry = (thread) => ({
    word: thread.word,
    title: thread.title,
    kind: 'topic',
    origin: 'thread',
    desc: thread.desc ?? null,
    why: thread.sentence ?? null,
    link: null,
  });

  // A word to branch to from `node`: something its article's opening leans
  // on, or failing that an article that reads like it. `exclude` holds the
  // lowercase titles already on the tree.
  async function related(node, exclude = new Set()) {
    if (node.kind !== 'topic' || !node.title) throw new NoRelativesError(node.word);
    const base = displayName(node.title).toLowerCase();
    const fresh = (title) => !exclude.has(keyOf(title)) && displayName(title).toLowerCase() !== base;

    const { threads } = await article(node.title);
    const open = threads.filter((thread) => fresh(thread.title));
    const inProse = open.filter((thread) => thread.mentioned);
    const candidates = inProse.length ? inProse : open;
    if (candidates.length) {
      const thread = pick(candidates);
      if (thread.desc != null) return asEntry(thread);
      const described = await describe([thread.title]);
      return asEntry({ ...thread, desc: described.get(thread.title) ?? null });
    }

    const similar = (await wikipedia.moreLike(node.title)).filter(presentable).filter(fresh);
    if (!similar.length) throw new NoRelativesError(node.word);
    const title = pick(similar.slice(0, FALLBACK_POOL));
    const described = await describe([title]);
    return asEntry({ title, word: displayName(title), desc: described.get(title) ?? null, sentence: null });
  }

  // The article a typed phrase most likely means: { title, desc }, or null
  // when nothing matches.
  async function resolve(text) {
    const title = await wikipedia.search(text);
    if (!title || !isArticleTitle(title)) return null; // any real article, however long its name
    const described = await describe([title]);
    return { title, desc: described.get(title) ?? null };
  }

  return { article, related, resolve };
}

// Whether typed text is worth looking up at all: a question or a sentence is
// a note to self, not the name of something.
export function looksLikeTopic(text) {
  return !/[?!]$/.test(text) && text.split(/\s+/).length <= 6;
}
