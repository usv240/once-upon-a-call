// End-to-end walk through the Vonage webhook contract, with no Vonage account involved.
//
// The call flow is the product: answer -> story menu -> either connect to the child or read to
// an empty room -> keypad -> recording -> the story waiting in the morning. Every step is an
// HTTP contract with Vonage, and every one of them is easy to break from a distance — a
// renamed session field, an NCCO action dropped, a recording that never gets marked.
//
// This boots the real index.js with a throwaway RSA key and drives it the way Vonage would.
// Calls out to Vonage itself (subscribeDTMF, playTTS) fail against the fake credentials, which
// is deliberate: the flow has to survive them, and this proves it does.
const { spawn } = require('child_process');
const { generateKeyPairSync } = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3399;
const BASE = `http://localhost:${PORT}`;

let failures = 0;
const results = [];
// Async-aware on purpose: several checks re-read state over HTTP, and a plain try/catch would
// let those rejections escape the harness entirely.
async function check(name, fn) {
  try {
    await fn();
    results.push(`ok    ${name}`);
  } catch (e) {
    failures++;
    results.push(`FAIL  ${name}\n        ${e.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const get = (p) => fetch(BASE + p).then((r) => r.json());
const post = (p, body) =>
  fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then(async (r) => {
    const text = await r.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      return text;
    }
  });

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ouac-flow-'));
  const keyFile = path.join(dir, 'test.key');
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  fs.writeFileSync(keyFile, privateKey);

  const server = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      API_APPLICATION_ID: '00000000-0000-0000-0000-000000000000',
      PRIVATE_KEY: keyFile,
      VONAGE_PHONE_NUMBER: '12018903507',
      CHILD_NAME: 'Maya',
      PARENT_NAME: 'Dad',
      APPROVED_NUMBERS: '',
      FAMILY_PIN: '',
      DEEPGRAM_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  server.stdout.on('data', (d) => log.push(String(d)));
  server.stderr.on('data', (d) => log.push(String(d)));

  // wait for it to come up
  for (let i = 0; i < 60; i++) {
    try {
      await get('/api/health');
      break;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  try {
    const CALLER = '15551234567';
    const LEG = 'leg-uuid-under-test';

    // ---- 1. the shelf and the menu ----
    const shelf = await get('/api/stories');
    await check('the shelf loads with the dragon first', () => {
      assert(shelf.stories.length >= 3, `only ${shelf.stories.length} stories`);
      assert(shelf.active === 'dragon', `default is ${shelf.active}, expected dragon`);
    });

    const menu = await get(`/voice/answer?from=${CALLER}&uuid=${LEG}`);
    await check('an incoming call is offered the story menu', () => {
      assert(Array.isArray(menu), 'answer webhook did not return an NCCO array');
      assert(menu[0].action === 'talk', `first action is ${menu[0].action}`);
      assert(/Press 1 for/.test(menu[0].text), 'menu does not read the choices aloud');
      assert(menu[1].action === 'input', `second action is ${menu[1].action}`);
      assert(menu[1].eventUrl[0].endsWith('/voice/story-choice'), 'menu input posts to the wrong place');
    });

    // ---- 2. nobody is at the storybook: read it for the morning ----
    const unattended = await post('/voice/story-choice', { dtmf: { digits: '3' }, from: CALLER, uuid: LEG });
    await check('choosing 3 selects the third story on the shelf', async () => {
      assert(Array.isArray(unattended), 'story-choice did not return an NCCO');
    });
    const chosen = await get('/api/story');
    await check('the keypad choice actually changed the book', () => {
      assert(chosen.id === 'boat', `active story is ${chosen.id}, expected boat`);
    });

    await check('with no child online the caller is invited to read anyway', () => {
      const actions = unattended.map((a) => a.action);
      assert(!actions.includes('connect'), 'still tries to connect to an app that is not there');
      assert(actions.includes('record'), `no record action: ${actions.join(', ')}`);
      assert(actions.includes('conversation'), `nothing holds the line open: ${actions.join(', ')}`);
      const talk = unattended.find((a) => a.action === 'talk');
      assert(talk, 'the caller is told nothing');
      assert(/still read/i.test(talk.text), `unhelpful message: ${talk.text}`);
      assert(/morning/i.test(talk.text), 'never explains when the child will hear it');
      assert(/pound/i.test(talk.text), 'never explains how to turn the page');
    });

    await check('record posts to the recording webhook and asks for mp3', () => {
      const rec = unattended.find((a) => a.action === 'record');
      assert(rec.format === 'mp3', `format is ${rec.format}`);
      assert(rec.eventUrl[0].endsWith('/voice/recording'), 'recording goes to the wrong webhook');
    });

    await check('the conversation holds the caller alone and ends when they hang up', () => {
      const conv = unattended.find((a) => a.action === 'conversation');
      assert(conv.startOnEnter === true, 'startOnEnter must be true or the caller hears nothing');
      assert(conv.endOnExit === true, 'endOnExit must be true or the leg lingers');
    });

    // ---- 3. the call connects ----
    await post('/voice/event', { status: 'answered', direction: 'inbound', uuid: LEG, conversation_uuid: 'conv-1' });
    const afterAnswer = await get('/api/state');
    await check('answering resets to page one and marks the session unattended', () => {
      assert(afterAnswer.page === 0, `page is ${afterAnswer.page}`);
      assert(afterAnswer.unattended === true, 'session is not marked as reading to an empty room');
    });

    // ---- 4. the keypad still drives the pages, with no child on the line ----
    await post('/voice/dtmf', { dtmf: { digits: '#' }, uuid: LEG });
    await post('/voice/dtmf', { dtmf: { digits: '#' }, uuid: LEG });
    const afterTurns = await get('/api/state');
    await check('the keypad turns pages while reading to an empty room', () => {
      assert(afterTurns.page === 2, `page is ${afterTurns.page}, expected 2`);
    });

    await post('/voice/dtmf', { dtmf: { digits: '*' }, uuid: LEG });
    await check('star goes back a page', async () => {
      assert((await get('/api/state')).page === 1, 'star did not go back');
    });

    await post('/voice/dtmf', { dtmf: { digits: '##' }, uuid: LEG });
    await check('several digits in one webhook are replayed in order', async () => {
      assert((await get('/api/state')).page === 3, 'a fast double press was dropped');
    });

    await post('/voice/dtmf', { dtmf: { digits: '1' }, uuid: LEG });
    await check('an effect digit does not move the page', async () => {
      assert((await get('/api/state')).page === 3, 'pressing 1 moved the page');
    });

    // ---- 5. hang up: the story is kept ----
    await post('/voice/recording', {
      recording_uuid: 'rec-1',
      recording_url: 'https://api.nexmo.com/v1/files/does-not-exist',
      start_time: new Date(Date.now() - 60000).toISOString(),
      end_time: new Date().toISOString(),
      size: 12345,
    });
    await post('/voice/event', { status: 'completed', direction: 'inbound', uuid: LEG });

    // The recording webhook answers 200 immediately and then tries to pull the mp3 from Vonage.
    // With fake credentials that request has to fail over the network first, so wait for the
    // entry to be filed rather than guessing at a sleep.
    for (let i = 0; i < 60; i++) {
      if ((await get('/api/recordings')).length) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    const waiting = await get('/api/state');
    await check('a story read to an empty room is waiting to be heard', () => {
      assert(waiting.waitingStories === 1, `waitingStories is ${waiting.waitingStories}`);
    });

    const recs = await get('/api/recordings');
    await check('the recording is filed as unattended and unseen', () => {
      assert(recs.length === 1, `${recs.length} recordings`);
      assert(recs[0].unattended === true, 'not flagged unattended');
      assert(recs[0].seen === false, 'marked as already heard');
      assert(recs[0].events > 0, 'no page turns were kept for the replay');
    });

    // The download fails against fake credentials, which is the point: the visual replay must
    // still be offered rather than the whole keepsake being lost.
    const replay = await get('/api/replay/latest');
    await check('the morning replay is offered even when the audio never downloaded', () => {
      assert(replay.unattended === true, 'replay does not know it was unattended');
      assert(Array.isArray(replay.events) && replay.events.length > 0, 'replay has no page turns');
      assert(replay.parentName === 'Dad', `parentName is ${replay.parentName}`);
      assert(replay.story === 'boat', `replay names story ${replay.story}`);
    });

    await check('once played, the story is no longer waiting', async () => {
      assert((await get('/api/state')).waitingStories === 0, 'still shows as unheard');
    });

    // ---- 6. the attended path still connects ----
    await get('/token?name=XR_User_1').catch(() => {});
    const attended = await get(`/voice/answer?from=${CALLER}&uuid=leg-2`);
    const attendedNcco = Array.isArray(attended) ? attended : [];
    const afterChoice = await post('/voice/story-choice', { dtmf: { digits: '1' }, from: CALLER });
    await check('with the child online the call connects, and still falls through if unanswered', () => {
      assert(attendedNcco[0].action === 'talk', 'no menu for an online child');
      const actions = (Array.isArray(afterChoice) ? afterChoice : []).map((a) => a.action);
      assert(actions.includes('connect'), `never tries to connect: ${actions.join(', ')}`);
      const connect = afterChoice.find((a) => a.action === 'connect');
      assert(connect.timeout > 0, 'connect has no ring timeout, so it can hang forever');
      const tail = actions.slice(actions.indexOf('connect') + 1);
      assert(tail.includes('conversation'), 'no fallback if the child never picks up');
    });

    await check('the server survived Vonage calls failing against fake credentials', () => {
      const text = log.join('');
      assert(!/UnhandledPromiseRejection|Cannot read properties of undefined/.test(text), `crash in log:\n${text.slice(-600)}`);
    });
  } finally {
    server.kill();
  }

  console.log(results.join('\n'));
  console.log(failures ? `\n${failures} PROBLEM(S)` : '\nALL FLOW CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
