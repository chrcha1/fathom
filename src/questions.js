// Questions to chase while reading, chosen by what kind of thing the topic
// is. They are prompts for the notes box, not a quiz. Pure.

const QUESTIONS = {
  person: [
    'What were they doing before this moment, and what got them here?',
    'Who backs them, and who opposes them?',
    'What do they say they want to do next?',
    'What is the strongest criticism of them, and is it fair?',
  ],
  event: [
    'What happened, in one sentence, and what is still unknown?',
    'What led up to it? Which earlier event does it echo?',
    'Who gains and who loses from it?',
    'What would have to happen next for this to still matter in a year?',
  ],
  technology: [
    'What problem does it solve, and what did people use before?',
    'How does it work, in words I could say to a friend?',
    'Who makes it or controls it?',
    'What are its limits, and what worries people about it?',
  ],
  work: [
    'Who made it, and what else have they made?',
    'Why is it getting attention right now?',
    'What is it in conversation with: a source, a genre, an earlier work?',
    'What do its fans and its critics each see in it?',
  ],
  place: [
    'Where is it, and who lives there?',
    'Who governs it, and is that contested?',
    'What is it usually known for, and what is it in the news for now?',
    'Which neighbours and which history shape it?',
  ],
  organisation: [
    'What does it do, and who pays for it?',
    'Who runs it, and who does it answer to?',
    'Why is it in the news now?',
    'Who are its rivals or critics?',
  ],
  idea: [
    'How would I explain it in two sentences?',
    'Where did it come from?',
    'Where does it show up in everyday life?',
    'What do people most often get wrong about it?',
  ],
};

export const KINDS = Object.keys(QUESTIONS);

export function questionsFor(kind) {
  return QUESTIONS[kind] ?? QUESTIONS.idea;
}
