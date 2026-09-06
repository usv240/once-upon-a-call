// Unit tests for the preview tour's narration sync.
//
// The boundary-event offset -> word-index mapping is the one piece of the preview that is easy
// to get subtly wrong (off-by-one at word starts, at the very end, on multiple spaces), and it
// is invisible when wrong: the highlight just drifts. So it lives in a pure function and is
// tested here rather than eyeballed in a headset.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// The static files are ES modules for the browser; load the one function under test without a
// bundler by evaluating the module source with its export stripped.
const src = fs.readFileSync(path.join(__dirname, '../static/StoryListener.js'), 'utf8');
const body = src.slice(src.indexOf('export function wordIndexAtChar')).replace('export function', 'function');
const wordIndexAtChar = new Function(`${body}; return wordIndexAtChar;`)();

const STORIES_DIR = path.join(__dirname, '../static/stories');
const stories = fs
  .readdirSync(STORIES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(STORIES_DIR, f), 'utf8')) }))
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
const story = stories[0]; // the default book, used for the word-sync cases below

// Scene names are looked up in Storybook.js's SCENES table; an unknown one silently falls back
// to the wrong backdrop, which is exactly the kind of thing nobody notices until it is filmed.
const bookSrc = fs.readFileSync(path.join(__dirname, '../static/Storybook.js'), 'utf8');
const SCENE_NAMES = (bookSrc.slice(bookSrc.indexOf('const SCENES = {')).split('};')[0].match(/^\s{2}(\w+):/gm) || [])
  .map((m) => m.trim().replace(':', ''));
const CHARACTERS = ['dragon', 'rabbit', 'boat'];

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}\n        ${e.message}`);
  }
}

const T = 'Once upon a time, in a cozy cave';

check('offset 0 is inside the first word', () => assert.strictEqual(wordIndexAtChar(T, 0), 1));
check('offset at the start of word 2 counts 2', () => assert.strictEqual(wordIndexAtChar(T, T.indexOf('upon')), 2));
check('offset on the space before word 2 counts 1', () => assert.strictEqual(wordIndexAtChar(T, T.indexOf('upon') - 1), 1));
check('offset mid-word does not advance', () => assert.strictEqual(wordIndexAtChar(T, T.indexOf('upon') + 2), 2));
check('offset past the end counts every word', () => assert.strictEqual(wordIndexAtChar(T, 9999), T.split(/\s+/).length));
check('empty text is zero', () => assert.strictEqual(wordIndexAtChar('', 5), 0));
check('null-ish inputs do not throw', () => {
  assert.strictEqual(wordIndexAtChar(undefined, undefined), 0);
  assert.strictEqual(wordIndexAtChar(T, -50), 1);
});
check('runs of whitespace do not create phantom words', () => {
  assert.strictEqual(wordIndexAtChar('a   b', 9999), 2);
  assert.strictEqual(wordIndexAtChar('a   b', 2), 1);
});

// The count must never exceed what the book will actually render, or highlightUpTo silently
// clamps and the last word never lights.
check('never exceeds the book\'s own word count, on every page of every story', () => {
  for (const page of stories.flatMap((s) => s.pages)) {
    const rendered = page.text.split(/\s+/).filter(Boolean).length;
    for (let i = 0; i <= page.text.length; i++) {
      const n = wordIndexAtChar(page.text, i);
      assert.ok(n >= 0 && n <= rendered, `page char ${i}: got ${n}, book renders ${rendered}`);
    }
    assert.strictEqual(wordIndexAtChar(page.text, page.text.length), rendered, 'end of page must light every word');
  }
});

check('monotonic across a whole page', () => {
  const t = story.pages[0].text;
  let prev = 0;
  for (let i = 0; i <= t.length; i++) {
    const n = wordIndexAtChar(t, i);
    assert.ok(n >= prev, `went backwards at ${i}`);
    prev = n;
  }
});

// ---- the shelf ----
check('the shelf is not empty and the scene table was parsed', () => {
  assert.ok(stories.length >= 1, 'no stories found in static/stories');
  assert.ok(SCENE_NAMES.length >= 4, `parsed only ${SCENE_NAMES.length} scene names from Storybook.js`);
});

check('story ids, orders and menu labels are unique and present', () => {
  const ids = new Set();
  const orders = new Set();
  for (const st of stories) {
    assert.ok(st.id, `${st.file} has no id`);
    assert.ok(st.title, `${st.file} has no title`);
    assert.ok(st.menuLabel, `${st.file} has no menuLabel (the keypad menu reads it aloud)`);
    assert.ok(!ids.has(st.id), `duplicate id ${st.id}`);
    assert.ok(!orders.has(st.order), `duplicate order ${st.order} on ${st.file}`);
    ids.add(st.id);
    orders.add(st.order);
  }
});

check('every page names a scene the art engine can draw', () => {
  for (const st of stories) {
    st.pages.forEach((page, i) => {
      assert.ok(page.scene, `${st.id} page ${i + 1} has no scene`);
      assert.ok(SCENE_NAMES.includes(page.scene), `${st.id} page ${i + 1}: unknown scene "${page.scene}" (have: ${SCENE_NAMES.join(', ')})`);
    });
  }
});

check('every story has a character the art engine can draw', () => {
  for (const st of stories) {
    assert.ok(CHARACTERS.includes(st.character), `${st.id}: unknown character "${st.character}"`);
  }
});

// A keyword that never occurs in its own page text can never fire its effect — on a real call
// or in the preview. Silent, and invisible without this check.
check('every keyword appears in its own page text, in every story', () => {
  for (const st of stories) {
    st.pages.forEach((page, i) => {
      for (const word of Object.keys(page.keywords || {})) {
        assert.ok(page.text.toLowerCase().includes(word.toLowerCase()), `${st.id} page ${i + 1} has no "${word}"`);
      }
    });
  }
});

check('every keypad effect maps to a label and a sound, in every story', () => {
  for (const st of stories) {
    for (const [key, fx] of Object.entries(st.effects || {})) {
      assert.ok(fx.sound, `${st.id} key ${key} has no sound`);
      assert.ok(fx.label, `${st.id} key ${key} has no label`);
    }
  }
});

// The last page is read aloud by a parent to a named child; a stray placeholder would be
// spoken literally.
check('no unresolved placeholders other than {child} / {parent}', () => {
  for (const st of stories) {
    for (const page of st.pages) {
      const found = page.text.match(/\{[a-z]+\}/gi) || [];
      for (const ph of found) {
        assert.ok(['{child}', '{parent}'].includes(ph), `${st.id}: unknown placeholder ${ph}`);
      }
    }
  }
});

console.log(failures ? `\n${failures} PROBLEM(S)` : '\nALL PREVIEW CHECKS PASSED');
process.exit(failures ? 1 : 0);
