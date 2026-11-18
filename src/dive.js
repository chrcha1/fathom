// The reading view: one topic as plain text over the page's colour. Title,
// what it is, why it is here, the article's opening, questions to chase,
// threads to pull, a notes box and links out. This module only draws; the
// page module decides what to fetch and what a click does.

import { questionsFor } from './questions.js';
import { subjectKind } from './classify.js';
import { wikiUrl, newsUrl, searchUrl, isWebUrl } from './text.js';

const THREADS_AT_A_TIME = 12;

function make(tag, props = {}, children = []) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (name === 'text') element.textContent = value;
    else if (name === 'className') element.className = value;
    else element.setAttribute(name, value);
  }
  element.append(...children);
  return element;
}

const outLink = (label, url) =>
  make('a', { text: label, href: url, target: '_blank', rel: 'noopener noreferrer' });

const section = (className, label, children = []) =>
  make('section', { className }, [make('h2', { className: 'label', text: label }), ...children]);

// `root` is the element the view lives in. `onThread(thread)` adds a thread
// to the tree and returns whether it did; `onNote(text)` hears every edit.
export function createDive({ root, onClose, onThread, onNote, onRetry }) {
  let parts = null;

  function close() {
    parts = null;
    root.hidden = true;
    root.replaceChildren();
  }

  // Opens on what is already known about the word; the article follows.
  // `model`: { word, title (null for a note), what, why: { label, text, link }, note }.
  function open(model) {
    const back = make('button', { className: 'back', type: 'button', title: 'Back to the tree (esc)' }, [
      '‹ back',
      make('kbd', { text: 'esc' }),
    ]);
    back.addEventListener('click', onClose);

    const what = make('p', { className: 'what', text: model.what });
    const reading = make('div', { className: 'reading' });
    const questions = section('questions', 'questions to chase');
    const threads = section('threads', 'threads to pull');
    questions.hidden = true;
    threads.hidden = true;

    const note = make('textarea', {
      id: 'note',
      'aria-label': 'Notes',
      rows: '5',
      maxlength: '4000',
      spellcheck: 'true',
      placeholder: 'what did you learn? what still makes no sense?',
    });
    note.value = model.note;
    note.addEventListener('input', () => onNote(note.value));

    const query = model.title ?? model.word;
    const elsewhere = [
      ...(model.title ? [outLink('wikipedia', wikiUrl(model.title)), ' · '] : []),
      outLink('news', newsUrl(query)),
      ' · ',
      outLink('search', searchUrl(query)),
    ];

    const why = [];
    if (model.why.text) {
      const line = make('p', { text: model.why.text });
      if (model.why.link && isWebUrl(model.why.link.url)) {
        line.append(' ', outLink(`(${model.why.link.name})`, model.why.link.url));
      }
      why.push(section('why', model.why.label, [line]));
    }

    root.replaceChildren(
      make('div', { className: 'page' }, [
        back,
        make('h1', { text: model.word }),
        what,
        ...why,
        reading,
        questions,
        threads,
        section('notes', 'notes', [note]),
        section('elsewhere', 'elsewhere', [make('p', {}, elsewhere)]),
      ]),
    );
    parts = { model, what, reading, questions, threads };
    root.hidden = false;
    root.scrollTop = 0;
    root.focus({ preventScroll: true });
  }

  function showLoading() {
    if (!parts) return;
    parts.reading.replaceChildren(make('p', { className: 'ghost', text: '...' }));
  }

  function showError(message) {
    if (!parts) return;
    const retry = make('button', { className: 'retry', type: 'button', text: 'try again' });
    retry.addEventListener('click', onRetry);
    parts.reading.replaceChildren(make('p', { role: 'status', text: message }), retry);
  }

  function threadButton(thread, onTree) {
    const mark = make('span', { className: 'mark', text: '+' });
    const button = make('button', { className: 'thread', type: 'button' }, [
      mark,
      make('span', { className: 'name', text: thread.word }),
      ...(thread.desc ? [make('span', { className: 'dim', text: thread.desc })] : []),
    ]);
    const settle = () => {
      mark.textContent = '·';
      button.disabled = true;
      button.title = 'On the tree';
    };
    if (onTree(thread.title)) settle();
    else button.title = 'Add under this word';
    button.addEventListener('click', () => {
      if (onThread(thread)) settle();
    });
    return make('li', {}, [button]);
  }

  // `article`: { missing, description, extract, threads }. `onTree(title)`
  // says whether a thread is already on the tree.
  function showArticle(article, onTree) {
    if (!parts) return;
    const { model, what, reading, questions, threads } = parts;

    if (article.missing) {
      reading.replaceChildren(make('p', { text: 'wikipedia has no article under this name any more.' }));
      return;
    }
    if (!what.textContent && article.description) what.textContent = article.description;

    const paragraphs = article.extract.split(/\n+/).filter((paragraph) => paragraph.trim());
    reading.replaceChildren(
      ...(paragraphs.length
        ? paragraphs.map((paragraph) => make('p', { text: paragraph }))
        : [make('p', { text: 'this article has no opening text yet.' })]),
    );

    const kind = subjectKind({ description: article.description, title: model.title ?? '' });
    questions.append(
      make('ul', {}, questionsFor(kind).map((question) => make('li', { text: question }))),
    );
    questions.hidden = false;

    threads.hidden = false;
    if (!article.threads.length) {
      threads.append(make('p', { text: 'no threads lead out of this opening.' }));
      return;
    }
    const list = make('ul');
    const more = make('button', { className: 'more', type: 'button', text: 'more' });
    let shown = 0;
    const reveal = () => {
      const next = article.threads.slice(shown, shown + THREADS_AT_A_TIME);
      list.append(...next.map((thread) => threadButton(thread, onTree)));
      shown += next.length;
      more.hidden = shown >= article.threads.length;
    };
    more.addEventListener('click', reveal);
    threads.append(list, more);
    reveal();
  }

  return { open, close, showLoading, showError, showArticle };
}
