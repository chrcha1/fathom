import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePortal } from '../src/portal.js';

// Real pages, saved as they came from the API on 12 November 2026.
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const nov11 = parsePortal(fixture('portal-2026-11-11.wikitext'));
const nov10 = parsePortal(fixture('portal-2026-11-10.wikitext'));

const titles = (links) => links.map((link) => link.title);
const reportAbout = (events, phrase) => events.find((event) => event.text.includes(phrase));

test('every report of a real day is read, with its category', () => {
  assert.equal(nov11.length, 18);
  const categories = [...new Set(nov11.map((event) => event.category))];
  assert.deepEqual(categories, [
    'Armed conflicts and attacks',
    'Health and Environment',
    'Business and economy',
    'Disasters and accidents',
    'International relations',
    'Law and crime',
    'Politics and elections',
    'National Holidays',
    'Illnesses and Deaths',
    'Religion',
    'Science and technology',
    'Sports',
  ]);
  for (const event of nov11) {
    assert.ok(event.text.length > 30, `a real sentence: ${event.text}`);
    assert.doesNotMatch(event.text, /\[\[|\]\]|''|https?:|\{\{|<!--/, 'no markup left in the sentence');
    assert.ok(event.sources.length >= 1, 'every report cites a source');
  }
});

test('a report becomes a plain sentence with its links, labels and source', () => {
  const event = nov11[0];
  assert.equal(event.category, 'Armed conflicts and attacks');
  assert.equal(
    event.text,
    'Ten police personnel, including two senior officers, are killed in a clash after insurgents ambushed police vehicles in Kohat District, Khyber Pakhtunkhwa, Pakistan.',
  );
  assert.deepEqual(event.stories, [
    { title: 'Insurgency in Khyber Pakhtunkhwa', label: 'Insurgency in Khyber Pakhtunkhwa' },
  ]);
  assert.deepEqual(event.links, [
    { title: 'Khyber Pakhtunkhwa Police', label: 'police', common: false },
    { title: 'Ambush', label: 'ambushed', common: true },
    { title: 'Kohat District', label: 'Kohat District', common: false },
    { title: 'Khyber Pakhtunkhwa', label: 'Khyber Pakhtunkhwa', common: false },
    { title: 'Pakistan', label: 'Pakistan', common: false },
  ]);
  assert.equal(event.sources.length, 1);
  assert.equal(event.sources[0].name, 'AP');
  assert.match(event.sources[0].url, /^https:\/\/apnews\.com\//);
});

test('lowercase links are marked as common nouns, names are not', () => {
  const liner = reportAbout(nov11, 'artificial reef');
  const byTitle = Object.fromEntries(liner.links.map((link) => [link.title, link]));
  assert.equal(byTitle['Ocean liner'].common, true);
  assert.equal(byTitle['Artificial reef'].common, true);
  assert.equal(byTitle['SS United States'].common, false);
  assert.equal(byTitle['SS United States'].label, 'SS United States', 'italics are dropped from labels');
  assert.equal(liner.stories.length, 0, 'a report directly under a category has no story heading');
});

test('nested story headings all reach the report beneath them, outermost first', () => {
  const senate = reportAbout(nov11, 'Scott Colom');
  assert.deepEqual(titles(senate.stories), [
    '2026 United States elections',
    '2026 United States Senate elections',
    '2026 United States Senate election in Mississippi',
  ]);
  assert.ok(titles(senate.links).includes('Scott Colom'));
  assert.equal(senate.sources[0].name, 'CNN');

  // The next report sits under a different, shallower heading.
  const march = reportAbout(nov11, 'Karol Nawrocki');
  assert.deepEqual(titles(march.stories), ['Independence March (Poland)']);
});

test('a heading line may name several stories, and piped labels are kept', () => {
  const talks = reportAbout(nov10, 'A third round of');
  assert.deepEqual(titles(talks.stories), [
    'Russo-Ukrainian war (2022–present)',
    'Peace negotiations in the Russo-Ukrainian war (2022–present)',
    'United Arab Emirates in the 2026 Iran war',
    'United States and the Russo-Ukrainian war',
    '2026 United States–Ukraine–Russia meetings in Abu Dhabi',
  ]);
  assert.equal(talks.stories[0].label, 'Russo-Ukrainian war');
  assert.deepEqual(
    talks.sources.map((source) => source.name),
    ['AP', 'DW', 'The Guardian'],
  );
  const haiti = reportAbout(nov10, '400 Mawozo');
  assert.match(haiti.text, /with the Haitian police against/, 'a suffix after a link stays attached');
});

test('the empty template a new day starts as yields no reports', () => {
  assert.deepEqual(parsePortal(fixture('portal-2026-11-12.wikitext')), []);
});

test('anything that is not a current-events page is read as nothing, never thrown on', () => {
  for (const input of [null, undefined, 42, {}, '', 'just some text', '* \n** \n', "'''Sports'''"]) {
    assert.deepEqual(parsePortal(input), []);
  }
});

test('hostile or broken markup cannot smuggle in a link', () => {
  const events = parsePortal(
    [
      "'''Science and technology'''",
      '*A [[File:Photo.jpg|thumb]] thing [[Category:Hidden]] happens at [[CERN#History|the lab]]. [javascript:alert(1) (Evil)] [https://example.org/a (Example)] <ref>cite</ref>{{cn}}',
      '*An unclosed [[link and a stray ] bracket.',
    ].join('\n'),
  );
  assert.equal(events.length, 2);
  assert.equal(events[0].text, 'A thing happens at the lab. [javascript:alert(1) (Evil)]');
  assert.deepEqual(events[0].links, [{ title: 'CERN', label: 'the lab', common: false }]);
  assert.deepEqual(events[0].sources, [{ url: 'https://example.org/a', name: 'Example' }]);
  assert.deepEqual(events[1].links, []);
});
