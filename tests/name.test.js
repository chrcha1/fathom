import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { NAME, TAGLINE, STORAGE_KEY } from '../src/config.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const html = read('index.html');

test('the name is set in src/config.js and the two static copies agree with it', () => {
  assert.equal(/<title>([^<]*)<\/title>/.exec(html)[1], NAME);
  assert.equal(/<meta name="description" content="([^"]*)">/.exec(html)[1], TAGLINE);
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.name, NAME);
  assert.equal(pkg.description, TAGLINE);
  assert.ok(STORAGE_KEY.startsWith(`${NAME}:`));
});

const sources = ['src/', 'src/services/'].flatMap((dir) =>
  readdirSync(new URL(dir, root))
    .filter((file) => file.endsWith('.js'))
    .map((file) => dir + file),
);

test('no other source file spells the name out', () => {
  for (const path of sources.filter((path) => path !== 'src/config.js')) {
    assert.ok(!read(path).toLowerCase().includes(NAME), `${path} should read the name from config.js`);
  }
});

test('the site is self-contained: every import stays inside this folder', () => {
  // `import … from '…'` on one line, or the closing `} from '…'` of a longer one.
  const imports = /^(?:import\b[^'"]*|\}\s*from\s*)['"]([^'"]+)['"];?$/gm;
  assert.doesNotMatch(sources.map(read).join('\n'), /\bimport\s*\(/, 'no dynamic imports to account for');
  for (const path of sources) {
    const depth = path.split('/').length - 2; // folders below src/
    const found = [...read(path).matchAll(imports)];
    if (path === 'src/app.js') assert.ok(found.length > 10, 'the import pattern still matches');
    for (const [, target] of found) {
      assert.ok(target.startsWith('./') || target.startsWith('../'), `${path} imports ${target}`);
      const ups = target.split('/').filter((part) => part === '..').length;
      assert.ok(ups <= depth, `${path} reaches outside src/ with ${target}`);
    }
  }
  assert.doesNotMatch(html, /(?:src|href)="(?:\.\.\/|\/|https?:)/, 'index.html loads only its own files');
});

test('the page may only talk to Wikipedia, and runs no inline code', () => {
  const policy = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)[1];
  const directive = (name) => policy.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `));
  assert.equal(directive('connect-src'), 'connect-src https://en.wikipedia.org');
  assert.equal(directive('script-src'), "script-src 'self'");
  assert.equal(directive('style-src'), "style-src 'self'");
  assert.equal(directive('default-src'), "default-src 'self'");
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>|\son\w+=|style="/i, 'no inline scripts, handlers or styles');
  // Every address the code builds for fetching is on the allowed host.
  const fetched = read('src/services/wikipedia.js').match(/https:\/\/[a-z.]+/g);
  assert.deepEqual([...new Set(fetched)], ['https://en.wikipedia.org']);
});

test('nothing is ever written into the page as HTML', () => {
  for (const path of sources) {
    assert.doesNotMatch(read(path), /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, path);
  }
});
