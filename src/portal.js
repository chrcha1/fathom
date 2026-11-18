// Reads one day of Wikipedia's "Portal:Current events" from its wikitext.
//
// The page is a list of categories ('''Politics and elections''') holding
// bullets. A bullet followed by deeper bullets names an ongoing story
// (*[[Insurgency in Khyber Pakhtunkhwa]]); the deepest bullets are the event
// reports: a sentence with [[Target|label]] links and its sources at the end
// ([https://… (AP)]). Pure: wikitext in, plain data out.

import { normaliseTitle, isWebUrl } from './text.js';

const NOT_AN_ARTICLE = /^(?:file|image|media|category|template|wikt|wiktionary|commons|s|d|m|q|wp|wikipedia|portal|special|help):/i;
const WIKILINK = /\[\[([^\[\]|]+)(?:\|([^\[\]]*))?\]\]([a-z]*)/g;
const EXTERNAL = /\[(https?:\/\/[^\s\]]+)(?:\s+([^\]]*))?\]/g;
const CATEGORY = /^'''\s*(.+?)\s*'''\s*$/;
const BULLET = /^(\*+)\s*(.*)$/;

const unquote = (text) => text.replace(/'{2,}/g, '');
const tidy = (text) =>
  text
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();

// One bullet's wikitext as a sentence, with what it links to and cites.
function readLine(raw) {
  const sources = [];
  const links = [];
  let text = raw
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '');

  text = text.replace(EXTERNAL, (_whole, url, label = '') => {
    const name = unquote(label).replace(/^\s*\(\s*|\s*\)\s*$/g, '').trim();
    if (isWebUrl(url)) sources.push({ url, name: name || new URL(url).hostname.replace(/^www\./, '') });
    return '';
  });

  text = text.replace(WIKILINK, (_whole, target, piped, trail) => {
    const bare = target.trim().replace(/^:/, '');
    if (NOT_AN_ARTICLE.test(bare)) return '';
    const title = normaliseTitle(bare);
    const label = unquote(piped?.trim() || bare.split('#')[0].replaceAll('_', ' ')) + trail;
    if (title) links.push({ title, label, common: /^\p{Ll}/u.test(bare) });
    return label;
  });

  return { text: tidy(unquote(text).replace(/&nbsp;/g, ' ')), links, sources };
}

// Returns the day's event reports, in page order:
// { category, text, links: [{ title, label, common }], stories: [{ title, label }],
//   sources: [{ url, name }] }.
// `stories` are the ongoing-story headings the report sits under, outermost
// first. `common` marks links written in lowercase ([[ambush]]): ordinary
// nouns, as opposed to the names the report is about.
export function parsePortal(wikitext) {
  if (typeof wikitext !== 'string') return [];
  const lines = wikitext.replace(/<!--[\s\S]*?-->/g, '').split('\n');

  const bullets = [];
  let category = null;
  for (const line of lines) {
    const heading = CATEGORY.exec(line.trim());
    if (heading) {
      category = unquote(heading[1]);
      continue;
    }
    const bullet = BULLET.exec(line.trim());
    if (bullet && bullet[2].trim()) bullets.push({ depth: bullet[1].length, raw: bullet[2], category });
  }

  const events = [];
  const above = []; // the story headings currently open, by depth
  bullets.forEach((bullet, i) => {
    const next = bullets[i + 1];
    const leads = Boolean(next) && next.category === bullet.category && next.depth > bullet.depth;
    const line = readLine(bullet.raw);
    above.length = Math.min(above.length, bullet.depth - 1);
    while (above.length < bullet.depth - 1) above.push([]);

    // A report is a bullet with nothing beneath it; one that leads others
    // but cites a source is both a heading and a report.
    if ((!leads || line.sources.length) && line.text) {
      events.push({
        category: bullet.category,
        text: line.text,
        links: line.links,
        stories: above.flat(),
        sources: line.sources,
      });
    }
    if (leads) above[bullet.depth - 1] = line.links.map(({ title, label }) => ({ title, label }));
  });
  return events;
}
