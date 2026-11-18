// Small pure helpers for titles and prose: which article titles are worth
// showing, how they read on the tree, and how to cut text down politely.

const MAX_WORD_LENGTH = 40;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES =
  'january|february|march|april|may|june|july|august|september|october|november|december';

// "Portal:Current events" is site plumbing; "Ramayana: Part 1" is a film.
const NAMESPACE =
  /^(?:wikipedia|wp|special|portal|file|image|media|category|template|help|talk|user|draft|module|mediawiki|book|timedtext|wikt|wiktionary|commons|[a-z]+ talk):/i;
const NOT_A_TOPIC = /^(?:main page|search|list of|lists of|deaths in|index of|cookie)\b/i;
const UNWELCOME = /porn|xxx|xnxx|xvideos|hentai|onlyfans|\bsex/i;
const DATE = new RegExp(`^(?:\\d{1,4}|(?:${MONTH_NAMES})(?: \\d{1,2})?|\\d{1,2} (?:${MONTH_NAMES}))$`, 'i');
const IDENTIFIER = /\(identifier\)$/i;

// "Wicked (2024 film)" reads better on the tree as "Wicked".
export function displayName(title) {
  return title.replace(/\s*\([^)]*\)$/, '') || title;
}

// Whether a title names a real subject rather than site plumbing.
export function isArticleTitle(title) {
  return (
    typeof title === 'string' &&
    !NAMESPACE.test(title) &&
    !title.startsWith('.') &&
    /\p{L}/u.test(title) &&
    !NOT_A_TOPIC.test(title) &&
    !UNWELCOME.test(title) &&
    !DATE.test(title) &&
    !IDENTIFIER.test(title)
  );
}

// Article titles worth showing as a word on the tree: real subjects, short
// enough to sit on one line.
export function presentable(title) {
  return isArticleTitle(title) && [...displayName(title)].length <= MAX_WORD_LENGTH;
}

// How Wikipedia itself spells a link target: spaces for underscores, first
// letter capitalised, no section anchor.
export function normaliseTitle(target) {
  const title = target.split('#')[0].replaceAll('_', ' ').replace(/\s+/g, ' ').trim().replace(/^:/, '');
  return title ? title[0].toUpperCase() + title.slice(1) : '';
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? whole;
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
  });
}

// The words of an HTML fragment. The result is only ever shown as text.
export function stripHtml(html) {
  if (typeof html !== 'string') return '';
  return decodeEntities(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

export function clip(text, max) {
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 1);
  if (!/\s/.test(text[max - 1])) {
    // The cut fell inside a word: step back to the end of the one before.
    const space = cut.lastIndexOf(' ');
    if (space > max * 0.6) cut = cut.slice(0, space);
  }
  return `${cut.replace(/[\s,;:–-]+$/, '')}…`;
}

// A full stop after these does not end a sentence ("U.S. Senate", "Dr. No").
const ABBREVIATION = /(?:^|[\s(])(?:\p{Lu}|\p{Lu}\.\p{Lu}|Mr|Mrs|Ms|Dr|St|Jr|Sr|Inc|Ltd|Co|vs|No|Gen|Sen|Rep|Gov|Prof|Lt|Col|Capt)$/u;

export function sentences(text) {
  const found = [];
  const boundary = /[.!?]["”)]*\s+(?=[\p{Lu}"“(\d])/gu;
  let start = 0;
  for (let match = boundary.exec(text); match; match = boundary.exec(text)) {
    if (text[match.index] === '.' && ABBREVIATION.test(text.slice(start, match.index))) continue;
    found.push({ start, text: text.slice(start, match.index + match[0].length).trim() });
    start = match.index + match[0].length;
  }
  if (text.slice(start).trim()) found.push({ start, text: text.slice(start).trim() });
  return found;
}

// The sentence of `text` that contains the character at `index`.
export function sentenceAt(text, index) {
  const all = sentences(text);
  for (let i = all.length - 1; i >= 0; i--) if (all[i].start <= index) return all[i].text;
  return '';
}

// A UTC calendar day as it is written in the journal and in "why now": "nov 10".
export function monthDay(isoDay) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDay ?? '');
  const month = match && MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${Number(match[3])}` : '';
}

export function wikiUrl(title) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`;
}

export const newsUrl = (query) => `https://news.google.com/search?q=${encodeURIComponent(query)}`;
export const searchUrl = (query) => `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;

// Only ever link out to the web proper, whatever a feed or saved file says.
export const isWebUrl = (url) => typeof url === 'string' && /^https?:\/\/[^\s"<>]+$/i.test(url);
