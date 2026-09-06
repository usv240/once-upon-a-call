// Renders every page of every story and fails if the canvas throws or comes out blank.
//
// The illustrations are procedural: a typo in drawRabbit does not crash the app, it just
// draws nothing, and nobody notices until a judge watches the video. So render each page in
// a real browser, fire every effect it can fire, run a few animation frames, and count how
// much non-paper ink landed on the canvas.
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.argv[2] || 'http://localhost:3210';
const STORIES = ['dragon', 'rabbit', 'boat'];
const MIN_INK = 200; // samples of non-paper pixels; a blank illustration scores near zero

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`${BASE}/art-harness.html`, { waitUntil: 'networkidle2' });
  await page.waitForFunction('window.__ready === true', { timeout: 30000 });

  let failures = 0;
  for (const id of STORIES) {
    let result;
    try {
      result = await page.evaluate((s) => window.__renderStory(s), id);
    } catch (e) {
      console.log(`FAIL  ${id}: threw while rendering — ${e.message}`);
      failures++;
      continue;
    }
    const blank = result.pages.filter((p) => p.inkSamples < MIN_INK);
    if (blank.length) {
      failures++;
      console.log(`FAIL  ${id} (${result.character}): blank illustration on page(s) ${blank.map((p) => `${p.page}/${p.scene}`).join(', ')}`);
    } else {
      const range = result.pages.map((p) => p.inkSamples);
      console.log(`ok    ${id.padEnd(7)} ${result.character.padEnd(7)} pages ${result.pages.length}  ink ${Math.min(...range)}–${Math.max(...range)}  "${result.title}"`);
    }
  }

  if (errors.length) {
    failures++;
    console.log(`FAIL  console errors: ${[...new Set(errors)].join(' | ')}`);
  }
  await browser.close();
  console.log(failures ? `\n${failures} PROBLEM(S)` : '\nALL ART CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
