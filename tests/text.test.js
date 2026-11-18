import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  displayName,
  presentable,
  isArticleTitle,
  normaliseTitle,
  stripHtml,
  clip,
  sentences,
  sentenceAt,
  monthDay,
  wikiUrl,
  isWebUrl,
} from '../src/text.js';

test('titles read on the tree without their bracketed qualifier', () => {
  assert.equal(displayName('Wicked (2024 film)'), 'Wicked');
  assert.equal(displayName('Scott Colom'), 'Scott Colom');
  assert.equal(displayName('(Sittin’ On) The Dock of the Bay'), '(Sittin’ On) The Dock of the Bay');
});

test('real subjects are presentable; site plumbing, lists and dates are not', () => {
  for (const title of ['Scott Colom', 'Ramayana: Part 1', 'Survivor Series: WarGames (2026)', '2026 Kraków shooting', 'GLP-1 receptor agonist']) {
    assert.equal(presentable(title), true, title);
  }
  for (const title of [
    'Main Page', 'Special:Search', 'Portal:Current events', 'Wikipedia:Protection policy', 'Template talk:Cite web',
    'Deaths in 2026', 'List of highest-grossing Indian films', 'Doi (identifier)', '2026', 'November 11', '11 November',
    '.xxx', '123', null, undefined, 42,
  ]) {
    assert.equal(presentable(title), false, String(title));
  }
});

test('a long title is a real article but too long to be a word on the tree', () => {
  const title = '2026 United States Senate election in Mississippi';
  assert.equal(isArticleTitle(title), true);
  assert.equal(presentable(title), false);
});

test('link targets are spelled the way Wikipedia spells them', () => {
  assert.equal(normaliseTitle('ambush'), 'Ambush');
  assert.equal(normaliseTitle('SS_United_States#Retirement'), 'SS United States');
  assert.equal(normaliseTitle('  ocean   liner '), 'Ocean liner');
  assert.equal(normaliseTitle('#History'), '');
});

test('HTML becomes its words, with comments and entities resolved', () => {
  const html = '<!--Nov 8-->In stock car racing, <a rel="mw:WikiLink" href="./Kyle_Larson" title="Kyle Larson">Kyle Larson</a> <i></i> wins <b><a href="./x">the NASCAR Cup Series</a></b>.';
  assert.equal(stripHtml(html), 'In stock car racing, Kyle Larson wins the NASCAR Cup Series.');
  assert.equal(stripHtml('Tom &amp; Jerry&nbsp;&#8212; &lt;b&gt; &#x41; &bogus;'), 'Tom & Jerry — <b> A &bogus;');
  assert.equal(stripHtml(null), '');
});

test('clipping cuts at a word and says so', () => {
  assert.equal(clip('short', 20), 'short');
  const clipped = clip('The quick brown fox jumps over the lazy dog', 20);
  assert.equal(clipped, 'The quick brown fox…');
  assert.ok(clipped.length <= 20);
  assert.equal(clip('Supercalifragilisticexpialidocious', 10).length, 10);
});

test('sentences split on full stops but not on abbreviations', () => {
  const text = 'Colom is a U.S. senator-elect from Mississippi. He defeated Cindy Hyde-Smith in 2026. Dr. No was not involved!';
  assert.deepEqual(sentences(text).map((s) => s.text), [
    'Colom is a U.S. senator-elect from Mississippi.',
    'He defeated Cindy Hyde-Smith in 2026.',
    'Dr. No was not involved!',
  ]);
  assert.equal(sentenceAt(text, text.indexOf('Cindy')), 'He defeated Cindy Hyde-Smith in 2026.');
  assert.equal(sentenceAt(text, 0), 'Colom is a U.S. senator-elect from Mississippi.');
  assert.equal(sentenceAt('', 0), '');
});

test('dates, links and what counts as a web address', () => {
  assert.equal(monthDay('2026-11-10'), 'nov 10');
  assert.equal(monthDay('2026-01-05Z'), 'jan 5');
  assert.equal(monthDay(null), '');
  assert.equal(wikiUrl('Wicked (2024 film)'), 'https://en.wikipedia.org/wiki/Wicked_(2024_film)');
  assert.equal(wikiUrl('AC/DC?'), 'https://en.wikipedia.org/wiki/AC%2FDC%3F');
  assert.equal(isWebUrl('https://apnews.com/a'), true);
  for (const url of ['javascript:alert(1)', 'data:text/html,x', '//evil.test', 'https://a b', '', null]) {
    assert.equal(isWebUrl(url), false, String(url));
  }
});
