// Once Upon a Call — server
// A parent on any plain phone dials in; the child sees them in an AR storybook.
//
// Vonage Voice API features used:
//   1. Client SDK in-app leg    — the child's WebXR app answers the call     (/token, connect{app})
//   2. NCCO input (DTMF)        — family PIN, and choosing tonight's story from the shelf
//   3. NCCO record + conversation — a story read to an empty room when nobody answers,
//                                    kept for the morning                     (/voice/recording)
//   4. Asynchronous DTMF        — the parent's keypad turns AR pages          (subscribeDTMF, /voice/dtmf)
//   5. Per-leg text-to-speech   — the AR world talks back to the parent only  (playTTS)
//   6. Recording download       — replay mode without exposing credentials    (downloadRecording)
//   7. Messages API (optional)  — caregiver gets a text when a story is saved
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { Server: SocketServer } = require('socket.io');
const { tokenGenerate } = require('@vonage/jwt');
const { Vonage } = require('@vonage/server-sdk');

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: '*' } });
const port = process.env.PORT || 3000;

// ---------- credentials ----------
const appId = process.env.API_APPLICATION_ID;
let privateKey;
if (process.env.PRIVATE_KEY) {
  try {
    privateKey = fs.readFileSync(process.env.PRIVATE_KEY, 'utf8');
  } catch (error) {
    privateKey = process.env.PRIVATE_KEY.replace(/\\n/g, '\n');
  }
} else if (process.env.PRIVATE_KEY64) {
  privateKey = Buffer.from(process.env.PRIVATE_KEY64, 'base64');
}
if (!appId || !privateKey) {
  console.error('Missing API_APPLICATION_ID and/or PRIVATE_KEY64 in .env');
  process.exit();
}
const vonage = new Vonage({ applicationId: appId, privateKey });
const vonageNumber = process.env.VONAGE_PHONE_NUMBER;

// Public base URL Vonage can reach (Codespaces, or PUBLIC_URL for ngrok etc.)
//
// The forwarding domain is not always app.github.dev - it varies by account and region, and
// guessing it produces a hostname that resolves to GitHub's proxy and 404s on everything, which
// looks exactly like a port left Private. Codespaces publishes the real one; use it.
const CODESPACE_DOMAIN =
  process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';
const BASE_URL =
  process.env.PUBLIC_URL ||
  (process.env.CODESPACE_NAME
    ? `https://${process.env.CODESPACE_NAME}-${port}.${CODESPACE_DOMAIN}`
    : `http://localhost:${port}`);

// Safety: who may enter the child's room. Empty = open (demo mode).
const APPROVED_NUMBERS = (process.env.APPROVED_NUMBERS || '')
  .split(',')
  .map((n) => n.replace(/\D/g, ''))
  .filter(Boolean);
const FAMILY_PIN = (process.env.FAMILY_PIN || '').trim();
const CAREGIVER_NUMBER = (process.env.CAREGIVER_NUMBER || '').replace(/\D/g, '');

console.log('Public base URL:', BASE_URL);
console.log('Approved callers:', APPROVED_NUMBERS.length ? APPROVED_NUMBERS : '(open demo mode)');
console.log('Family PIN:', FAMILY_PIN ? 'set' : 'not set');

// ---------- story library + session state (one family for the demo) ----------
// Stories are plain JSON in static/stories. Drop another file in and it appears in the
// keypad menu and the picker with no code change.
const STORIES_DIR = path.join(__dirname, 'static', 'stories');
function loadStories() {
  let files = [];
  try {
    files = fs.readdirSync(STORIES_DIR).filter((f) => f.endsWith('.json')).sort();
  } catch (e) {
    /* no library directory */
  }
  const loaded = files
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(STORIES_DIR, f), 'utf8'));
      } catch (e) {
        console.warn(`Skipping unreadable story ${f}:`, e.message);
        return null;
      }
    })
    .filter(Boolean);
  // Explicit `order` decides the keypad menu and which story is the default, so adding a
  // file cannot silently change what a caller hears first.
  loaded.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.id).localeCompare(String(b.id)));
  if (!loaded.length) {
    console.error(`No readable stories in ${STORIES_DIR}. Add at least one .json story file.`);
    process.exit(1);
  }
  return loaded;
}
const STORIES = loadStories();

// One family per server for the demo, so the names live in the environment rather than in
// every story file. Story text uses {child} / {parent} placeholders.
const CHILD_NAME = process.env.CHILD_NAME || STORIES[0].childName || 'your child';
const PARENT_NAME = process.env.PARENT_NAME || STORIES[0].parentName || 'Parent';

function personalise(raw) {
  const fill = (t) => String(t).replaceAll('{child}', CHILD_NAME).replaceAll('{parent}', PARENT_NAME);
  return {
    ...raw,
    childName: CHILD_NAME,
    parentName: PARENT_NAME,
    pages: raw.pages.map((pg) => ({ ...pg, text: fill(pg.text) })),
  };
}

console.log(`Story library: ${STORIES.map((s) => s.id || s.title).join(', ')}`);

const RECORDINGS_DIR = path.join(__dirname, 'recordings');
fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

const session = {
  storyId: STORIES[0].id || 'default',
  userLoggedIn: null, // Client SDK username of the child's XR app
  parentLeg: null, // uuid of the parent's PSTN leg (for per-leg TTS + DTMF)
  parentNumber: null,
  conversationUuid: null,
  page: 0,
  unattended: false, // reading to an empty room: nobody answered, record it for the morning
  storybooks: new Set(), // socket ids of open storybooks — see childOnline()
  dtmfSubscribed: false,
  timeline: [], // { t, type, data } during the live story (server-side events)
  recordings: [], // { file, url, uuid, start, end, size, events }
};

// Is there actually a storybook open to ring?
//
// A token having been issued once is not the question — session.userLoggedIn stays set for the
// life of the process, so a closed tab would still look online and the caller would sit through
// a ring timeout for a phone that cannot be answered. What matters is whether a storybook is
// open right now, which the client tells us over its own socket.
function childOnline() {
  return !!session.userLoggedIn && session.storybooks.size > 0;
}

// The active story, already personalised. Everything downstream reads this.
function activeStory() {
  const raw = STORIES.find((s) => (s.id || 'default') === session.storyId) || STORIES[0];
  return personalise(raw);
}

function setStory(id, why) {
  const found = STORIES.find((s) => (s.id || 'default') === id);
  if (!found) return false;
  session.storyId = id;
  session.page = 0;
  console.log(`Story set to "${found.title}" (${why})`);
  io.emit('story', { id: session.storyId, title: found.title });
  broadcastState();
  return true;
}

function publicState() {
  const story = activeStory();
  const waiting = session.recordings.filter((r) => r.unattended && !r.seen).length;
  return {
    page: session.page,
    storyId: session.storyId,
    unattended: session.unattended,
    waitingStories: waiting,
    storyTitle: story.title,
    totalPages: story.pages.length,
    inCall: !!session.parentLeg,
    recordings: session.recordings.length,
  };
}
const broadcastState = () => io.emit('state', publicState());
const mark = (type, data) => session.timeline.push({ t: Date.now(), type, data });

// ---------- middleware ----------
app.use(express.static(path.join(__dirname, 'pages')));
app.use(express.static('static'));
app.use('/recordings', express.static(RECORDINGS_DIR));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

app.get('/', (req, res) => res.sendFile(path.resolve(__dirname, 'pages/index.html')));

// ---------- Client SDK token ----------
async function createUser(displayName) {
  const username = displayName.toLowerCase().replaceAll(' ', '-');
  try {
    await vonage.users.createUser({ name: username, displayName });
  } catch (e) {
    /* already exists */
  }
  return username;
}

app.get('/token', async (req, res) => {
  const displayName = req.query.name;
  if (!displayName) return res.status(400).json({ error: 'name required' });
  const username = await createUser(displayName);
  session.userLoggedIn = username;
  console.log(`Token issued for ${username}`);
  res.locals.username = username;
  const token = tokenGenerate(appId, privateKey, {
    exp: Math.round(Date.now() / 1000) + 86400,
    sub: username,
    acl: {
      paths: {
        '/*/rtc/**': {},
        '/*/sessions/**': {},
        '/*/conversations/**': {},
        '/*/knocking/**': {},
        '/*/legs/**': {},
      },
    },
  });
  res.json({ token, username });
});

// ---------- NCCO builders ----------
// Offered before the story starts, and only when there is more than one book on the shelf.
// The parent has no screen, so the shelf is read to them and chosen with the same keypad that
// will turn the pages a moment later.
// Vonage caps an input action's dtmf timeOut at 10 seconds, and on most phones the caller has
// to find and open the in-call dialpad before they can press anything at all — which eats most
// of that on its own. So rather than stretching one window, the menu asks twice.
const MENU_TIMEOUT = 10;
const MENU_RETRIES = 1;

function menuNCCO(attempt = 0) {
  const choices = STORIES.slice(0, 9)
    .map((s, i) => `Press ${i + 1} for ${s.menuLabel || s.title}.`)
    .join(' ');
  const fallback = STORIES[0].menuLabel || STORIES[0].title;
  // bargeIn lets them press during the prompt, so someone who already knows the menu never
  // waits through it.
  return [
    {
      action: 'talk',
      language: 'en-US',
      bargeIn: true,
      text: attempt
        ? `Let's try that again. ${choices} Or stay on the line for ${fallback}.`
        : `Welcome to Once Upon a Call. Choose tonight's story for ${CHILD_NAME}. ${choices} Take your time; press a number when you are ready.`,
    },
    {
      action: 'input',
      type: ['dtmf'],
      dtmf: { maxDigits: 1, timeOut: MENU_TIMEOUT },
      eventUrl: [`${BASE_URL}/voice/story-choice?attempt=${attempt}`],
    },
  ];
}

// The most important thing this app does.
//
// Whoever is calling may have had to book this slot days ago: a prison phone allowance, a
// satellite window, a hospital ward's one cordless handset. Telling them "try again later"
// spends a week of someone's waiting on a busy signal. So if nobody is at the storybook, they
// read it anyway — Vonage records the call, their keypad still turns the pages into the
// timeline, and the child opens the book in the morning to find the story already there,
// pages turning in time with a voice.
function unattendedTail(story) {
  return [
    {
      action: 'talk',
      language: 'en-US',
      text: `${story.childName} isn't at the storybook right now. You can still read tonight's story and it will be waiting in the morning, with the pages turning in your voice. ${story.title}. Press pound when you finish each page. Hang up when you're done.`,
    },
    {
      // Holds the line open, alone, for as long as they want to read. The record action above
      // keeps capturing until they hang up.
      action: 'conversation',
      name: `ouac-solo-${session.conversationUuid || Date.now()}`,
      startOnEnter: true,
      endOnExit: true,
    },
  ];
}

function storyNCCO(from) {
  const story = activeStory();

  // No storybook open: go straight to reading for the morning rather than ringing nothing.
  if (!childOnline()) {
    session.unattended = true;
    return [
      { action: 'record', eventUrl: [`${BASE_URL}/voice/recording`], format: 'mp3' },
      ...unattendedTail(story),
    ];
  }

  session.unattended = false;
  return [
    {
      action: 'talk',
      language: 'en-US',
      text: `Opening ${story.title}. Press pound to turn the page, star to go back, and one, two or three for surprises.`,
    },
    {
      // Records from here until hangup; Vonage posts the file URL to /voice/recording
      action: 'record',
      eventUrl: [`${BASE_URL}/voice/recording`],
      format: 'mp3',
    },
    {
      action: 'connect',
      from,
      // 25s sounds generous until you are the one hearing a ring, finding the tab and pressing
      // answer. Miss it and the caller is told nobody is there while the child is looking
      // straight at the storybook - the worst outcome this app has.
      timeout: 45,
      // No eventUrl here, on purpose. Giving the connect its own diverts this leg's events away
      // from /voice/event - including the `answered` that starts the parent's keypad.
      endpoint: [{ type: 'app', user: session.userLoggedIn }],
    },
    // Nothing after the connect. The empty-room invitation used to live here, which looked
    // right and was wrong: an NCCO simply runs on when a connect ends, so a call that worked
    // perfectly - bridged, read, keypad and all - still signed off by telling the caller that
    // nobody was at the storybook. When the ring genuinely goes unanswered we transfer the
    // caller into that read instead, from the event handler, where we actually know.
  ];
}

function pinNCCO() {
  return [
    {
      action: 'talk',
      language: 'en-US',
      bargeIn: true,
      text: 'Welcome to Once Upon a Call. Please enter your family PIN, followed by pound.',
    },
    {
      action: 'input',
      type: ['dtmf'],
      dtmf: { maxDigits: 6, submitOnHash: true, timeOut: 15 },
      eventUrl: [`${BASE_URL}/voice/pin`],
    },
  ];
}

// ---------- answer webhook ----------
app.get('/voice/answer', (req, res) => {
  console.log('NCCO request:', req.query);
  const from = String(req.query.from || '').replace(/\D/g, '');

  // Phone -> app: the story call
  if (from && !req.query.from_user) {
    // This is the earliest point in a new call — Vonage cannot do anything until it has this
    // NCCO — so this is where the previous call's state is cleared. Clearing it on the
    // 'answered' event instead was too late: story-choice could run first and set
    // unattended, only to have it wiped.
    session.parentNumber = from;
    session.parentLeg = req.query.uuid || null;
    session.conversationUuid = req.query.conversation_uuid || null;
    session.page = 0;
    session.timeline = [];
    session.unattended = false;
    session.dtmfSubscribed = false;
    const allowed = APPROVED_NUMBERS.length === 0 || APPROVED_NUMBERS.includes(from);
    if (!allowed && FAMILY_PIN) return res.json(pinNCCO());
    if (!allowed) {
      return res.json([{ action: 'talk', language: 'en-US', text: 'Sorry, this number is not on the family list. Goodbye.' }]);
    }
    return res.json(STORIES.length > 1 ? menuNCCO() : storyNCCO(req.query.from));
  }

  // App -> phone / app -> app (kept from the workshop kit)
  const isPhone = /^\d+$/.test(req.query.to || '');
  const endpoint = isPhone ? { type: 'phone', number: req.query.to } : { type: 'app', user: req.query.to };
  return res.json([
    { action: 'talk', text: 'Please wait while we connect you.' },
    { action: 'connect', from: isPhone ? vonageNumber : req.query.from_user, endpoint: [endpoint] },
  ]);
});

// PIN result -> either the story or goodbye
app.post('/voice/pin', (req, res) => {
  const digits = String(req.body?.dtmf?.digits || '').trim();
  console.log('PIN entered:', digits ? '****' : '(none)');
  if (digits && digits === FAMILY_PIN) {
    if (STORIES.length > 1) return res.json(menuNCCO());
    const ncco = storyNCCO(req.body.from);
    res.json(ncco);
    if (session.unattended) listenToKeypad('reading to an empty room');
    return;
  }
  return res.json([{ action: 'talk', language: 'en-US', text: "That PIN isn't right. Goodbye." }]);
});

// Keypad choice from menuNCCO. No input, or a digit off the end of the shelf, quietly keeps
// whatever was already selected — a parent who says nothing still gets a story.
app.post('/voice/story-choice', (req, res) => {
  const digit = String(req.body?.dtmf?.digits || '').trim();
  const picked = STORIES[Number(digit) - 1];
  const proceed = () => {
    const ncco = storyNCCO(req.body?.from);
    res.json(ncco);
    // storyNCCO just decided whether anyone is home. If not, the keypad is the caller's whole
    // interface and has to be live before they reach the first page — the 'answered' event
    // fired long ago, during the menu, and could not know yet.
    if (session.unattended) {
      if (!session.parentLeg && req.body?.uuid) session.parentLeg = req.body.uuid;
      listenToKeypad('reading to an empty room');
    }
  };

  if (picked) {
    setStory(picked.id || 'default', `chosen on the keypad: ${digit}`);
    return proceed();
  }

  // Nothing pressed, or a digit with no story behind it. Defaulting on the first miss is a
  // poor way to treat someone who may be holding a handset in a noisy room, hunting for the
  // dialpad, on a call they waited a week for. Ask once more before choosing for them.
  const attempt = Number(req.query.attempt || 0);
  if (attempt < MENU_RETRIES) {
    console.log(`Story menu: ${digit ? `no story on key ${digit}` : 'nothing pressed'}, asking again`);
    return res.json(menuNCCO(attempt + 1));
  }
  console.log(`Story menu: no choice after ${attempt + 1} attempts, keeping ${session.storyId}`);
  proceed();
});

// Subscribing twice is an error and forgetting to subscribe is a silent dead keypad, so it
// happens in exactly one place. Attended calls wait for the child to answer; unattended ones
// start as soon as the caller is on the line, because the keypad is all they have.
async function listenToKeypad(why) {
  if (!session.parentLeg) return console.warn(`Cannot listen to keypad yet (${why}): no parent leg known`);
  if (session.dtmfSubscribed) return;
  session.dtmfSubscribed = true;
  console.log(`Subscribing to keypad on ${session.parentLeg} (${why})`);
  try {
    await vonage.voice.subscribeDTMF(session.parentLeg, `${BASE_URL}/voice/dtmf`);
    console.log(`Listening to keypad on parent leg ${session.parentLeg} (${why})`);
  } catch (e) {
    session.dtmfSubscribed = false;
    console.error('subscribeDTMF failed:', e?.response?.data || e.message);
  }
}

// ---------- call lifecycle ----------
app.all('/voice/event', async (req, res) => {
  const ev = req.body || {};
  res.sendStatus(200);
  if (ev.status) console.log(`EVENT ${ev.status} ${ev.direction || ''} to=${ev.to || ''} leg=${ev.uuid || ''}`);
  else console.log('EVENT', JSON.stringify(ev));

  // Parent's phone leg answered
  if (ev.status === 'answered' && ev.direction === 'inbound' && ev.uuid) {
    session.parentLeg = ev.uuid;
    session.conversationUuid = ev.conversation_uuid || session.conversationUuid;
    // Nothing is reset here: the answer webhook already did that for this call. If the story
    // has already been chosen and we are reading to an empty room, the keypad starts now.
    if (session.unattended) await listenToKeypad('reading to an empty room');
    broadcastState();
  }

  // Child's app leg answered -> the story begins: listen to the parent's keypad
  if (ev.status === 'answered' && ev.direction === 'outbound' && ev.to === session.userLoggedIn && session.parentLeg) {
    mark('page', { page: 0 });
    session.unattended = false; // the child made it after all
    await listenToKeypad('the child answered');
    broadcastState();
  }

  // The ring to the storybook ended without being answered, so the NCCO is about to read on
  // into the unattended tail. The session has to agree, or the reading that follows is filed as
  // an ordinary call: no page numbers spoken back, recording marked already-seen, no story
  // waiting in the morning - exactly what the fallthrough exists to provide.
  const GAVE_UP = ['timeout', 'unanswered', 'rejected', 'busy', 'failed', 'cancelled'];
  if (
    GAVE_UP.includes(ev.status) &&
    ev.direction === 'outbound' &&
    ev.to === session.userLoggedIn &&
    session.parentLeg &&
    !session.unattended
  ) {
    console.log(`Nobody answered the storybook (${ev.status}) - reading to the empty room instead`);
    session.unattended = true;
    session.page = 0;
    try {
      // The recording started before the connect and keeps running, so the caller's reading is
      // captured either way; this only replaces what they hear next.
      await vonage.voice.transferCallWithNCCO(session.parentLeg, unattendedTail(activeStory()));
    } catch (e) {
      console.error('Could not offer the empty-room read:', e?.response?.data || e.message);
    }
    await listenToKeypad('the storybook did not answer');
    broadcastState();
  }

  if (ev.status === 'completed' && ev.uuid && ev.uuid === session.parentLeg) {
    console.log(session.unattended ? 'Parent finished reading to the empty room' : 'Parent hung up');
    // The recording webhook usually lands after this, and sometimes after the *next* call has
    // already begun and reset the session. Keep what the recording needs to be filed correctly.
    session.finished = {
      unattended: session.unattended,
      storyId: session.storyId,
      timeline: [...session.timeline],
      parentNumber: session.parentNumber,
    };
    session.parentLeg = null;
    session.dtmfSubscribed = false;
    io.emit('call:ended');
    broadcastState();
  }
});

// ---------- keypad -> storybook ----------
app.post('/voice/dtmf', (req, res) => {
  res.sendStatus(200);
  const b = req.body || {};
  const pressed = String(b.dtmf?.digits ?? b.digits ?? b.digit ?? '').trim();
  if (!pressed) return console.log('DTMF webhook with no digit:', JSON.stringify(b));
  console.log('KEYPAD:', pressed);

  // Pressed quickly, several digits can arrive in one webhook. Replaying them in order means
  // a fast "##" turns two pages instead of matching nothing and being dropped.
  const pageCount = activeStory().pages.length;
  for (const digit of pressed.split('')) {
    if (digit === '#') session.page = Math.min(session.page + 1, pageCount - 1);
    else if (digit === '*') session.page = Math.max(session.page - 1, 0);

    if (digit === '#' || digit === '*') mark('page', { page: session.page });
    else {
      mark('keypad', { digit });
      io.emit('effect', { key: digit });
    }
    io.emit('keypad', { digit });

    // Reading to an empty room, the caller has no screen and no child to react. Without a word
    // back they cannot tell whether the page turned at all, so the page number is spoken into
    // their leg — the same per-leg TTS the child's messages use.
    if (session.unattended && session.parentLeg) {
      const spoken =
        digit === '#' || digit === '*'
          ? `Page ${session.page + 1}.`
          : activeStory().effects?.[digit]?.label || '';
      if (spoken) {
        vonage.voice
          .playTTS(session.parentLeg, { text: spoken, language: 'en-US' })
          .catch((e) => console.warn('page confirmation not spoken:', e?.message));
      }
    }
  }
  broadcastState();
});

// ---------- recording saved -> download, notify caregiver ----------
app.post('/voice/recording', async (req, res) => {
  res.sendStatus(200);
  const r = req.body || {};
  console.log('RECORDING ready:', r.recording_url);
  const file = `${r.recording_uuid || Date.now()}.mp3`;
  // Prefer the snapshot taken at hang-up; fall back to the live session if the recording
  // arrived first.
  const done = session.finished || {
    unattended: session.unattended,
    storyId: session.storyId,
    timeline: session.timeline,
    parentNumber: session.parentNumber,
  };
  session.finished = null;
  const entry = {
    file,
    url: `/recordings/${file}`,
    uuid: r.recording_uuid,
    start: r.start_time,
    end: r.end_time,
    size: r.size,
    events: [...done.timeline],
    parent: done.parentNumber,
    story: done.storyId,
    unattended: done.unattended,
    seen: !done.unattended, // a story read live has already been heard
  };
  try {
    await vonage.voice.downloadRecording(r.recording_url, path.join(RECORDINGS_DIR, file));
    console.log('Recording downloaded ->', entry.url);
  } catch (e) {
    console.error('download failed:', e?.response?.data || e.message);
    entry.url = null;
  }
  session.recordings.push(entry);
  io.emit('recording', { count: session.recordings.length, unattended: entry.unattended });
  if (entry.unattended) {
    const told = STORIES.find((st) => (st.id || 'default') === entry.story) || STORIES[0];
    console.log(`A story is waiting for ${CHILD_NAME} in the morning.`);
    io.emit('waiting-story', { title: told.title, parent: PARENT_NAME });
  }
  broadcastState();

  if (CAREGIVER_NUMBER && vonageNumber) {
    try {
      const { SMS } = require('@vonage/messages');
      await vonage.messages.send(
        new SMS({
          to: CAREGIVER_NUMBER,
          from: vonageNumber,
          text: `Once Upon a Call: tonight's story "${activeStory().title}" was read to ${CHILD_NAME} and saved. Replay it anytime in the storybook.`,
        })
      );
      console.log('Caregiver SMS sent');
    } catch (e) {
      console.warn('Caregiver SMS not sent (US SMS may need 10DLC registration):', e?.response?.data?.title || e.message);
    }
  }
});

// Client posts its word-highlight timeline at the end of a call; merge into the latest recording
app.post('/api/timeline', (req, res) => {
  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  const target = session.recordings[session.recordings.length - 1];
  if (target) target.events = [...target.events, ...events].sort((a, b) => a.t - b.t);
  else session.timeline.push(...events);
  res.json({ ok: true, merged: events.length });
});

// ---------- AR world -> parent's ear ----------
app.post('/api/say', async (req, res) => {
  const text = (req.body?.text || '').slice(0, 200);
  if (!session.parentLeg) return res.status(409).json({ error: 'no parent on the line' });
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    await vonage.voice.playTTS(session.parentLeg, { text, language: 'en-US' });
    mark('sent', { text });
    console.log('Said to parent:', text);
    res.json({ ok: true });
  } catch (e) {
    console.error('playTTS failed:', e?.response?.data || e.message);
    res.status(500).json({ error: 'tts failed' });
  }
});

// ---------- misc API ----------
app.get('/api/story', (req, res) => {
  // ?id= reads a specific book without changing which one is active — replay needs the story
  // the recording was made from, which may not be tonight's.
  const id = String(req.query.id || '');
  const raw = id && STORIES.find((st) => (st.id || 'default') === id);
  res.json(raw ? personalise(raw) : activeStory());
});

// The shelf, and the child's way of choosing from it.
app.get('/api/stories', (req, res) =>
  res.json({
    active: session.storyId,
    stories: STORIES.map((s) => ({
      id: s.id || 'default',
      title: s.title,
      character: s.character || 'dragon',
      pages: s.pages.length,
    })),
  })
);

app.post('/api/story/select', (req, res) => {
  if (session.parentLeg) return res.status(409).json({ error: 'not while a story is being read' });
  if (!setStory(String(req.body?.id || ''), 'chosen in the storybook')) {
    return res.status(404).json({ error: 'no such story' });
  }
  res.json({ ok: true, active: session.storyId });
});
app.get('/api/info', (req, res) => {
  const story = activeStory();
  const d = String(vonageNumber || '').replace(/\D/g, '');
  const phoneFormatted =
    d.length === 11 && d.startsWith('1') ? `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : d ? `+${d}` : '';
  res.json({
    phone: d,
    phoneFormatted,
    title: story.title,
    childName: story.childName,
    parentName: story.parentName,
    pinRequired: !!FAMILY_PIN && APPROVED_NUMBERS.length > 0,
  });
});
app.get('/api/state', (req, res) => res.json({ ...publicState(), parentLeg: session.parentLeg }));

// Pre-flight: one call that says whether tonight's demo will work, so nothing is a surprise.
app.get('/api/health', (req, res) => {
  const checks = {
    vonageApp: !!appId && !!privateKey,
    phoneNumber: !!vonageNumber,
    publicUrl: !BASE_URL.includes('localhost'),
    childAppOnline: childOnline(),
    captions: !!process.env.DEEPGRAM_API_KEY,
    callerAllowList: APPROVED_NUMBERS.length > 0,
    familyPin: !!FAMILY_PIN,
    savedStories: session.recordings.length,
    storiesOnShelf: STORIES.length,
  };
  const required = ['vonageApp', 'phoneNumber', 'publicUrl'];
  res.json({ ready: required.every((k) => checks[k]), baseUrl: BASE_URL, checks });
});
app.get('/api/asr-key', (req, res) => res.json({ key: process.env.DEEPGRAM_API_KEY || null }));
app.get('/api/replay/latest', (req, res) => {
  // Prefer a recording whose audio actually landed on disk, but fall back to the most recent
  // one either way: the page turns and highlights are ours and replay fine on their own, so a
  // slow upload or a failed download degrades the keepsake instead of breaking it.
  const reversed = [...session.recordings].reverse();
  // A story read to an empty room is the one the child has not heard; it wins over anything
  // they were present for.
  const latest =
    reversed.find((r) => r.unattended && !r.seen && r.url) ||
    reversed.find((r) => r.unattended && !r.seen) ||
    reversed.find((r) => r.url) ||
    session.recordings[session.recordings.length - 1];
  if (!latest) return res.status(404).json({ error: 'no recording yet' });
  latest.seen = true;
  broadcastState();
  const startTime = Date.parse(latest.start) || (latest.events[0]?.t ?? Date.now());
  res.json({
    audioUrl: latest.url || null,
    startTime,
    events: latest.events,
    unattended: !!latest.unattended,
    story: latest.story || session.storyId,
    parentName: PARENT_NAME,
  });
});
app.get('/api/recordings', (req, res) =>
  res.json(session.recordings.map(({ events, ...r }) => ({ ...r, events: events.length })))
);

io.on('connection', (socket) => {
  socket.emit('state', publicState());

  // Only the storybook itself announces; the caregiver page and the printable card also hold
  // sockets and must not make a closed storybook look open.
  socket.on('storybook:ready', (payload) => {
    // After `npm start` the browser is still open and still holds a live Vonage session, but
    // this process has forgotten the username it needs to ring it. Take it from the client.
    if (!session.userLoggedIn && payload?.user) {
      session.userLoggedIn = String(payload.user);
      console.log(`Storybook re-introduced itself as ${session.userLoggedIn}`);
    }
    session.storybooks.add(socket.id);
    const open = session.storybooks.size;
    console.log(`Storybook open (${open} on this server)`);
    if (open > 1) {
      // Every tab signs in as the same Client SDK user. The newest session takes that user over
      // and the older tab's leg dies mid-connect - which looks from the phone exactly like the
      // child never picking up, so the caller is told nobody is there while someone is sitting
      // in front of the storybook.
      console.warn(`!! ${open} storybooks are open on the same user (${session.userLoggedIn || '?'}).`);
      console.warn('   They fight over the call and the older tab drops mid-answer.');
      console.warn('   Close all but one before dialling.');
    }
    broadcastState();
  });

  socket.on('disconnect', () => {
    if (session.storybooks.delete(socket.id)) {
      console.log(`Storybook closed (${session.storybooks.size} left)`);
      broadcastState();
    }
  });
});

// A Codespaces port that is forwarded but Private answers the browser with GitHub's own 404 and
// answers Vonage with nothing at all - the webhooks just never arrive, the phone rings into
// silence, and there is no error anywhere to explain it. Cheap to check, so check it at boot and
// say exactly how to fix it rather than letting it surface mid-demo.
async function checkPubliclyReachable() {
  if (!/^https:/.test(BASE_URL)) return; // localhost: nothing to prove

  // A freshly opened tunnel is not reachable the instant it prints its URL - a cloudflared quick
  // tunnel takes the better part of ten seconds to come up. Checking once would fail on a setup
  // that is merely still starting, and a false alarm here sends you debugging the wrong thing.
  let code = 0;
  let last = '';
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(`${BASE_URL}/api/health`, { signal: ctl.signal, redirect: 'manual' });
      clearTimeout(t);
      code = r.status;
      if (code === 200) break;
    } catch (e) {
      code = 0;
      last = e.message;
    }
    if (attempt < 6) await new Promise((r) => setTimeout(r, 2500));
  }
  if (code === 200) {
    console.log(`Public URL reachable (${BASE_URL}) - Vonage can call in.`);
    return;
  }
  if (!code && last) console.warn(`Could not reach ${BASE_URL} from here (${last}).`);
  console.warn('');
  console.warn(`!! ${BASE_URL} is NOT publicly reachable${code ? ` (HTTP ${code})` : ''}.`);
  console.warn('   Vonage webhooks will never arrive and the browser will show a 404.');
  if (process.env.PUBLIC_URL) {
    console.warn('   Check that the tunnel is still up and PUBLIC_URL matches its address.');
  } else if (process.env.CODESPACE_NAME) {
    console.warn('   Fix it with:');
    console.warn(`     gh codespace ports visibility ${port}:public -c $CODESPACE_NAME`);
    console.warn(`   or Ports tab -> ${port} -> right-click -> Port Visibility -> Public.`);
    console.warn('   If the port is already Public, the Codespace tunnel itself is broken:');
    console.warn('     npm run demo    (tunnels from this machine instead, no GitHub relay)');
  } else {
    console.warn('   Check PUBLIC_URL and that your tunnel is running.');
  }
  console.warn('');
}

server.listen(port, () => {
  console.log(`Once Upon a Call listening on ${port}`);
  checkPubliclyReachable();
});
