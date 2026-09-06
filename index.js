// Once Upon a Call — server
// A parent on any plain phone dials in; the child sees them in an AR storybook.
//
// Vonage Voice API features used:
//   1. Client SDK in-app leg    — the child's WebXR app answers the call     (/token, connect{app})
//   2. NCCO input (DTMF)        — family PIN, and choosing tonight's story from the shelf
//   3. NCCO record              — every story saved as a keepsake             (/voice/recording)
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
const BASE_URL =
  process.env.PUBLIC_URL ||
  (process.env.CODESPACE_NAME
    ? `https://${process.env.CODESPACE_NAME}-${port}.app.github.dev`
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
  timeline: [], // { t, type, data } during the live story (server-side events)
  recordings: [], // { file, url, uuid, start, end, size, events }
};

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
  return {
    page: session.page,
    storyId: session.storyId,
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
  res.json({ token });
});

// ---------- NCCO builders ----------
// Offered before the story starts, and only when there is more than one book on the shelf.
// The parent has no screen, so the shelf is read to them and chosen with the same keypad that
// will turn the pages a moment later.
function menuNCCO() {
  const choices = STORIES.slice(0, 9)
    .map((s, i) => `Press ${i + 1} for ${s.menuLabel || s.title}.`)
    .join(' ');
  return [
    {
      action: 'talk',
      language: 'en-US',
      bargeIn: true,
      text: `Welcome to Once Upon a Call. Tonight you can read ${CHILD_NAME} one of ${STORIES.length} stories. ${choices}`,
    },
    {
      action: 'input',
      type: ['dtmf'],
      dtmf: { maxDigits: 1, timeOut: 8 },
      eventUrl: [`${BASE_URL}/voice/story-choice`],
    },
  ];
}

function storyNCCO(from) {
  const story = activeStory();
  if (!session.userLoggedIn) {
    return [
      {
        action: 'talk',
        language: 'en-US',
        text: `${story.childName}'s storybook isn't open yet. Please try again in a moment.`,
      },
    ];
  }
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
      endpoint: [{ type: 'app', user: session.userLoggedIn }],
    },
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
    session.parentNumber = from;
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
    return res.json(STORIES.length > 1 ? menuNCCO() : storyNCCO(req.body.from));
  }
  return res.json([{ action: 'talk', language: 'en-US', text: "That PIN isn't right. Goodbye." }]);
});

// Keypad choice from menuNCCO. No input, or a digit off the end of the shelf, quietly keeps
// whatever was already selected — a parent who says nothing still gets a story.
app.post('/voice/story-choice', (req, res) => {
  const digit = String(req.body?.dtmf?.digits || '').trim();
  const picked = STORIES[Number(digit) - 1];
  if (picked) setStory(picked.id || 'default', `chosen on the keypad: ${digit}`);
  else console.log(`Story menu: no usable choice (${digit || 'timeout'}), keeping ${session.storyId}`);
  res.json(storyNCCO(req.body?.from));
});

// ---------- call lifecycle ----------
app.all('/voice/event', async (req, res) => {
  const ev = req.body || {};
  res.sendStatus(200);
  if (ev.status) console.log(`EVENT ${ev.status} ${ev.direction || ''} to=${ev.to || ''} leg=${ev.uuid || ''}`);
  else console.log('EVENT', JSON.stringify(ev));

  // Parent's phone leg answered
  if (ev.status === 'answered' && ev.direction === 'inbound' && ev.uuid) {
    session.parentLeg = ev.uuid;
    session.conversationUuid = ev.conversation_uuid;
    session.page = 0;
    session.timeline = [];
    broadcastState();
  }

  // Child's app leg answered -> the story begins: listen to the parent's keypad
  if (ev.status === 'answered' && ev.direction === 'outbound' && ev.to === session.userLoggedIn && session.parentLeg) {
    mark('page', { page: 0 });
    try {
      await vonage.voice.subscribeDTMF(session.parentLeg, `${BASE_URL}/voice/dtmf`);
      console.log('Listening to keypad on parent leg', session.parentLeg);
    } catch (e) {
      console.error('subscribeDTMF failed:', e?.response?.data || e.message);
    }
    broadcastState();
  }

  if (ev.status === 'completed' && ev.uuid && ev.uuid === session.parentLeg) {
    console.log('Parent hung up');
    session.parentLeg = null;
    io.emit('call:ended');
    broadcastState();
  }
});

// ---------- keypad -> storybook ----------
app.post('/voice/dtmf', (req, res) => {
  res.sendStatus(200);
  const b = req.body || {};
  const digit = String(b.dtmf?.digits ?? b.digits ?? b.digit ?? '').trim();
  if (!digit) return console.log('DTMF webhook with no digit:', JSON.stringify(b));
  console.log('KEYPAD:', digit);

  const pageCount = activeStory().pages.length;
  if (digit === '#') session.page = Math.min(session.page + 1, pageCount - 1);
  else if (digit === '*') session.page = Math.max(session.page - 1, 0);

  if (digit === '#' || digit === '*') mark('page', { page: session.page });
  else {
    mark('keypad', { digit });
    io.emit('effect', { key: digit });
  }
  io.emit('keypad', { digit });
  broadcastState();
});

// ---------- recording saved -> download, notify caregiver ----------
app.post('/voice/recording', async (req, res) => {
  res.sendStatus(200);
  const r = req.body || {};
  console.log('RECORDING ready:', r.recording_url);
  const file = `${r.recording_uuid || Date.now()}.mp3`;
  const entry = {
    file,
    url: `/recordings/${file}`,
    uuid: r.recording_uuid,
    start: r.start_time,
    end: r.end_time,
    size: r.size,
    events: [...session.timeline],
    parent: session.parentNumber,
  };
  try {
    await vonage.voice.downloadRecording(r.recording_url, path.join(RECORDINGS_DIR, file));
    console.log('Recording downloaded ->', entry.url);
  } catch (e) {
    console.error('download failed:', e?.response?.data || e.message);
    entry.url = null;
  }
  session.recordings.push(entry);
  io.emit('recording', { count: session.recordings.length });
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
app.get('/api/story', (req, res) => res.json(activeStory()));

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
    childAppOnline: !!session.userLoggedIn,
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
  const withAudio = [...session.recordings].reverse().find((r) => r.url);
  const latest = withAudio || session.recordings[session.recordings.length - 1];
  if (!latest) return res.status(404).json({ error: 'no recording yet' });
  const startTime = Date.parse(latest.start) || (latest.events[0]?.t ?? Date.now());
  res.json({ audioUrl: latest.url || null, startTime, events: latest.events });
});
app.get('/api/recordings', (req, res) =>
  res.json(session.recordings.map(({ events, ...r }) => ({ ...r, events: events.length })))
);

io.on('connection', (socket) => {
  socket.emit('state', publicState());
});

server.listen(port, () => console.log(`Once Upon a Call listening on ${port}`));
