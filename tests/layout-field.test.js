import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createForest, addRoot, addChild } from '../src/tree.js';
import { place, ROW_EM } from '../src/layout.js';
import { renderField, GLYPHS } from '../src/field.js';

const CHAR = 0.6;
const entry = (word) => ({ word, title: word, kind: 'topic', origin: 'thread', color: { l: 0.8, c: 0.1, h: 120 } });

// spec: [word, ...children]
function grow(forest, parent, [word, ...kids]) {
  const id = parent == null ? addRoot(forest, entry(word)) : addChild(forest, parent, entry(word));
  return { id, word, kids: kids.map((kid) => grow(forest, id, kid)) };
}

function forestOf(...trees) {
  const forest = createForest();
  const built = trees.map((tree) => grow(forest, null, tree));
  return { forest, built };
}

const near = (a, b) => Math.abs(a - b) < 1e-9;

// ---------- layout ----------

test('a lone word sits at the origin and is the whole scene', () => {
  const { forest, built } = forestOf(['ocean']);
  const { spots, width, height } = place(forest, CHAR);
  assert.deepEqual(spots.get(built[0].id), { x: 0, y: 0, width: 3, centre: 1.5 });
  assert.ok(near(width, 3));
  assert.ok(near(height, ROW_EM));
});

test('a chain hangs straight down', () => {
  const { forest, built } = forestOf(['ocean', ['tide', ['moon']]]);
  const { spots } = place(forest, CHAR);
  const [ocean] = built;
  const tide = ocean.kids[0];
  const moon = tide.kids[0];
  const centres = [ocean, tide, moon].map((n) => spots.get(n.id).centre);
  assert.ok(near(centres[0], centres[1]) && near(centres[1], centres[2]));
  assert.ok(spots.get(tide.id).y > spots.get(ocean.id).y + ROW_EM);
  assert.ok(near(spots.get(moon.id).y - spots.get(tide.id).y, spots.get(tide.id).y));
});

test('children spread out in a row beneath a parent centred over them', () => {
  const { forest, built } = forestOf(['bubble', ['recession'], ['burst'], ['stocks']]);
  const { spots } = place(forest, CHAR);
  const [bubble] = built;
  const kids = bubble.kids.map((kid) => spots.get(kid.id));
  assert.ok(kids.every((kid) => near(kid.y, kids[0].y)));
  for (let i = 1; i < kids.length; i++) {
    assert.ok(kids[i].x >= kids[i - 1].x + kids[i - 1].width + 3 * CHAR - 1e-9, 'siblings keep their gap');
  }
  assert.ok(near(spots.get(bubble.id).centre, (kids[0].centre + kids[2].centre) / 2));
});

test('a narrow child is centred under a wide parent', () => {
  const { forest, built } = forestOf(['bioluminescence', ['sea']]);
  const { spots } = place(forest, CHAR);
  assert.ok(near(spots.get(built[0].id).centre, spots.get(built[0].kids[0].id).centre));
  assert.equal(spots.get(built[0].id).x, 0);
});

test('a wider fan gets a longer drop, within limits', () => {
  const narrow = forestOf(['a', ['b'], ['c']]);
  const wide = forestOf(['a', ['bbbbbbbbbbbbbbbbbbbb'], ['cccccccccccccccccccc'], ['dddddddddddddddddddd']]);
  const huge = forestOf(['a', ...Array.from({ length: 30 }, (_, i) => [`word${i}`])]);
  const dropOf = ({ forest, built }) => place(forest, CHAR).spots.get(built[0].kids[0].id).y;
  assert.ok(dropOf(wide) > dropOf(narrow));
  assert.equal(dropOf(huge), 10);
});

test('separate trees stand side by side along the top', () => {
  const { forest, built } = forestOf(['ocean', ['tide'], ['harbor']], ['rumor']);
  const { spots, width } = place(forest, CHAR);
  const rumor = spots.get(built[1].id);
  const harbor = spots.get(built[0].kids[1].id);
  assert.equal(rumor.y, 0);
  assert.ok(rumor.x >= harbor.x + harbor.width + 6 * CHAR - 1e-9);
  assert.ok(near(width, rumor.x + rumor.width));
});

test('no two words ever overlap, whatever the shape of the forest', () => {
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let round = 0; round < 40; round++) {
    const forest = createForest();
    const ids = [];
    for (let i = 0; i < 25; i++) {
      const word = 'x'.repeat(1 + Math.floor(random() * 14));
      const parent = ids.length && random() < 0.85 ? ids[Math.floor(random() * ids.length)] : null;
      ids.push(parent == null ? addRoot(forest, entry(word)) : addChild(forest, parent, entry(word)));
    }
    const boxes = [...place(forest, CHAR).spots.values()];
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const apartX = boxes[a].x + boxes[a].width <= boxes[b].x + 1e-9 || boxes[b].x + boxes[b].width <= boxes[a].x + 1e-9;
        const apartY = Math.abs(boxes[a].y - boxes[b].y) >= ROW_EM - 1e-9;
        assert.ok(apartX || apartY, `round ${round}: words ${a} and ${b} collide`);
      }
    }
  }
});

// ---------- shaded field ----------

const grid = { cols: 40, rows: 30, cellW: 5, cellH: 10, em: 24 };
const hanging = (overrides = {}) => ({
  id: 2,
  from: { x: 100, y: 20 },
  to: { x: 100, y: 280 },
  strength: 1,
  grown: 1,
  depth: 1,
  tip: false,
  read: false,
  ...overrides,
});
const inked = (layer) => [...layer].filter((ch) => ch !== ' ' && ch !== '\n').length;
const inkedRows = (layer, from, to) => inked(layer.split('\n').slice(from, to).join(''));
const draw = (branch, time) => renderField({ ...grid, branches: [branch], time });

test('with nothing to draw, every layer is a blank grid of the right size', () => {
  const layers = renderField({ ...grid, branches: [] });
  assert.equal(layers.length, 3);
  for (const layer of layers) {
    const lines = layer.split('\n');
    assert.equal(lines.length, grid.rows);
    assert.ok(lines.every((line) => line === ' '.repeat(grid.cols)));
  }
});

test('a vine is drawn from the shading and bloom glyphs, and each cell belongs to one grey only', () => {
  const layers = draw(hanging({ tip: true, read: true }));
  assert.ok(layers.every((layer) => inked(layer) > 0));
  for (const layer of layers) {
    for (const ch of layer) assert.ok(ch === '\n' || ch === ' ' || GLYPHS.includes(ch), `unexpected glyph ${ch}`);
  }
  for (let i = 0; i < layers[0].length; i++) {
    const claims = layers.filter((layer) => layer[i] !== ' ' && layer[i] !== '\n').length;
    assert.ok(claims <= 1);
  }
});

test('a vine tapers: its dense heart is near the parent, not the child', () => {
  const [, , strong] = draw(hanging());
  assert.ok(inkedRows(strong, 2, 10) > inkedRows(strong, 20, 28) * 2);
});

test('vines start out slimmer the further down the tree they are', () => {
  const heart = (depth) => inked(draw(hanging({ depth }))[2]);
  assert.ok(heart(1) > heart(4));
});

test('a vine that has not started growing is invisible, and a young one stops short', () => {
  assert.ok(draw(hanging({ grown: 0 })).every((layer) => inked(layer) === 0));
  const young = draw(hanging({ grown: 0.3 }));
  assert.ok(young.some((layer) => inked(layer) > 0));
  assert.ok(young.every((layer) => inkedRows(layer, 18, 30) === 0));
});

test('a quieter vine never reaches the strongest grey', () => {
  const [, , strong] = draw(hanging({ strength: 0.5, tip: true, read: true }));
  assert.equal(inked(strong), 0);
});

const total = (branch, time) => draw(branch, time).reduce((sum, layer) => sum + inked(layer), 0);
const petalsOverTime = (branch) => [0, 800, 1600, 2400].map((time) => draw(branch, time).join('')).join('');

test('a vine stays bare until its word has been read, then it blooms', () => {
  // Petals have glyphs of their own ( ' o ) that the vine's shading never uses.
  assert.doesNotMatch(petalsOverTime(hanging({ read: false })), /['o]/);
  assert.doesNotMatch(petalsOverTime(hanging({ read: false, tip: true })), /['o]/, 'not even at the tip');
  assert.match(petalsOverTime(hanging({ read: true })), /['o]/);
  assert.ok(total(hanging({ read: true })) > total(hanging({ read: false })));
  // Every read vine blooms, whatever its id happens to hash to.
  for (let id = 1; id <= 40; id++) {
    assert.ok(total(hanging({ id, read: true })) > total(hanging({ id, read: false })), `vine ${id}`);
  }
});

test('a read vine at the tip of the tree carries more blooms than one leading on', () => {
  assert.ok(total(hanging({ read: true, tip: true })) > total(hanging({ read: true, tip: false })));
});

test('the same moment always draws the same picture, and the picture moves over time', () => {
  const at = (time) => draw(hanging(), time).join('|');
  assert.equal(at(1000), at(1000));
  assert.notEqual(at(1000), at(1900));
});

test('vines that run off the grid are clipped, not crashed on', () => {
  const stray = hanging({ from: { x: -200, y: -50 }, to: { x: 900, y: 700 } });
  const layers = draw(stray);
  assert.ok(layers.every((layer) => layer.split('\n').every((line) => line.length === grid.cols)));
});
