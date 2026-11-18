// The word tree: a forest of words hanging from the ones they came from.
//
// A word is a `topic` (it has a Wikipedia article, so it can branch and be
// read) or a `note` (plain text of your own). `origin` says how it got here:
// 'current' (drawn from today's events), 'thread' (pulled from its parent's
// article) or 'own' (typed by you). Timestamps are UTC ISO strings.

import { isWebUrl } from './text.js';

const KINDS = new Set(['topic', 'note']);
const ORIGINS = new Set(['current', 'thread', 'own']);

export function createForest() {
  return { nodes: {}, roots: [], active: null, nextId: 1 };
}

const content = (entry) => ({
  word: entry.word,
  kind: entry.kind,
  title: entry.title ?? null,
  origin: entry.origin ?? 'own',
  color: entry.color,
  desc: entry.desc ?? null,
  why: entry.why ?? null,
  link: entry.link ?? null,
  note: '',
  readAt: null,
  addedAt: entry.addedAt ?? null,
});

function insert(forest, entry, parent) {
  const id = forest.nextId++;
  forest.nodes[id] = { id, parent, children: [], ...content(entry) };
  forest.active = id;
  return id;
}

export function addRoot(forest, entry) {
  const id = insert(forest, entry, null);
  forest.roots.push(id);
  return id;
}

export function addChild(forest, parentId, entry) {
  const parent = forest.nodes[parentId];
  if (!parent) throw new Error(`No node ${parentId} to branch from`);
  const id = insert(forest, entry, parentId);
  parent.children.push(id);
  return id;
}

// Puts a different word in a node's place; its note and read mark belonged
// to the old word and go with it.
export function replaceEntry(forest, id, entry) {
  const node = forest.nodes[id];
  if (!node) throw new Error(`No node ${id} to replace`);
  Object.assign(node, content(entry));
  forest.active = id;
}

export function countNodes(forest) {
  return Object.keys(forest.nodes).length;
}

// What a word is, for telling repeats apart: its article, or its own text.
export const keyOf = (node) => (node.title ?? node.word).toLowerCase();

export function usedKeys(forest) {
  return new Set(Object.values(forest.nodes).map(keyOf));
}

// A canvas is worth a place in the journal once something was done with it:
// a branch grown, a word read, a note written.
export function worthKeeping(forest) {
  const nodes = Object.values(forest.nodes);
  return nodes.length > 1 || nodes.some((node) => node.readAt || node.note);
}

// After an undo, reading and notes done since are kept: they are not part of
// the tree's shape, and losing them to an undo would be a surprise.
export function carryOver(restored, current) {
  for (const node of Object.values(restored.nodes)) {
    const now = current.nodes[node.id];
    if (!now || keyOf(now) !== keyOf(node)) continue;
    node.note = now.note;
    node.readAt = now.readAt;
    node.desc ??= now.desc;
  }
  return restored;
}

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isText = (v) => typeof v === 'string';
const isTextOrNull = (v) => v == null || isText(v);
const isTimeOrNull = (v) => v == null || (isText(v) && !Number.isNaN(Date.parse(v)));

function isValidNode(node, key, nodes) {
  if (!node || typeof node !== 'object') return false;
  if (String(node.id) !== key) return false;
  if (!isText(node.word) || !node.word.trim()) return false;
  if (!KINDS.has(node.kind) || !ORIGINS.has(node.origin)) return false;
  if (!isTextOrNull(node.title) || (node.kind === 'topic' && !node.title)) return false;
  if (!isTextOrNull(node.desc) || !isTextOrNull(node.why) || !isText(node.note)) return false;
  if (!isTimeOrNull(node.readAt) || !isTimeOrNull(node.addedAt)) return false;
  if (node.link != null && !(isWebUrl(node.link.url) && isText(node.link.name))) return false;
  const c = node.color;
  if (!c || !isNumber(c.l) || !isNumber(c.c) || !isNumber(c.h)) return false;
  if (!Array.isArray(node.children)) return false;
  if (node.parent != null && !nodes[node.parent]?.children?.includes(node.id)) return false;
  return node.children.every((kid) => nodes[kid]?.parent === node.id);
}

// Guards anything read back from storage: a half-written or hand-edited tree
// is discarded rather than rendered.
export function isValidForest(forest) {
  if (!forest || typeof forest !== 'object') return false;
  const { nodes, roots, active, nextId } = forest;
  if (!nodes || typeof nodes !== 'object' || !Array.isArray(roots) || !roots.length) return false;
  const keys = Object.keys(nodes);
  if (!keys.every((key) => isValidNode(nodes[key], key, nodes))) return false;
  if (!roots.every((id) => nodes[id] && nodes[id].parent == null)) return false;
  const rootless = keys.filter((key) => nodes[key].parent == null).length;
  if (rootless !== roots.length || new Set(roots).size !== roots.length) return false;
  if (!nodes[active]) return false;
  return isNumber(nextId) && keys.every((key) => Number(key) < nextId);
}
