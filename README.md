# fathom

One current word on a random colour. Go as deep as you like.

I built this to stay in touch with what is happening: it hands me a word that is in the news or being read about right now, tells me in one line why, and lets me branch out from it into the things I need to know to understand it. It is the sibling of tangent (one random word, branch from there) and looks the same: monospace words, a plain background, branches drawn as shaded ASCII vines.

## How it works

- **another** (`space`) gives another current word. A word standing on its own is swapped in place; once it has branches or has been read, the new word starts a tree of its own.
- **branch** (`enter`) grows a word beneath the selected one: something its Wikipedia article leans on in its opening paragraphs. The line under the tree quotes the sentence that connects the two.
- **dive** (`d`) opens a plain reading view: what the word is, why it is current (with the source), the article's opening, a few questions to chase, threads to pull, a notes box, and links out. Clicking a thread adds it to the tree without leaving the page. `esc` goes back.
- **add** (`a`) adds a word of my own under the selected one; `A` starts a new tree with it. If Wikipedia has an article for it, it can branch and be read like any other word; otherwise it stays a plain note. Questions and long sentences are always kept as notes.
- **new tree** (`n`) starts a separate tree and keeps the current word as it is.
- Click any word to select it. Under the tree, two quiet lines say what the selected word is and why it is there.

**Lenses** along the top choose what `space` brings: `anything · news · people · tech · culture`.

**Why now.** Every current word carries its reason: the one-sentence event report with its source, or its rank among yesterday's most-read articles.

**Progress shows in the art.** A vine is bare until its word has been read in the reading view; then it carries small blooms (`. ' * o @`) and the word gets a `*`. The path from the top of the tree to the selected word is drawn strongest.

**A journal by day.** Each calendar day has its own canvas. Today opens on a fresh word (or on today's tree, if there is one). Earlier days stay reachable with the `‹ nov 10 ›` control or `[` and `]`; they can still be read, branched and annotated, but new current words only arrive on today. A day is kept once something was done with it: a branch, a read, or a note.

**Copy** (`c`) puts the day on the clipboard as Markdown: a nested list of the words with their descriptions and links, why each was current, and my notes.

Other keys: `r` swap the word at the tip of a branch for another thread of its parent · `z` or `backspace` undo · arrow keys move around the tree.

For vim hands, the same actions also answer to: `h` `j` `k` `l` to move · `o` branch below · `u` undo · `y` copy · `K` dive · `gg` top of the tree · `G` down to the end of its first branch.

With "reduce motion" turned on in the system settings, the vines hold still.

## Run

No build step and no dependencies. Serve the folder with any static file server:

```bash
npm start
```

Then open http://localhost:4180. (Opening `index.html` straight from disk will not work: browsers refuse to load JavaScript modules from `file://`.)

## Test

```bash
npm test
```

Uses Node's built-in test runner (Node 20+). The tests run the current-events parser and the word pool against real pages saved in `tests/fixtures/`, and cover the lenses, thread ranking, the Markdown export, the layout and the art, saved-data validation, and the failure paths: no connection, timeouts, "too many requests", one source missing while others work, malformed responses, an article with no usable links, storage that is full or holds damaged data.

## Deploy

Live at https://chrcha1.github.io/fathom/ (GitHub Pages).

Deploys come from the pipeline, not from a laptop: every push to `main` runs the tests and, if they pass, publishes `index.html`, `styles.css`, `src/` (see `.github/workflows/deploy.yml`). A failing test stops the deploy. To publish by hand, run the "Test and deploy" workflow from the repository's Actions tab.

The site is static, with nothing to configure and no secrets, so it can move to any other static host by publishing the same files.

## Where the words come from

Everything comes from English Wikipedia's public APIs. They are free and need no key, and the page's Content-Security-Policy allows connections to `en.wikipedia.org` and nowhere else.

| What | Source |
| --- | --- |
| Reported events, with categories and sources | The wikitext of `Portal:Current events` for today and the two days before (today's page is often still empty) |
| In the news | The front-page feed (`/api/rest_v1/feed/featured`), today's `news` |
| Most read | The same feed, `mostread` from the latest day that has it |
| One-line descriptions | `action=query&prop=description`, fifty titles at a time |
| Branches and threads | Links in an article's opening section (`action=parse&prop=links&section=0`), ranked by where they appear in the opening text; similar articles as a fallback |
| The reading view | The opening text (`prop=extracts&exintro`) |
| Words of my own | Wikipedia's search, first result |

Which lens a word falls under is read from its description ("American politician (born 1971)", "2026 Indian film by …") and from the current-events category it sat in. Under "anything", ongoing stories and the names a report is about are drawn more often than its passing links, and places ("Germany") less often than the stories set in them.

To go easy on Wikipedia, at most two requests are in flight at once, a "too many requests" answer is retried after a pause, and the day's pool of words is kept in the browser for half an hour so a reload does not fetch it again.

## What is kept, and where

Everything stays in this browser's `localStorage`; nothing is sent anywhere.

- `fathom:v1` holds the journal: the chosen lens and one tree per day. Days are named by local calendar date; every timestamp inside (added, read, updated) is UTC.
- `fathom:v1:pool` holds the current words for half an hour.
- `fathom:v1:damaged` appears only if saved data could not be read: the unreadable original is set aside there before anything writes over it. Days that are intact still open.

If storage is full or blocked the page says so once and carries on for the visit.

## Layout

```
index.html, styles.css
src/
  config.js       the site's name, in one place
  app.js          page state, actions, keyboard and button wiring
  stage.js        the tree on screen: words, vines, the drawing loop
  dive.js         the reading view
  tree.js         the word tree and validation of saved trees
  journal.js      one canvas per day; reading saved data back
  pool.js         today's current words, from three sources that fail independently
  portal.js       parser for the current-events wikitext
  topics.js       an article's threads, branching, matching typed text
  classify.js     what kind of thing a topic is; the lenses
  questions.js    questions to chase, by kind
  lines.js        the "what" and "why" lines for a word
  export.js       the day as Markdown
  layout.js       where each word sits
  field.js        the shaded ASCII vines, curls and blooms
  text.js         titles, sentences, clipping, links
  color.js        random background + readable ink colour
  hash.js         stable per-word variety for the art
  report.js       the one place errors are reported
  services/       http (timeouts, error types, pacing), wikipedia
tests/
  fixtures/       real API responses the tests run against
```

Nothing in `src/` imports from outside this folder (a test checks), so the folder can be moved or published on its own.

**Renaming.** The name is set in `src/config.js`. The only other copies are the `<title>` in `index.html` and `name` in `package.json`; `npm test` fails if they disagree. Renaming also changes the storage key, so a renamed site starts with an empty journal.

## Not set up yet

- **Crash reporting.** Errors go to the browser console through `src/report.js`. Forward them from there once the site has a Sentry (or similar) project.
- **Backup.** The journal lives only in one browser. `copy` exports a day as Markdown; there is no export of the whole journal or sync between devices yet.
