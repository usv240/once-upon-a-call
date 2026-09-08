# Once Upon a Call 📖📞

**A live AR bedtime story, read over any phone.**

Some parents can't be home at bedtime — and the only thing they have is a plain phone. A soldier on deployment. A mom in a hospital bed. A dad working abroad. A parent in jail. No video, no app, no internet. Just a number they can dial.

Once Upon a Call turns that phone call into a *presence*. The parent dials in from any phone on Earth. In the child's room (AR headset, or a laptop/phone in fallback), the parent appears beside the bed with a floating storybook. As they read, the words light up. When they press **#** on their keypad, the page turns. When they press **1**, the dragon roars. The child taps a star and the parent hears, in their ear only: *"Maya just sent you a big hug."* Every story is recorded, so on nights the parent can't call, the child can replay it — pages turning in time with their voice.

> **No phone handy?** Open the app and press **▶ Watch the story**. It narrates the whole book
> with page turns, word highlighting and illustration effects — the same code paths a real call
> drives — so you can see the entire experience without dialling anything.

### The story that gets through anyway

Whoever is calling may have booked this slot days ago: a prison phone allowance, a satellite
window, a ward's one cordless handset. So if nobody is at the storybook — the app was never
opened, or the child is already asleep — the call **does not hang up**. The caller is told the
child isn't there, and invited to read anyway. Vonage records it, their keypad still turns the
pages into the timeline, and the page number is spoken back into their ear so they know it
registered. In the morning the child opens the book to *"Dad read you a story last night"*, and
it plays back with the pages turning in his voice.

It costs the caller nothing but the time they had already set aside, and it means a missed
connection is never a wasted call.

### The shelf

Three stories ship with it, and the parent chooses one from their keypad before the reading
starts — the titles are read aloud, they press a digit. A caregiver can also pick on the
child's screen beforehand; whoever chooses last wins, and saying nothing simply keeps the
current book.

| Story | Character | For the child who… |
|---|---|---|
| The Little Dragon Who Couldn't Sleep | 🐉 | can't settle at bedtime |
| The Rabbit Who Waited for the Moon | 🐰 | is waiting for someone to come back |
| The Little Boat That Sailed Home | ⛵ | has a parent working far away |

Adding a fourth is a writing job, not a drawing job: drop a JSON file in `static/stories/`
naming a scene per page from the art engine's vocabulary, and it appears in the keypad menu,
on the shelf and in the printed card with no code change. `npm test` will tell you if you
name a scene or a keyword that can never fire.

Built for the **DIALED IN Builder Challenge** (CreateHER Fest × Vonage), Washington DC cohort.
Lenses: **Access** and **Connection** (with a good helping of Play).

---

## Why this matters

| Who | Scale | What they have today |
|---|---|---|
| Children with an incarcerated parent | ~2.7 M in the US (1 in 28) [[1]](#references) | 15-min voice calls; recorded-story programs mailed on CD weeks later |
| Children with a deployed parent | ~250 K per year; "40 million missed stories a year" [[2]](#references) | Pre-recorded video via United Through Reading story stations |
| Children of hospitalized / overseas-working parents | — | Video calls *if* both sides have devices, data, and privacy |

Family contact is not a nicety: in the Minnesota DOC study of 16,400 people, any family visit cut felony re-conviction by **13 %** [[3]](#references), and frequent phone contact lowers parenting stress and improves post-release attachment [[4]](#references). Pennsylvania's DOC spent **$680 K** on VR family visits [[5]](#references) — proof of institutional demand — but their model needs a headset *inside* the facility. Ours needs only the phone the parent already has.

Existing products (Caribu, Readeo, Storybook Dads, United Through Reading) are either **video on both ends** or **recorded and one-way**. Nothing is live, two-way, and phone-only on the parent's side. That's the gap.

---

## How it works

```
Parent's phone ──PSTN──▶ Vonage number (+1 201 890 3507)
                          │  NCCO: talk (welcome) → [input PIN if not approved]
                          │        → input (choose tonight's story) → record → connect{app}
                          ▼
                 Child's WebXR app (Vonage Client SDK leg, XR Blocks)
                          │
   Vonage async DTMF ─────┼──▶ /voice/dtmf ──▶ socket.io ──▶ page turn / effect in AR
   Parent's audio  ───────┼──▶ lip-synced avatar  +  Deepgram streaming ASR ──▶ words light up
   Child taps ⭐  ────────┼──▶ /api/say ──▶ PUT /calls/{parentLeg}/talk ──▶ only the parent hears it
   Keypad at the menu ────┼──▶ /voice/story-choice ──▶ tonight's book, chosen without a screen
   Hang-up ───────────────┴──▶ /voice/recording ──▶ mp3 downloaded ──▶ Replay mode (+ SMS to caregiver)

   Nobody answers? ───────▶ talk + record + conversation ──▶ the caller reads to an empty room;
                                            keypad still writes the timeline, page numbers are
                                            spoken back, and the child finds it in the morning.

   No phone to hand?  ▶ Watch the story ──▶ browser speech synthesis narrates the same book,
                                            driving the same highlight / effect / page code.
```

### Vonage Voice API features used (and why)

| Feature | Where | Purpose |
|---|---|---|
| **Client SDK in-app voice** | `static/VonageAudioCall.js`, `/token` | The child's XR app is a call leg; the WebRTC stream drives the lip-sync avatar |
| **NCCO `talk`** | `/voice/answer` | Welcome + keypad instructions for a screenless caller |
| **NCCO `input` (DTMF)** | `/voice/answer`, `/voice/pin`, `/voice/story-choice` | Family PIN gate for numbers not on the allow-list, and choosing tonight's book from a menu read aloud — the parent picks a story without ever seeing a screen |
| **NCCO `record`** | `/voice/answer`, `/voice/recording` | Every story becomes a keepsake |
| **NCCO `conversation`** | `unattendedTail()` | Holds the line open when nobody answers, so the caller can read to an empty room instead of losing a slot they waited a week for |
| **Asynchronous DTMF** (`PUT /calls/{uuid}/input/dtmf`) | `subscribeDTMF`, `/voice/dtmf` | A 1970s keypad becomes an AR controller: `#` next page, `*` back, `1-3` effects |
| **Per-leg TTS** (`PUT /calls/{uuid}/talk`) | `/api/say`, `/voice/dtmf` | The AR world talks back *only* into the parent's ear — the child's messages, and the page number when they are reading to an empty room and have no other feedback |
| **Recording download** | `downloadRecording` | Replay without exposing credentials to the browser |
| **Messages API** (optional) | `/voice/recording` | Caregiver SMS when a story is saved |

### Other tech
- **XR Blocks** (Google) — WebXR framework from the workshop: spatial panels, hand/mouse interaction, depth, desktop simulator. Pinned to build `595aeb64` (pre-0.20 API).
- **three.js** canvas-textured storybook with procedural illustrations (no assets to load).
- **Deepgram** streaming ASR (optional) for word-by-word highlighting.
- **socket.io** for server → XR events.

---

## Run it

Prerequisites: a Vonage API account with a voice-enabled number, Node 20+.

```bash
git clone https://github.com/usv240/once-upon-a-call
cd once-upon-a-call
npm install
cp .env.example .env      # fill in Vonage app id, private key (base64), number
npm start                 # http://localhost:3000
npm run demo              # tunnel + webhooks + server, one command
```

Vonage must be able to reach your server. On GitHub Codespaces the public URL is derived automatically, but the port is forwarded **Private** by default — which answers Vonage with nothing and your browser with a 404. Run `gh codespace ports visibility 3000:public -c $CODESPACE_NAME`. The server checks this for you at boot and prints the command if it is still closed. Locally, run `ngrok http 3000` and set `PUBLIC_URL`. Point your Vonage application's **answer** webhook to `<PUBLIC_URL>/voice/answer` (GET) and **event** webhook to `<PUBLIC_URL>/voice/event` (POST) — the included `setup-project.js` does this for Codespaces.

Optional `.env`:
```
CHILD_NAME=Maya                             # spoken in the menu and on the last page
PARENT_NAME=Dad                             # who the child is sending messages to
APPROVED_NUMBERS=17045551234,17045556789   # who may enter the child's room
FAMILY_PIN=2468                             # everyone else is asked for this
CAREGIVER_NUMBER=17045551234                # SMS when a story is saved
DEEPGRAM_API_KEY=...                        # live word highlighting
```

Handy URL parameters: `?gain=3` makes the parent's voice louder (`?gain=1` turns the boost off),
`?dist=0.9` brings the storybook closer, which helps when filming on a large monitor.

### Pre-flight

`GET /api/health` answers "will tonight's demo work?" in one call — whether the Vonage app and
number are configured, whether the public URL is reachable from outside, whether the child's app
has a live token, and whether captions, the allow-list and the PIN are switched on.

```bash
curl -s localhost:3000/api/health | jq
```

### Using it
0. **Without a phone:** press **▶ Watch the story** on the landing page (or **▶ Preview** in the
   3D panel) for the narrated tour.
1. Open the app, allow the microphone, click **OPEN THE STORYBOOK** (headset: enters AR; laptop: XR Blocks simulator).
2. From any phone, call the Vonage number. Answer in the app.
3. Parent reads. **#** turns the page, **\*** goes back, **1/2/3** trigger surprises.
4. Child taps **⭐ Hug** (or any message) — the parent hears it.
5. Hang up → the story is saved. **Replay last story** plays it back with page turns and highlights in sync.
6. If nobody answers, keep reading anyway — the story is kept and the child finds it in the morning.

---

## Project layout

```
index.js                  Express + socket.io server, all Vonage webhooks and APIs
static/VonageAudioCall.js XR Blocks script: call UI, avatar, storybook wiring, replay
static/Storybook.js       Canvas-textured AR book: text highlighting + living illustration
static/StoryListener.js   Deepgram streaming ASR from the call's remote stream + reading tracker
static/stories/*.json     The shelf. One file per story: pages, scene per page,
                          keyword → effect map, keypad effects, menu label
static/main.js            XR Blocks bootstrap
pages/index.html          Import map (XR Blocks pinned), Client SDK, socket.io
```

## Tests

```bash
npm test              # story data, narration sync, and the whole call flow — no browser, no Vonage account
npm run fixture &     # static server on :3210 (no Vonage credentials required)
npm run test:browser  # layout + companion pages + illustrations + keypad effects, in your installed Chrome
```

**`test/flow.test.js`** boots the real `index.js` with a throwaway RSA key and drives it exactly
as Vonage would: answer webhook, story menu, the keypad choice, the unattended NCCO, call
events, DTMF, the recording webhook, and the morning replay. It asserts the NCCO actually
contains what it must — that `connect` has a ring timeout and a fallback behind it, that the
`conversation` holds the line, that a fast `##` turns two pages. Outbound calls to Vonage fail
against the fake credentials on purpose: the flow has to survive that, and the test proves it
does.

**`test/preview.test.js`** covers the one piece of the preview tour that fails invisibly when
it is wrong: mapping a speech-synthesis character offset to a word index. Browsers disagree on
whether that offset lands on a word's first letter or the space before it, and a drifting
highlight looks like a rendering glitch rather than a bug. It also asserts every keyword in
every story actually occurs in its own page text, that every page names a scene the art
engine can draw, and that no `{placeholder}` would be read aloud literally.

**`test/layout.test.js`** loads the landing overlay at 390 / 1280 / 1920 / 3840 px wide, in both
the expanded-guide and compact-top-bar states, and fails if any two blocks overlap, anything is
`position: fixed` (the bug that used to pull the overlay apart), anything overflows the viewport,
the compact bar grows past a thin strip, or the "Watch the story" button is missing or too small
to hit. It writes `expanded.png` / `compact.png` for a visual check. Edit `CHROME` at the top of
the file if your Chrome lives somewhere else.

**`test/art.test.js`** renders every page of every story in a real browser, fires every effect
that page can fire, runs a few animation frames and counts how much non-paper ink landed on
the canvas. The illustrations are procedural, so a typo in `drawRabbit` does not crash
anything — it just draws nothing, and nobody notices until a judge is watching the video.
This check caught exactly that: a refactor silently removed `drawDragon`.

**`test/effects.test.js`** presses 1, 2 and 3 on every page of every story and fails if the
picture does not actually change. Whether a keypad effect is visible depends on the scene —
"stars twinkle" needs stars, "moon hum" needs a moon — so on a cave or a storm the banner
appeared and the beep played while nothing moved. It found six such dead keypresses; the art
now brings the moon out and breaks the storm rather than ignoring the press.

**`test/pages.test.js`** smoke-tests the caregiver and printable parent-card pages for console
errors and missing content.

`test/serve-fixture.js` exists so the browser tests run on a laptop with no `.env` — `index.js`
correctly refuses to boot without real Vonage credentials.

## Testing it by hand

[`TESTING.md`](TESTING.md) walks the whole thing end to end — what to click, what the terminal
should print at each step, what the phone should say, and what each failure means. The expected
output in it is taken from the code rather than from memory.

## Safety & privacy
- Only approved numbers (or callers with the family PIN) can enter the child's room.
- Recordings stay on the family's server; they are never sent to third parties. The optional ASR key is only used on the child's device for the parent's audio.
- No secrets in the repo (`.env`, `private.key`, `recordings/` are git-ignored).

## Path to the real world
- **Pilot partners**: United Through Reading (300+ story stations on bases), Storybook Dads / Project Bedtime Story (prison reading programs), children's hospitals' child-life departments.
- **Where it runs**: any WebXR device (Android XR, Quest browser) or a plain laptop/phone — the *child's* side can be a $150 tablet; the *parent's* side is any phone, including institutional phone systems that allow approved numbers.
- **Next**: multiple families (per-child rooms keyed by the number dialed), licensed picture books alongside the original ones, illustrator-drawn scenes, and a Vonage Verify flow for caregivers to approve new callers by SMS.

## References
1. The Sentencing Project, *Parents in Prison* (2022). https://www.sentencingproject.org/app/uploads/2022/09/Parents-in-Prison.pdf
2. United Through Reading, *Our Impact*. https://unitedthroughreading.org/about/our-impact/
3. Minnesota Department of Corrections, *The Effects of Prison Visitation on Offender Recidivism* (2011). https://mn.gov/doc/assets/11-11PrisonVisitationResearchinBrief-Final_tcm1089-272782.pdf
4. Poehlmann-Tynan et al., *Young Children's Contact with their Parents in Jail and Child Behavior Problems*. https://pmc.ncbi.nlm.nih.gov/articles/PMC11449473/
5. Pennsylvania DOC, *Virtual Reality Technology to Augment Programming for Incarcerated Parents and Their Children*. https://www.pa.gov/agencies/cor/about-us/newsroom/newsroom/department-of-corrections-introduces-virtual-reality-technology-to-augment-programming-for-incarcerated-parents-and-their-children
6. Vonage Voice API docs — WebSockets, DTMF, NCCO reference. https://developer.vonage.com/en/voice/voice-api/overview
7. Google XR Blocks. https://xrblocks.github.io/

## License
MIT — built on the CreateHER Fest × Vonage WebXR workshop starter by Dwane Hemmings.
