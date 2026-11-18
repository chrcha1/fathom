import { NAME, STORAGE_KEY } from './config.js';
import {
  createForest,
  addRoot,
  addChild,
  replaceEntry,
  countNodes,
  usedKeys,
  worthKeeping,
  carryOver,
} from './tree.js';
import { createStage, withGhost } from './stage.js';
import { randomColor, toCss, inkFor } from './color.js';
import { getJson, polite, ServiceError } from './services/http.js';
import { createWikipedia } from './services/wikipedia.js';
import { createPool, toEntry, NothingHereError } from './pool.js';
import { createTopics, NoRelativesError, looksLikeTopic } from './topics.js';
import { LENSES } from './classify.js';
import { dayKey, dayLabel, readStore, emptyStore, neighbours, visitableDays } from './journal.js';
import { whatLine, whyLine } from './lines.js';
import { toMarkdown } from './export.js';
import { clip, isWebUrl } from './text.js';
import { createDive } from './dive.js';
import { reportError, installGlobalHandlers } from './report.js';

const HISTORY_LIMIT = 100;
const GHOST_DELAY_MS = 150;
const MAX_OWN = 40; // longest word of your own, in characters
const MAX_NOTE = 4000;
const WHAT_CLIP = 140;
const WHY_CLIP = 280;
const NOTE_SAVE_MS = 400;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const touchOnly = window.matchMedia('(hover: none)'); // no keyboard to name in hints

const $ = (id) => document.getElementById(id);
const els = {
  stage: $('stage'),
  world: $('world'),
  tree: $('tree'),
  fields: [...document.querySelectorAll('.field')],
  what: $('what'),
  why: $('why'),
  prompt: $('prompt'),
  promptLabel: $('prompt-label'),
  own: $('own'),
  another: $('another'),
  grow: $('grow'),
  read: $('read'),
  add: $('add'),
  plant: $('plant'),
  swap: $('swap'),
  undo: $('undo'),
  copy: $('copy'),
  clear: $('clear'),
  lenses: [...document.querySelectorAll('[data-lens]')],
  days: $('days'),
  earlier: $('earlier'),
  later: $('later'),
  day: $('day'),
  dive: $('dive'),
};

const wikipedia = createWikipedia({ getJson: polite(getJson) });
// Today's words are kept for half an hour, so reloading the page does not
// ask Wikipedia for them again.
const POOL_KEY = `${STORAGE_KEY}:pool`;
const pool = createPool({
  wikipedia,
  onPartial: (err) => reportError(err, { where: 'pool' }),
  cache: {
    read: () => JSON.parse(localStorage.getItem(POOL_KEY) ?? 'null'),
    write: (kept) => localStorage.setItem(POOL_KEY, JSON.stringify(kept)),
  },
});
const topics = createTopics({ wikipedia, onPartial: (err) => reportError(err, { where: 'topics' }) });
const stage = createStage({ els, reducedMotion });

const state = {
  store: emptyStore(), // { lens, days: { 'YYYY-MM-DD': { forest, updatedAt } } }
  today: dayKey(),
  day: dayKey(), // the day on screen
  forest: createForest(),
  todayDraft: null, // today's canvas while it is not yet worth saving and another day is on screen
  history: [],
  busy: false,
  ghost: null, // { root: true } | { child: parentId } | { replace: nodeId } while a word is on its way
  freshId: null,
  lastHue: null,
  ground: randomColor(), // what the page wears before its first word arrives
  message: null,
  diving: null, // id of the word open in the reading view
  prompting: null, // { root, under } while the line for a word of your own is open
  seen: new Set(), // titles shown this visit, so space does not repeat itself
  saveFailed: false,
};

let messageTimer = null;
let noteTimer = null;
let lastG = -Infinity; // when `g` was last pressed, to recognise `gg`

// ---------- persistence ----------

function save() {
  const { days } = state.store;
  if (worthKeeping(state.forest)) {
    days[state.day] = { forest: state.forest, updatedAt: new Date().toISOString() };
  } else {
    delete days[state.day];
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.store));
    state.saveFailed = false;
  } catch (err) {
    // Storage is full or blocked. Everything still works for this visit; say
    // so once rather than on every keystroke.
    if (!state.saveFailed) {
      say('can’t save on this device — storage is full or blocked. today’s tree lasts until you close the page');
      reportError(err, { where: 'save' });
    }
    state.saveFailed = true;
  }
}

// Returns true when some saved data had to be left out.
function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    reportError(err, { where: 'load' });
    return false;
  }
  const { store, problems } = readStore(raw);
  state.store = store;
  if (!problems.length) return false;
  reportError(new Error('Saved data was damaged'), { where: 'load', problems });
  try {
    // Keep the original aside before the next save writes over it.
    localStorage.setItem(`${STORAGE_KEY}:damaged`, raw);
  } catch {
    // No room for the copy; the readable days are still intact.
  }
  return true;
}

// ---------- days ----------

const onToday = () => state.day === state.today;

function openDay(key) {
  if (onToday()) state.todayDraft = state.forest;
  state.day = key;
  state.forest =
    state.store.days[key]?.forest ?? (key === state.today ? state.todayDraft : null) ?? createForest();
  state.history = [];
  stage.forget();
}

// Notices that midnight has passed. Someone looking at "today" moves to the
// new, empty day; someone reading an older day stays where they are.
function syncToday() {
  const now = dayKey();
  if (now === state.today) return false;
  const follow = onToday() && state.diving == null;
  state.todayDraft = null;
  if (follow) {
    state.day = now; // nothing of the new day to carry over
    state.forest = createForest();
    state.history = [];
    stage.forget();
  }
  state.today = now;
  return follow;
}

function stepDay(direction) {
  if (state.busy || state.diving != null) return false;
  const { earlier, later } = neighbours(state.store, state.day, state.today);
  const target = direction < 0 ? earlier : later;
  if (!target) return false;
  openDay(target);
  say('');
  paint();
  if (onToday() && !countNodes(state.forest)) actRandom();
  return true;
}

// ---------- state changes ----------

const activeNode = () => state.forest.nodes[state.forest.active] ?? null;
const parentOf = (node) => state.forest.nodes[node.parent] ?? null;

function colored(entry) {
  const color = state.ground ?? randomColor(Math.random, state.lastHue);
  state.ground = null;
  state.lastHue = color.h;
  return { ...entry, color, addedAt: new Date().toISOString() };
}

function commit(change, { keepActive = false } = {}) {
  if (countNodes(state.forest)) {
    state.history.push(JSON.stringify(state.forest));
    if (state.history.length > HISTORY_LIMIT) state.history.shift();
  }
  const before = state.forest.active;
  const replacement = change(state.forest);
  if (replacement) state.forest = replacement;
  state.freshId = state.forest.active;
  if (keepActive && state.forest.nodes[before]) state.forest.active = before;
  save();
  paint();
}

function select(id) {
  if (state.busy || !state.forest.nodes[id] || id === state.forest.active) return;
  state.forest.active = id;
  say('');
  save();
  paint();
}

function undo() {
  if (state.busy || !state.history.length) return;
  state.forest = carryOver(JSON.parse(state.history.pop()), state.forest);
  say('');
  save();
  paint();
}

// ---------- messages ----------

function say(text, { hold = false } = {}) {
  clearTimeout(messageTimer);
  state.message = text || null;
  renderCaption();
  if (text && !hold) messageTimer = setTimeout(() => say(''), 6000);
}

function explain(err, retry) {
  if (err instanceof NothingHereError) {
    return `nothing under “${err.lens}” right now — try another lens`;
  }
  if (err instanceof NoRelativesError) {
    return `nothing branches from “${err.word}” — add a word of your own instead`;
  }
  if (err instanceof ServiceError) {
    if (err.kind === 'network') return `can’t reach wikipedia — check your connection, then ${retry}`;
    if (err.kind === 'timeout') return `wikipedia is slow to answer — ${retry}`;
    if (err.kind === 'busy') return `wikipedia asked for a breather — wait a moment, then ${retry}`;
    if (err.kind === 'empty') return `wikipedia has nothing current to offer right now — ${retry} in a while`;
    return `wikipedia gave an odd answer — ${retry}`;
  }
  return `something went wrong — ${retry}`;
}

// Runs one networked step. Resolves to its value, or undefined after telling
// the user why it failed. Only one step runs at a time.
async function attempt(ghost, task, retry = 'try again') {
  if (state.busy) return undefined;
  state.busy = true;
  say('');
  const empty = !countNodes(state.forest);
  if (empty) state.ghost = ghost; // never leave the page blank while waiting
  paint();
  const showGhost = setTimeout(() => {
    state.ghost = ghost;
    paint();
  }, GHOST_DELAY_MS);
  try {
    return await task();
  } catch (err) {
    // With nothing on the page the reason stays up until something changes.
    say(explain(err, retry), { hold: empty });
    const expected = err instanceof NoRelativesError || err instanceof NothingHereError;
    if (!expected) reportError(err, { where: 'attempt' });
    return undefined;
  } finally {
    clearTimeout(showGhost);
    state.busy = false;
    state.ghost = null;
  }
}

// ---------- actions ----------

function drawWord() {
  const exclude = new Set([...usedKeys(state.forest), ...state.seen]);
  return pool.draw(state.store.lens, exclude).then((item) => {
    state.seen.add(item.title.toLowerCase());
    return toEntry(item);
  });
}

// How to ask again, in the words of whatever the reader has in hand.
const again = (key, button) => (touchOnly.matches ? `tap “${button}” to try again` : `press ${key} to try again`);

function pastDayNotice() {
  const forward = touchOnly.matches ? 'tap ›' : 'press ]';
  say(`${dayLabel(state.day, state.today)} is a past day — ${forward} to come back to today’s words`);
}

// A word that can still be swapped for another without losing anything.
function standsAlone(node) {
  return Boolean(node) && node.parent == null && !node.children.length && !node.readAt && !node.note;
}

// Space: another current word. A word standing on its own is swapped in
// place, so tapping space keeps changing it; once a word has grown branches
// or been read, the new word starts a tree of its own instead.
async function actRandom() {
  if (state.busy) return;
  if (syncToday()) return startNewDay();
  if (!onToday()) return pastDayNotice();
  const node = activeNode();
  const alone = standsAlone(node);
  const entry = await attempt(alone ? { replace: node.id } : { root: true }, drawWord, again('space', 'another'));
  if (!entry) return paint();
  commit((forest) =>
    alone ? replaceEntry(forest, node.id, colored(entry)) : void addRoot(forest, colored(entry)),
  );
}

// Midnight passed while the page was open on "today": the new day gets its
// own first word, and the tree that was on screen is now a day back.
async function startNewDay() {
  paint();
  await actRandom();
  if (state.message) return; // the first word could not be fetched; that matters more
  const { earlier } = neighbours(state.store, state.day, state.today);
  const back = touchOnly.matches ? '‹' : '[';
  say(earlier ? `a new day — the tree you had is one step back ( ${back} )` : 'a new day');
}

// Enter: branch to something the selected word's article leans on.
async function actGrow() {
  const node = activeNode();
  if (!node || state.busy) return;
  if (node.kind === 'note') {
    return say(`“${node.word}” is a note of your own — add a word under it instead`);
  }
  const entry = await attempt({ child: node.id }, () => topics.related(node, usedKeys(state.forest)));
  if (!entry) return paint();
  commit((forest) => void addChild(forest, node.id, colored(entry)));
}

// N: always start a separate tree, keeping the current word as it is.
async function actPlant() {
  if (state.busy) return;
  if (syncToday()) return startNewDay();
  if (!onToday()) return pastDayNotice();
  const entry = await attempt({ root: true }, drawWord, again('n', 'new tree'));
  if (!entry) return paint();
  commit((forest) => void addRoot(forest, colored(entry)));
}

// R: trade the word at the tip of a branch for a different thread of its
// parent, so the vine between them stays honest.
function canSwap(node) {
  return Boolean(node) && node.parent != null && !node.children.length && node.origin === 'thread';
}

async function actSwap() {
  const node = activeNode();
  if (!canSwap(node) || state.busy) return;
  const entry = await attempt({ replace: node.id }, () =>
    topics.related(parentOf(node), usedKeys(state.forest)),
  );
  if (!entry) return paint();
  commit((forest) => replaceEntry(forest, node.id, colored(entry)));
}

// Puts text on the clipboard. Browsers only offer the clipboard API on
// secure pages that have focus; elsewhere the older selection-based copy
// still works.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch (err) {
    const holder = document.createElement('textarea');
    holder.className = 'probe';
    holder.value = text;
    holder.setAttribute('readonly', '');
    document.body.append(holder);
    holder.select();
    const copied = document.execCommand('copy');
    holder.remove();
    if (!copied) throw err;
  }
}

async function actCopy() {
  if (!countNodes(state.forest)) return;
  try {
    await copyText(toMarkdown(state.forest, { day: state.day, name: NAME }));
    say('copied as markdown');
  } catch (err) {
    say('couldn’t copy — your browser blocked clipboard access');
    reportError(err, { where: 'copy' });
  }
}

async function actClear() {
  if (state.busy || !onToday()) return;
  const entry = await attempt(null, drawWord);
  if (!entry) return paint();
  commit(() => {
    const fresh = createForest();
    addRoot(fresh, colored(entry));
    return fresh;
  });
}

// Choosing a lens changes what space brings next. A word that is still
// standing alone is swapped right away, so the choice shows.
function setLens(lens) {
  if (state.busy || !LENSES.includes(lens) || lens === state.store.lens) return;
  state.store.lens = lens;
  save();
  paint();
  const node = activeNode();
  if (onToday() && (!node || standsAlone(node))) actRandom();
}

// ---------- a word of your own ----------

function openPrompt(root) {
  if (state.busy || state.diving != null) return;
  const node = activeNode();
  state.prompting = { root: root || !node, under: node?.id ?? null };
  els.promptLabel.textContent = state.prompting.root ? 'a new tree, starting from' : `under “${node.word}”`;
  els.own.value = '';
  els.prompt.hidden = false;
  renderCaption();
  els.own.focus();
}

function closePrompt() {
  if (!state.prompting) return;
  state.prompting = null;
  els.prompt.hidden = true;
  els.own.blur();
  renderCaption();
}

// Adds what was typed, in your wording. If it names something Wikipedia has
// an article on, the word can branch and be read like any other; otherwise,
// or with no connection, it stays a plain note.
async function submitPrompt() {
  const asked = state.prompting;
  const text = [...els.own.value.replace(/\s+/g, ' ').trim()].slice(0, MAX_OWN).join('');
  closePrompt();
  if (!asked || !text) return;
  let unreachable = false;
  const entry = await attempt(asked.root ? { root: true } : { child: asked.under }, async () => {
    let match = null;
    if (looksLikeTopic(text)) {
      try {
        match = await topics.resolve(text);
      } catch (err) {
        if (!(err instanceof ServiceError)) throw err;
        unreachable = true;
        reportError(err, { where: 'resolve' });
      }
    }
    return match
      ? { word: text, kind: 'topic', title: match.title, desc: match.desc, origin: 'own' }
      : { word: text, kind: 'note', origin: 'own' };
  });
  if (!entry) return paint();
  commit((forest) =>
    void (asked.root ? addRoot(forest, colored(entry)) : addChild(forest, asked.under, colored(entry))),
  );
  if (unreachable) say('kept as a note — couldn’t look it up just now');
}

// ---------- the reading view ----------

const dive = createDive({
  root: els.dive,
  onClose: closeDive,
  onThread: pullThread,
  onNote: writeNote,
  onRetry: () => loadDive(state.diving),
});

function actDive() {
  const node = activeNode();
  if (!node || state.busy || state.prompting) return;
  state.diving = node.id;
  stage.rest(true);
  dive.open({
    word: node.word,
    title: node.kind === 'topic' ? node.title : null,
    what: whatLine(node),
    why: whyLine(node, parentOf(node)),
    note: node.note,
  });
  if (node.kind === 'topic') loadDive(node.id);
}

async function loadDive(id) {
  const node = state.forest.nodes[id];
  if (!node || state.diving !== id) return;
  dive.showLoading();
  try {
    const article = await topics.article(node.title);
    if (state.diving !== id) return; // closed, or another word opened, meanwhile
    dive.showArticle(article, (title) => usedKeys(state.forest).has(title.toLowerCase()));
    if (article.missing) return;
    node.desc ??= article.description;
    node.readAt ??= new Date().toISOString();
    save();
  } catch (err) {
    if (state.diving !== id) return;
    dive.showError(explain(err, 'try again'));
    reportError(err, { where: 'dive' });
  }
}

// Adds a thread beneath the word being read, without leaving the page.
function pullThread(thread) {
  const reading = state.forest.nodes[state.diving];
  if (!reading || usedKeys(state.forest).has(thread.title.toLowerCase())) return false;
  const entry = {
    word: thread.word,
    title: thread.title,
    kind: 'topic',
    origin: 'thread',
    desc: thread.desc,
    why: thread.sentence,
  };
  commit((forest) => void addChild(forest, reading.id, colored(entry)), { keepActive: true });
  return true;
}

function writeNote(text) {
  const node = state.forest.nodes[state.diving];
  if (!node) return;
  node.note = text.slice(0, MAX_NOTE);
  clearTimeout(noteTimer);
  noteTimer = setTimeout(save, NOTE_SAVE_MS);
}

function flushNote() {
  if (state.diving == null) return;
  clearTimeout(noteTimer);
  save();
}

function closeDive() {
  if (state.diving == null) return;
  flushNote();
  state.diving = null;
  dive.close();
  paint();
}

// ---------- moving around ----------

// To the top of the selected word's tree, or down its first branches to the end.
function jump(node, direction) {
  let target = node;
  if (direction === 'top') {
    while (target.parent != null) target = state.forest.nodes[target.parent];
  } else {
    while (target.children.length) target = state.forest.nodes[target.children[0]];
  }
  return target !== node && select(target.id);
}

// Arrow keys follow the picture: up to the parent, down to a child, and
// sideways to whichever word sits nearest on that side.
function move(direction) {
  const node = activeNode();
  if (!node) return false;
  if (direction === 'top' || direction === 'bottom') return jump(node, direction);
  if (direction === 'up') return node.parent != null && select(node.parent);
  if (direction === 'down') {
    return node.children.length > 0 && select(node.children[Math.floor((node.children.length - 1) / 2)]);
  }
  const target = stage.beside(state.forest, node.id, direction);
  return target != null ? select(target) : false;
}

// ---------- drawing ----------

// The two quiet lines under the tree: what the selected word is, and why it
// is here. A message, when there is one, takes their place for a moment.
function renderCaption() {
  const asking = state.prompting != null;
  els.what.hidden = asking;
  els.why.hidden = asking;
  if (asking) return;
  const node = activeNode();
  if (state.message || !node) {
    els.what.textContent = '';
    els.why.textContent = state.message ?? '';
    return;
  }
  els.what.textContent = clip(whatLine(node), WHAT_CLIP);
  const why = whyLine(node, parentOf(node));
  const firstNoteLine = node.note.trim().split('\n')[0];
  const text = why.text || (firstNoteLine ? `note: ${firstNoteLine}` : '');
  els.why.textContent = clip(text, WHY_CLIP);
  if (why.link && isWebUrl(why.link.url)) {
    const source = document.createElement('a');
    source.href = why.link.url;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    source.textContent = `(${why.link.name})`;
    els.why.append(' ', source);
  }
}

function renderChrome(node) {
  const past = !onToday();
  const grown = countNodes(state.forest) > 1;
  for (const button of [els.another, els.grow, els.read, els.add, els.plant, els.swap]) {
    button.disabled = state.busy;
  }
  els.grow.disabled ||= !node;
  els.read.disabled ||= !node;
  els.another.hidden = past;
  els.plant.hidden = past;
  els.clear.hidden = past || !grown;
  els.swap.hidden = !canSwap(node);
  els.undo.hidden = !state.history.length;
  els.copy.hidden = !worthKeeping(state.forest);
  for (const button of els.lenses) {
    button.setAttribute('aria-pressed', String(button.dataset.lens === state.store.lens));
  }
  document.body.classList.toggle('past', past);

  // The day control stays out of sight until there is another day to go to.
  const { earlier, later } = neighbours(state.store, state.day, state.today);
  els.days.hidden = visitableDays(state.store, state.today, state.day).length < 2;
  els.day.textContent = dayLabel(state.day, state.today);
  els.earlier.classList.toggle('off', !earlier);
  els.later.classList.toggle('off', !later);
  els.earlier.disabled = !earlier;
  els.later.disabled = !later;
}

function paint() {
  const { forest, ghostId } = withGhost(state.forest, state.ghost);
  const fresh = state.freshId;
  state.freshId = null;

  const node = activeNode();
  const ground = node?.color ?? state.ground;
  if (ground) {
    const root = document.documentElement.style;
    root.setProperty('--bg', toCss(ground));
    root.setProperty('--ink', inkFor(ground));
    state.lastHue = ground.h;
  }

  renderChrome(node);
  renderCaption();
  stage.rest(state.diving != null);
  stage.draw({ forest, ghostId, selected: state.forest.active, fresh });
}

// ---------- wiring ----------

function onClick(element, handler) {
  element.addEventListener('click', (event) => {
    // After a mouse or touch press, hand the keyboard back to the page so
    // space and enter keep meaning "another" and "branch".
    if (event.detail > 0) element.blur();
    handler(event);
  });
}

const isTyping = (target) =>
  target instanceof Element && Boolean(target.closest('input, textarea, [contenteditable]'));

function onKey(event) {
  // The reading view owns the keyboard while it is open: escape (or d, when
  // not typing a note) goes back to the tree, and the rest is for reading.
  if (state.diving != null) {
    const leave = event.key === 'Escape' || (event.key === 'd' && !isTyping(event.target));
    if (leave && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      closeDive();
    }
    return;
  }
  if (isTyping(event.target)) return; // the line for your own word handles its keys
  if (event.metaKey || event.ctrlKey) {
    if (event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      undo();
    }
    return;
  }
  if (event.altKey) return;
  // Space and enter belong to whichever button has keyboard focus, except the
  // already-selected word: there they act on that word like anywhere else.
  const onButton =
    event.target instanceof Element &&
    event.target.closest('button:not(.word[aria-current="true"]), a');
  const actions = {
    ' ': () => !onButton && actRandom(),
    Enter: () => !onButton && actGrow(),
    n: actPlant,
    r: actSwap,
    d: actDive,
    a: () => openPrompt(false),
    A: () => openPrompt(true),
    c: actCopy,
    z: undo,
    Backspace: undo,
    '[': () => stepDay(-1),
    ']': () => stepDay(1),
    ArrowLeft: () => move('left') !== false,
    ArrowRight: () => move('right') !== false,
    ArrowUp: () => move('up') !== false,
    ArrowDown: () => move('down') !== false,
    // For vim hands: the same actions under the keys they already know.
    h: () => move('left') !== false,
    j: () => move('down') !== false,
    k: () => move('up') !== false,
    l: () => move('right') !== false,
    o: actGrow, // open a line below
    u: undo,
    y: actCopy, // yank
    K: actDive, // look up the word under the cursor
    G: () => move('bottom') !== false,
    g: () => {
      const again = event.timeStamp - lastG < 600; // gg
      lastG = again ? -Infinity : event.timeStamp;
      return again && move('top') !== false;
    },
  };
  // Shifted letters are their own keys (A, K, G). Shift decides, not the
  // letter's case, so caps lock does not turn every `a` into a new tree.
  let key = event.key;
  if (key.length === 1) {
    const shifted = key.toUpperCase();
    key = event.shiftKey && actions[shifted] ? shifted : key.toLowerCase();
  }
  const action = actions[key];
  if (!action) return;
  if (action() !== false) event.preventDefault();
}

function wire() {
  onClick(els.another, actRandom);
  onClick(els.grow, actGrow);
  onClick(els.read, actDive);
  onClick(els.add, () => openPrompt(false));
  onClick(els.plant, actPlant);
  onClick(els.swap, actSwap);
  onClick(els.undo, undo);
  onClick(els.copy, actCopy);
  onClick(els.clear, actClear);
  onClick(els.earlier, () => stepDay(-1));
  onClick(els.later, () => stepDay(1));
  for (const button of els.lenses) onClick(button, () => setLens(button.dataset.lens));

  els.tree.addEventListener('click', (event) => {
    const word = event.target instanceof Element && event.target.closest('.word');
    if (!word) return;
    // Same hand-back as onClick: a pressed word must not keep keyboard focus,
    // or enter would re-select it instead of continuing from it.
    if (event.detail > 0) word.blur();
    select(Number(word.dataset.id));
  });

  els.own.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitPrompt();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closePrompt();
    }
  });
  els.own.addEventListener('blur', closePrompt);

  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', paint);
  // Back online with an empty page: fetch the word that could not be fetched.
  window.addEventListener('online', () => {
    if (onToday() && !countNodes(state.forest)) actRandom();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') return flushNote();
    if (syncToday()) startNewDay();
  });
  window.addEventListener('pagehide', flushNote);
}

async function start() {
  installGlobalHandlers(window);
  const damaged = load();
  state.forest = state.store.days[state.today]?.forest ?? createForest();
  wire();
  paint();
  if (!countNodes(state.forest)) await actRandom();
  // With a tree already on the page, fetch today's words quietly so the
  // first press of space does not have to wait. A failure here is not
  // news yet: asking for a word will say so if it matters.
  else pool.load().catch((err) => reportError(err, { where: 'preload' }));
  if (damaged && !state.message) say('some saved days were damaged and could not be opened');
}

start().catch((err) => {
  reportError(err, { where: 'start' });
  say('something went wrong while starting — reload to try again', { hold: true });
});
