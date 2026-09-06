// Does pressing 1 / 2 / 3 on the phone actually change the picture?
//
// The keypad effects map a story's sound name onto an illustration effect, but whether that
// effect is visible depends on the scene: "stars twinkle" needs stars in the sky, "moon hum"
// needs a moon on screen. On a scene without them the banner still appears and the beep still
// plays, so it looks like it worked while nothing moved. This renders each page clean and then
// with each effect held, at a fixed clock so idle animation cannot pass for a change.
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.argv[2] || 'http://localhost:3210';
const STORIES = ['dragon', 'rabbit', 'boat'];
const MIN_CHANGE = 5; // sampled pixels that must differ

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/art-harness.html`, { waitUntil: 'networkidle2' });
  await page.waitForFunction('window.__ready === true', { timeout: 30000 });

  let failures = 0;
  for (const id of STORIES) {
    const { results } = await page.evaluate((s) => window.__effectDiff(s), id);
    const dead = results.filter((r) => r.changed < MIN_CHANGE);
    if (dead.length) {
      failures += dead.length;
      console.log(`FAIL  ${id}`);
      for (const d of dead) console.log(`        - page ${d.page} (${d.scene}): key ${d.key} "${d.label}" changes nothing`);
    } else {
      const lo = Math.min(...results.map((r) => r.changed));
      console.log(`ok    ${id.padEnd(7)} ${results.length} page/key combinations, weakest changed ${lo} px`);
    }
  }
  if (errors.length) { failures++; console.log(`FAIL  console errors: ${[...new Set(errors)].join(' | ')}`); }

  await browser.close();
  console.log(failures ? `\n${failures} PROBLEM(S)` : '\nALL EFFECT CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
