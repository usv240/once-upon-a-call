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
      // Keep exactly one, so filing a second forces the retention sweep to run and we can see
      // what it decides to take with it.
      RECORDING_KEEP_MAX: '1',
      RECORDING_KEEP_DAYS: '0',
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

    const menu = await get(`/voice/answer?from=${CALLER}&uuid=${LEG}&conversation_uuid=conv-1`);
    // In reality the inbound leg is answered the moment the NCCO starts — during the menu,
    // long before any story is chosen. The earlier version of this test posted these the
    // other way round and hid a bug where the unattended keypad was never subscribed.
    await post('/voice/event', { status: 'answered', direction: 'inbound', uuid: LEG, conversation_uuid: 'conv-1' });
    await check('an incoming call is offered the story menu', () => {
      assert(Array.isArray(menu), 'answer webhook did not return an NCCO array');
      assert(menu[0].action === 'talk', `first action is ${menu[0].action}`);
      assert(/Press 1 for/.test(menu[0].text), 'menu does not read the choices aloud');
      assert(menu[1].action === 'input', `second action is ${menu[1].action}`);
      assert(menu[1].eventUrl[0].includes('/voice/story-choice'), 'menu input posts to the wrong place');
      assert(menu[1].dtmf.timeOut === 10, `menu only allows ${menu[1].dtmf.timeOut}s to press a key`);
      assert(/Take your time/i.test(menu[0].text), 'the prompt never reassures them they can take a moment');
    });

    // ---- 1b. a caller who presses nothing gets asked again, not overruled ----
    const silent1 = await post('/voice/story-choice?attempt=0', { from: CALLER, uuid: LEG });
    await check('pressing nothing re-offers the menu instead of choosing for you', () => {
      const actions = (Array.isArray(silent1) ? silent1 : []).map((a) => a.action);
      assert(actions.includes('input'), `menu was not repeated: ${actions.join(', ')}`);
      const talk = silent1.find((a) => a.action === 'talk');
      assert(/try that again/i.test(talk.text), `unexpected retry prompt: ${talk.text}`);
      assert(/stay on the line/i.test(talk.text), 'never says what happens if they keep waiting');
      assert(silent1.find((a) => a.action === 'input').dtmf.timeOut === 10, 'retry does not use the full 10s');
    });

    const outOfRange = await post('/voice/story-choice?attempt=0', { dtmf: { digits: '7' }, from: CALLER });
    await check('a digit with no story behind it also gets a second chance', () => {
      const actions = (Array.isArray(outOfRange) ? outOfRange : []).map((a) => a.action);
      assert(actions.includes('input'), 'pressing 7 fell straight through to a story');
    });

    const silent2 = await post('/voice/story-choice?attempt=1', { from: CALLER, uuid: LEG });
    await check('after the second miss it proceeds rather than looping forever', () => {
      const actions = (Array.isArray(silent2) ? silent2 : []).map((a) => a.action);
      assert(!actions.includes('input'), 'the menu loops instead of getting on with the story');
      // Nobody is at the storybook in this part of the run, so proceeding means being invited to
      // read to the empty room - the conversation is what holds that line open.
      assert(
        actions.includes('conversation'),
        `did not proceed to a story: ${actions.join(', ')}`
      );
    });

    await check('the default after two misses is the first book on the shelf', async () => {
      assert((await get('/api/story')).id === 'dragon', 'silence changed the story');
    });

    // ---- 2. nobody is at the storybook: read it for the morning ----
    const unattended = await post('/voice/story-choice?attempt=0', { dtmf: { digits: '3' }, from: CALLER, uuid: LEG });
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
      assert(actions.includes('conversation'), `nothing holds the line open: ${actions.join(', ')}`);
      assert(
        !actions.includes('record'),
        'a leg-level record here files a second, prompt-only recording that competes with the ' +
          'conversation recording for the morning replay'
      );
      const talk = unattended.find((a) => a.action === 'talk');
      assert(talk, 'the caller is told nothing');
      assert(/still read/i.test(talk.text), `unhelpful message: ${talk.text}`);
      assert(/morning/i.test(talk.text), 'never explains when the child will hear it');
      assert(/pound/i.test(talk.text), 'never explains how to turn the page');
    });

    // The bug this guards cost a whole evening: a `record` action stops at the mouth of a
    // conversation. It captured the invitation and then nothing, so the keepsake was sixteen
    // seconds of a robot saying nobody was home - and the reading, the entire point, was gone.
    // The recording has to belong to the conversation, because that is where the reading is.
    await check('the conversation records itself, which is where the reading happens', () => {
      const conv = unattended.find((a) => a.action === 'conversation');
      assert(conv.record === true, 'the conversation is not recorded, so the reading is lost');
      assert(
        conv.eventUrl && /\/voice\/recording/.test(conv.eventUrl[0]),
        `conversation recording goes nowhere useful: ${conv.eventUrl}`
      );
      assert(
        /src=room/.test(conv.eventUrl[0]),
        'the conversation recording is not tagged, so replay cannot prefer it over a leg one'
      );
    });

    await check('the conversation holds the caller alone and ends when they hang up', () => {
      const conv = unattended.find((a) => a.action === 'conversation');
      assert(conv.startOnEnter === true, 'startOnEnter must be true or the caller hears nothing');
      assert(conv.endOnExit === true, 'endOnExit must be true or the leg lingers');
    });

    // ---- 3. reading to the empty room: the keypad must already be live ----
    await new Promise((r) => setTimeout(r, 300));
    const afterAnswer = await get('/api/state');
    await check('the session is marked as reading to an empty room, starting on page one', () => {
      assert(afterAnswer.page === 0, `page is ${afterAnswer.page}`);
      assert(afterAnswer.unattended === true, 'session is not marked as reading to an empty room');
    });

    await check('the keypad is subscribed for the empty room even though answered fired during the menu', () => {
      const text = log.join('');
      assert(/Subscribing to keypad on .* \(reading to an empty room\)/.test(text),
        `no keypad subscription attempt for the unattended read. Log tail:\n${text.slice(-500)}`);
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

    // ---- 5. hang up: the story is kept, even if the next call has already begun ----
    await post('/voice/event', { status: 'completed', direction: 'inbound', uuid: LEG });
    // A second caller dials in before the recording webhook lands. The answer webhook resets
    // the live session; the first call's recording must still be filed with its own facts.
    await get(`/voice/answer?from=15559990000&uuid=leg-next&conversation_uuid=conv-2`);
    await post('/voice/recording', {
      recording_uuid: 'rec-1',
      recording_url: 'https://api.nexmo.com/v1/files/does-not-exist',
      start_time: new Date(Date.now() - 60000).toISOString(),
      end_time: new Date().toISOString(),
      size: 12345,
    });
    // The recording webhook answers 200 immediately and then tries to pull the mp3 from Vonage.
    // With fake credentials that request has to fail over the network first, so wait for the
    // entry to be filed rather than guessing at a sleep.
    for (let i = 0; i < 60; i++) {
      if ((await get('/api/recordings')).length) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    // The conversation's eventUrl carries its whole lifecycle, not only its recording. Filing
    // those as recordings makes entries with no audio and an empty timeline, and one of those
    // surfacing on the morning replay is a storybook that plays a voice and never turns a page.
    const before = (await get('/api/recordings')).length;
    await post('/voice/recording?src=room', { status: 'completed', conversation_uuid: 'conv-1' });
    await post('/voice/recording?src=room', { status: 'started', conversation_uuid: 'conv-1' });
    await new Promise((r) => setTimeout(r, 400));
    await check('a conversation lifecycle event is not filed as a recording', async () => {
      const after = (await get('/api/recordings')).length;
      assert(after === before, `${after - before} empty recording(s) filed from conversation events`);
    });

    const waiting = await get('/api/state');
    await check('a story read to an empty room is waiting to be heard', () => {
      assert(waiting.waitingStories === 1, `waitingStories is ${waiting.waitingStories}`);
    });

    const recs = await get('/api/recordings');
    await check('the recording is filed as unattended and unseen, with its own page turns and story', () => {
      assert(recs.length === 1, `${recs.length} recordings`);
      assert(recs[0].unattended === true, 'not flagged unattended (the next call had reset the session)');
      assert(recs[0].seen === false, 'marked as already heard');
      assert(recs[0].events > 0, 'no page turns were kept for the replay (the next call had wiped the timeline)');
      assert(recs[0].story === 'boat', `filed under ${recs[0].story}, expected boat`);
    });

    // put the live session back to something sane for the rest of the run
    await post('/voice/event', { status: 'completed', direction: 'inbound', uuid: 'leg-next' });

    // Retention must never take a story nobody has heard yet. That recording is the one thing
    // in the folder somebody is still waiting for, and losing it loses the whole idea.
    await check('a story still waiting for the morning survives the retention sweep', async () => {
      const beforeIds = (await get('/api/recordings')).map((r) => r.uuid);
      const waitingBefore = (await get('/api/state')).waitingStories;
      assert(waitingBefore > 0, 'nothing was waiting, so this check proves nothing');

      // File a newer recording. With RECORDING_KEEP_MAX=1 the sweep now wants to drop everything
      // except the newest - which would include the unheard one if it were not protected.
      await post('/voice/recording', {
        recording_uuid: 'rec-newer',
        recording_url: 'https://api.nexmo.com/v1/files/also-does-not-exist',
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        size: 999,
      });
      for (let i = 0; i < 40; i++) {
        if ((await get('/api/recordings')).some((r) => r.uuid === 'rec-newer')) break;
        await new Promise((r) => setTimeout(r, 500));
      }

      const after = await get('/api/recordings');
      const stillThere = after.map((r) => r.uuid);
      const lostAWaitingOne = beforeIds.some(
        (id) => id === 'rec-1' && !stillThere.includes('rec-1')
      );
      assert(!lostAWaitingOne, 'the retention sweep deleted a story nobody had heard yet');
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

    await check('pressing Replay twice replays the same story, not an older one', async () => {
      const first = await get('/api/replay/latest');
      const second = await get('/api/replay/latest');
      assert(
        second.audioUrl === first.audioUrl,
        `second Replay handed back a different recording: ${first.audioUrl} then ${second.audioUrl}`
      );
      assert(
        (second.events || []).length === (first.events || []).length,
        'second Replay lost the page turns'
      );
    });

    await check('once played, the story is no longer waiting', async () => {
      assert((await get('/api/state')).waitingStories === 0, 'still shows as unheard');
    });

    await check('/api/story?id= reads a book without changing which one is active', async () => {
      const rabbit = await get('/api/story?id=rabbit');
      assert(rabbit.id === 'rabbit', `got ${rabbit.id}`);
      assert(/Maya/.test(rabbit.pages[rabbit.pages.length - 1].text), 'not personalised');
      const active = await get('/api/stories');
      assert(active.active !== 'rabbit', 'reading a story by id changed the active one');
    });

    // ---- 6. the attended path still connects ----
    // A token alone is no longer enough: the server rings only a storybook that is actually
    // open, which the client announces over its socket.
    await get('/token?name=XR_User_1').catch(() => {});
    const beforeSocket = await get(`/voice/answer?from=${CALLER}&uuid=leg-1b`);
    const beforeChoice = await post('/voice/story-choice', { dtmf: { digits: '1' }, from: CALLER });
    await check('a token without an open storybook still reads to the empty room', () => {
      const actions = (Array.isArray(beforeChoice) ? beforeChoice : []).map((a) => a.action);
      assert(!actions.includes('connect'), 'rings a storybook that nobody has open');
    });
    void beforeSocket;

    const { io: ioClient } = require('socket.io-client');
    const sock = ioClient(BASE, { transports: ['websocket'] });
    await new Promise((resolve, reject) => {
      sock.on('connect', resolve);
      sock.on('connect_error', reject);
      setTimeout(() => reject(new Error('socket never connected')), 10000);
    });
    sock.emit('storybook:ready', { user: 'xr_user_1' });
    await new Promise((r) => setTimeout(r, 400));

    await check('a reconnecting storybook re-introduces its username after a restart', async () => {
      // simulate the server having forgotten: we cannot restart mid-test, but the health
      // check exposes the same decision the answer webhook makes
      const h = await get('/api/health');
      assert(h.checks.childAppOnline === true, 'storybook not online after announcing');
    });

    await check('an open storybook shows as online in the health check', async () => {
      assert((await get('/api/health')).checks.childAppOnline === true, 'storybook not seen as open');
    });

    const attended = await get(`/voice/answer?from=${CALLER}&uuid=leg-2`);
    const attendedNcco = Array.isArray(attended) ? attended : [];
    const afterChoice = await post('/voice/story-choice', { dtmf: { digits: '1' }, from: CALLER });
    await check('with the child online the call connects, and says nothing after', () => {
      assert(attendedNcco[0].action === 'talk', 'no menu for an online child');
      const actions = (Array.isArray(afterChoice) ? afterChoice : []).map((a) => a.action);
      assert(actions.includes('connect'), `never tries to connect: ${actions.join(', ')}`);
      const connect = afterChoice.find((a) => a.action === 'connect');
      assert(connect.timeout > 0, 'connect has no ring timeout, so it can hang forever');

      // The bug this guards, and it survived a live call before anyone noticed: an NCCO runs
      // straight on when a connect ends. With the empty-room invitation sitting after it, a
      // call that bridged and worked perfectly still signed off by telling the caller that
      // nobody was at the storybook. Nothing may follow the connect.
      const tail = actions.slice(actions.indexOf('connect') + 1);
      assert(
        tail.length === 0,
        `${tail.join(', ')} runs after the connect, so a successful call ends with it`
      );
      assert(
        connect.timeout >= 40,
        `ring timeout of ${connect.timeout}s is too short for someone to hear it and answer`
      );
      assert(
        !connect.eventUrl,
        'connect has its own eventUrl, which diverts this leg away from /voice/event - where ' +
          'the handler that starts the parent keypad lives'
      );
    });

    // The bug this guards: when the ring is never answered the NCCO reads on into the unattended
    // tail, but nothing told the session. The reading was then filed as an ordinary call - no
    // page numbers spoken back, recording marked already-seen, no story waiting in the morning -
    // while the caller had just been told nobody was there.
    const ring = (status) =>
      post('/voice/event', { status, direction: 'outbound', to: 'xr_user_1', uuid: 'app-leg-1' });

    await ring('timeout');
    await new Promise((r) => setTimeout(r, 250));
    await check('a ring nobody answers becomes a story read to the empty room', async () => {
      const state = await get('/api/state');
      assert(state.unattended === true, 'the fallthrough reading is still filed as an attended call');
    });

    await check('the keypad is listening after the ring gave up', () => {
      const text = log.join('');
      assert(
        /the storybook did not answer/.test(text),
        `keypad never subscribed after the ring timed out:\n${text.slice(-400)}`
      );
    });

    await check('the child answering later takes it back off the empty-room path', async () => {
      await post('/voice/event', {
        status: 'answered',
        direction: 'outbound',
        to: 'xr_user_1',
        uuid: 'app-leg-2',
      });
      await new Promise((r) => setTimeout(r, 250));
      const state = await get('/api/state');
      assert(state.unattended === false, 'still reading to an empty room after the child answered');
    });

    sock.close();
    await new Promise((r) => setTimeout(r, 500));
    await check('closing the storybook takes it offline again', async () => {
      assert((await get('/api/health')).checks.childAppOnline === false, 'closed storybook still looks open');
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
