// The site's name lives here. Everything in src/ reads it from this file; the
// only other copies are the <title> in index.html and "name" in package.json
// (tests/name.test.js fails if they drift apart).

export const NAME = 'fathom';
export const TAGLINE = 'One current word. Go as deep as you like.';
export const STORAGE_KEY = `${NAME}:v1`;
