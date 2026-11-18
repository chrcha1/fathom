import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LENSES, subjectKind, inLens, isPerson, isPlace } from '../src/classify.js';
import { questionsFor, KINDS } from '../src/questions.js';

// Descriptions as Wikipedia actually words them.
const CASES = [
  ['Thomas Massie', 'American politician (born 1971)', 'person'],
  ['Jensen Huang', 'Taiwanese and American businessman (born 1963)', 'person'],
  ['Blanche Bruce', 'American politician (1841–1898)', 'person'],
  ['Santiago Peña', 'President of Paraguay from 2023 to 2026', 'person'],
  ['Ramayana: Part 1', '2026 Indian film by Nitesh Tiwari', 'work'],
  ['Black Doves', 'British television series', 'work'],
  ['Grand Theft Auto VI', 'Upcoming video game', 'work'],
  ['2026 Kraków shooting', 'Mass shooting in Kraków, Poland', 'event'],
  ['2026 NASCAR Cup Series', 'American motorsport championship season', 'event'],
  ['2026 United States elections', null, 'event'],
  ['Germany', 'Country in Europe', 'place'],
  ['Kraków', 'City in Poland', 'place'],
  ['Mississippi', 'U.S. state', 'place'],
  ['Nvidia', 'American multinational technology company', 'organisation'],
  ['Democratic Party (United States)', 'Political party', 'organisation'],
  ['Large language model', 'Type of machine learning model', 'technology'],
  ['GLP-1 receptor agonist', 'Class of anti-diabetic medication', 'technology'],
  ['Ambush', 'Military attack from concealed positions', 'event'],
  ['Incumbent', 'Current holder of an office', 'idea'],
  ['Something undescribed', null, 'idea'],
];

test('descriptions are read into the kind of thing a topic is', () => {
  for (const [title, description, kind] of CASES) {
    assert.equal(subjectKind({ title, description }), kind, `${title} — ${description}`);
  }
  assert.equal(subjectKind(), 'idea');
});

test('people and places are told apart, and a person is never a place', () => {
  assert.equal(isPerson('English comedian, writer and actor (born 1971)'), true);
  assert.equal(isPerson('Great Lakes freighter sunk in Lake Superior'), false);
  assert.equal(isPlace('Capital of France'), true);
  assert.equal(isPlace('Island country in East Asia'), true);
  assert.equal(isPlace('American politician from the state of Texas (born 1989)'), false);
  assert.equal(isPlace(null), false);
});

test('each lens takes the words that belong under it', () => {
  const item = (origin, description, category = null) => ({ origin, description, category });
  const colom = item('portal', 'American politician and lawyer (born 1982)', 'Politics and elections');
  const hack = item('portal', null, 'Science and technology');
  const nvidia = item('mostread', 'American multinational technology company');
  const film = item('mostread', '2026 Indian film by Nitesh Tiwari');
  const comedian = item('mostread', 'English comedian, actor and media personality (born 1975)');
  const larson = item('news', 'American racing driver (born 1992)');

  const under = (lens) => [colom, hack, nvidia, film, comedian, larson].filter((it) => inLens(it, lens));
  assert.deepEqual(under('anything').length, 6);
  assert.deepEqual(under('news'), [colom, hack, larson]);
  assert.deepEqual(under('people'), [colom, comedian, larson]);
  assert.deepEqual(under('tech'), [hack, nvidia]);
  assert.deepEqual(under('culture'), [film, comedian]);
  assert.deepEqual(under('nonsense'), []);
  // The portal's own spelling of a category varies in case.
  assert.equal(inLens(item('portal', null, 'SCIENCE AND TECHNOLOGY'), 'tech'), true);
});

test('there are five lenses, and every kind has a handful of questions', () => {
  assert.deepEqual(LENSES, ['anything', 'news', 'people', 'tech', 'culture']);
  const kinds = new Set(CASES.map(([, , kind]) => kind));
  assert.deepEqual([...kinds].sort(), [...KINDS].sort(), 'the kinds classified and the kinds with questions match');
  for (const kind of KINDS) {
    const questions = questionsFor(kind);
    assert.ok(questions.length >= 3 && questions.length <= 4, kind);
    assert.ok(questions.every((question) => question.endsWith('?')));
  }
  assert.deepEqual(questionsFor('unheard of'), questionsFor('idea'));
});
