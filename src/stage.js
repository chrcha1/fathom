// The tree on screen: words placed in the page, the shaded vines behind
// them, and the loop that keeps the vines moving. It draws whatever forest it
// is handed and holds no opinion about what the words mean.

import { addRoot, addChild, countNodes } from './tree.js';
import { place, ROW_EM } from './layout.js';
import { renderField } from './field.js';

const MIN_SIZE = 13;
const MAX_SIZE = 160;
const STAGE_PADDING = 24; // keep in step with #stage in styles.css
const MARGIN_EM = 1.5; // room around a grown tree for its tendrils to sway
const LEAVE_EM = 0.3; // gap between a word and the tendril hanging from it
const ARRIVE_EM = 0.3; // gap between a tendril's tip and the word below
const ART_SCALE = 0.34; // size of the art's characters relative to the words
const ART_MIN = 6;
const ART_MAX = 12;
const MAX_CELLS = 60000; // beyond this the art's characters are made larger
const GROW_MS = 560; // time for a new tendril to reach its word
const FRAME_MS = 70; // the art redraws about fourteen times a second
const GHOST_WORD = '...';
const SCRAMBLE_GLYPHS = ".:-=+*#%@'o"; // a new word settles out of vine and bloom

// The forest as it should look while a word is on its way: a copy with a
// placeholder where the word will land. `ghost` is { root: true },
// { child: parentId } or { replace: nodeId }, or null for no placeholder.
export function withGhost(forest, ghost) {
  if (!ghost) return { forest, ghostId: null };
  const copy = structuredClone(forest);
  if (ghost.replace != null) {
    copy.nodes[ghost.replace].word = GHOST_WORD;
    return { forest: copy, ghostId: ghost.replace };
  }
  const active = copy.active;
  const placeholder = { word: GHOST_WORD, kind: 'note' };
  const ghostId = ghost.root ? addRoot(copy, placeholder) : addChild(copy, ghost.child, placeholder);
  copy.active = active;
  return { forest: copy, ghostId };
}

// `els`: { stage, world, tree, fields } from the page. `reducedMotion` is the
// media query for "reduce motion".
export function createStage({ els, reducedMotion }) {
  let charRatio = 0.6;
  let field = null; // what the art loop is drawing: grid size, cell size, branches
  let fieldLoop = 0;
  let lastFrame = 0;
  let resting = false; // true while something covers the tree
  const births = new Map(); // word id -> when its tendril started growing
  const cellSizes = new Map(); // art font size -> measured character cell

  function measureCharacter() {
    const probe = document.createElement('span');
    probe.className = 'probe';
    probe.textContent = '0'.repeat(20);
    document.body.append(probe);
    const ratio = probe.getBoundingClientRect().width / 20 / 100;
    probe.remove();
    if (ratio > 0.3 && ratio < 1) charRatio = ratio;
  }

  // Everything needed to draw a forest, in ems: where each word goes and
  // which tendrils join them.
  function buildScene(forest, ghostId) {
    const placed = place(forest, charRatio);
    const margin = countNodes(forest) > 1 ? MARGIN_EM : 0;
    const lineage = new Set(); // the selected word and its ancestors
    for (let id = forest.active; id != null; id = forest.nodes[id]?.parent) lineage.add(id);

    const depthOf = (id) => {
      let depth = 0;
      for (let up = forest.nodes[id].parent; up != null; up = forest.nodes[up].parent) depth += 1;
      return depth;
    };

    const links = [];
    for (const node of Object.values(forest.nodes)) {
      if (node.parent == null) continue;
      const above = placed.spots.get(node.parent);
      const below = placed.spots.get(node.id);
      links.push({
        id: node.id,
        depth: depthOf(node.id),
        tip: node.children.length === 0,
        read: Boolean(node.readAt), // a vine blooms once its word has been read
        from: { x: margin + above.centre, y: margin + above.y + ROW_EM + LEAVE_EM },
        to: { x: margin + below.centre, y: margin + below.y - ARRIVE_EM },
        strength: node.id === ghostId ? 0.4 : lineage.has(node.id) ? 1 : 0.72,
      });
    }
    return {
      spots: placed.spots,
      margin,
      lineage,
      links,
      width: placed.width + margin * 2,
      height: placed.height + margin * 2,
    };
  }

  function wordElement(node, spot, scene, selectedId, ghostId) {
    const isGhost = node.id === ghostId;
    const element = document.createElement(isGhost ? 'span' : 'button');
    element.textContent = node.word;
    element.style.left = `${(scene.margin + spot.x).toFixed(3)}em`;
    element.style.top = `${(scene.margin + spot.y).toFixed(3)}em`;
    if (isGhost) {
      element.className = 'ghost';
      return element;
    }
    const selected = node.id === selectedId;
    element.type = 'button';
    element.className = 'word';
    element.classList.toggle('kin', scene.lineage.has(node.id) && !selected);
    element.classList.toggle('read', Boolean(node.readAt));
    element.dataset.id = node.id;
    element.setAttribute('aria-label', node.readAt ? `${node.word}, read` : node.word);
    if (selected) element.setAttribute('aria-current', 'true');
    return element;
  }

  // A new word arrives as a flicker of branch glyphs that settles left to right.
  function scrambleIn(element, word, delayMs) {
    if (reducedMotion.matches) return;
    const letters = [...word];
    const duration = Math.min(420, 140 + letters.length * 26);
    const startAt = performance.now() + delayMs;
    const noise = () => SCRAMBLE_GLYPHS[Math.floor(Math.random() * SCRAMBLE_GLYPHS.length)];
    let lastTick = 0;
    if (delayMs > 0) element.textContent = ' '.repeat(letters.length);

    const frame = (now) => {
      if (!element.isConnected) return; // repainted since; nothing to finish
      const progress = (now - startAt) / duration;
      if (progress >= 1) {
        element.textContent = word;
        return;
      }
      if (progress >= 0 && now - lastTick > 36) {
        lastTick = now;
        const settled = Math.floor(progress * letters.length);
        element.textContent = letters
          .map((ch, i) => (i < settled || ch === ' ' ? ch : noise()))
          .join('');
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // The largest word size at which the whole scene fits the stage.
  function fit(scene) {
    const availableWidth = els.stage.clientWidth - STAGE_PADDING * 2;
    const availableHeight = els.stage.clientHeight - STAGE_PADDING * 2;
    const ceiling = Math.min(MAX_SIZE, window.innerWidth * 0.16);
    return Math.max(
      MIN_SIZE,
      Math.min(ceiling, availableWidth / scene.width, availableHeight / scene.height),
    );
  }

  // The real size of one art character at a given font size. Measured rather
  // than assumed, because browsers may enforce a minimum font size.
  function cellSize(fontSize) {
    if (!cellSizes.has(fontSize)) {
      const probe = document.createElement('span');
      probe.className = 'probe';
      probe.style.fontSize = `${fontSize}px`;
      probe.textContent = '0'.repeat(40);
      document.body.append(probe);
      const cellWidth = probe.getBoundingClientRect().width / 40;
      probe.remove();
      cellSizes.set(fontSize, { width: cellWidth, height: Math.round((cellWidth / charRatio) * 1.15) });
    }
    return cellSizes.get(fontSize);
  }

  // Sizes the character grid behind the words and converts the scene's
  // tendrils to pixels for it.
  function setUpField(scene, size) {
    if (!scene.links.length) {
      field = null;
      return;
    }
    const widthPx = scene.width * size;
    const heightPx = scene.height * size;
    let artSize = Math.round(Math.min(ART_MAX, Math.max(ART_MIN, size * ART_SCALE)));
    let cell = cellSize(artSize);
    while ((widthPx / cell.width) * (heightPx / cell.height) > MAX_CELLS && artSize < 16) {
      artSize += 1;
      cell = cellSize(artSize);
    }
    for (const layer of els.fields) {
      layer.style.fontSize = `${artSize}px`;
      layer.style.lineHeight = `${cell.height}px`;
    }
    const px = (point) => ({ x: point.x * size, y: point.y * size });
    field = {
      cols: Math.ceil(widthPx / cell.width),
      rows: Math.ceil(heightPx / cell.height),
      cellW: cell.width,
      cellH: cell.height,
      em: size,
      branches: scene.links.map((link) => ({ ...link, from: px(link.from), to: px(link.to) })),
    };
  }

  // Draws one frame of the art: tendrils at their current growth and sway.
  function drawField(now) {
    if (!field) {
      for (const layer of els.fields) layer.textContent = '';
      return;
    }
    const still = reducedMotion.matches;
    const branches = field.branches.map((branch) => {
      const age = (now - (births.get(branch.id) ?? -Infinity)) / GROW_MS;
      const grown = still || age >= 1 ? 1 : 1 - (1 - Math.max(0, age)) ** 3; // ease out
      return { ...branch, grown };
    });
    const layers = renderField({ ...field, branches, time: still ? 0 : now });
    layers.forEach((text, i) => {
      if (els.fields[i].textContent !== text) els.fields[i].textContent = text;
    });
  }

  function runField() {
    cancelAnimationFrame(fieldLoop);
    drawField(performance.now()); // right away, so the art never lags a repaint
    if (!field || reducedMotion.matches || resting) return;
    const tick = (now) => {
      fieldLoop = requestAnimationFrame(tick);
      if (now - lastFrame < FRAME_MS) return;
      lastFrame = now;
      drawField(now);
    };
    fieldLoop = requestAnimationFrame(tick);
  }

  // Draws `forest` (already carrying any placeholder, `ghostId`). `selected`
  // is the word that holds the cursor; `fresh` is a word that has just
  // arrived and should settle in, or null.
  function draw({ forest, ghostId = null, selected = null, fresh = null }) {
    const hadFocus = els.tree.contains(document.activeElement);
    const scene = buildScene(forest, ghostId);
    const now = performance.now();

    // A tendril starts growing when its word (or the placeholder for it)
    // first appears, and keeps its age while the placeholder becomes the
    // real word.
    for (const id of [...births.keys()]) if (!forest.nodes[id]) births.delete(id);
    for (const id of [fresh, ghostId]) {
      if (id != null && forest.nodes[id]?.parent != null && !births.has(id)) births.set(id, now);
    }

    const size = fit(scene);
    document.documentElement.style.setProperty('--size', `${size.toFixed(2)}px`);
    els.world.style.width = `${scene.width.toFixed(3)}em`;
    els.world.style.height = `${scene.height.toFixed(3)}em`;

    els.tree.replaceChildren(
      ...Object.values(forest.nodes).map((node) =>
        wordElement(node, scene.spots.get(node.id), scene, selected, ghostId),
      ),
    );
    els.tree.classList.toggle('solo', countNodes(forest) === 1);

    if (fresh != null && fresh !== ghostId && forest.nodes[fresh]) {
      const arrival = els.tree.querySelector(`.word[data-id="${fresh}"]`);
      const born = births.get(fresh);
      const wait = born == null ? 0 : Math.max(0, GROW_MS * 0.7 - (now - born));
      if (arrival) scrambleIn(arrival, forest.nodes[fresh].word, wait);
    }

    setUpField(scene, size);
    runField();

    const current = els.tree.querySelector('[aria-current="true"]');
    if (hadFocus) current?.focus();
    (els.tree.querySelector('.ghost') ?? current)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // Nothing moves while the reading view covers the tree.
  function rest(covered) {
    resting = covered;
    if (covered) cancelAnimationFrame(fieldLoop);
  }

  // The word nearest to `id` on one side ('left' or 'right'), as drawn.
  function beside(forest, id, direction) {
    const { spots } = place(forest, charRatio);
    const here = spots.get(id);
    const sign = direction === 'left' ? -1 : 1;
    let best = null;
    for (const [other, spot] of spots) {
      const across = (spot.centre - here.centre) * sign;
      if (other === id || across <= 0) continue;
      const score = across + Math.abs(spot.y - here.y) * 4;
      if (!best || score < best.score) best = { id: other, score };
    }
    return best?.id ?? null;
  }

  // A different day's tree starts with no vines mid-growth.
  const forget = () => births.clear();

  measureCharacter();
  return { draw, rest, beside, forget };
}
