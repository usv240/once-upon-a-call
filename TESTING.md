# End-to-end test plan

Everything below is what actually happens, taken from the code — the terminal lines are the real
`console.log` strings and the phone prompts are the real TTS text. If you see something different,
that is a bug worth reporting, not a typo here.

**Setup for all of it:** laptop = the child's side (Chrome + the Codespace URL). Your phone = the
parent's side. Plug **headphones into the laptop** or the phone's mic will pick up the laptop
speakers and loop your own voice back at you.

---

## 0. Start clean

In the Codespace terminal:

```bash
git pull && npm install && npm start
```

**Expect, in this order:**

```
Public base URL: https://<your-codespace>-3000.app.github.dev
Approved callers: (open demo mode)
Family PIN: not set
Story library: dragon, rabbit, boat
Once Upon a Call listening on 3000
```

- `Story library:` **must** read `dragon, rabbit, boat` in that order. Any other order means the
  `order` field in a story file is wrong and the keypad menu will read them out wrong.
- If port 3000 is not **Public** in the Ports tab, Vonage cannot reach your webhooks and nothing
  else in this document will work.

Then check the box is demo-ready:

```bash
curl -s localhost:3000/api/health
```

**Expect** `"ready": true`, and:

| Field | Should be | If not |
|---|---|---|
| `vonageApp` | `true` | `.env` is missing `API_APPLICATION_ID` / `PRIVATE_KEY` |
| `phoneNumber` | `true` | `VONAGE_PHONE_NUMBER` not set |
| `publicUrl` | `true` | you are on localhost; Vonage can't reach you |
| `childAppOnline` | `false` for now | becomes `true` once you open the app |
| `captions` | `true` | `false` = no Deepgram key, words won't light up (everything else still works) |
| `storiesOnShelf` | `3` | a story file failed to parse — check for a `Skipping unreadable story` warning |

---

## 1. The preview — no phone needed

Open the Codespace app URL in Chrome. **Hard-refresh (Ctrl+Shift+R)** — you will be testing stale
JavaScript otherwise, which has wasted more time on this project than any real bug.

**Expect on screen:** the moon, "Once Upon a Call", the phone number in gold, a **▶ Watch the
story** button, three story cards with the dragon highlighted, and the keypad legend reading
`# Next page · * Back a page · 1 Dragon roar · 2 Twinkle · 3 Moon hum`.

**Expect the status pill** to say `Ready — waiting for a story call` with a blue dot. If it says
`Server disconnected` in red, the server isn't running or the port isn't public.

**Expect in the browser console (F12):**

```
Once Upon a Call — init
Session created successfully. Session ID: <uuid>
```

Now click **▶ Watch the story**.

| What | Expected |
|---|---|
| Console | `Preview narration voice: <some voice name> — N available` |
| Audio | A voice reads page 1 aloud |
| The book | Words light up **in time with the voice**, not ahead of or behind it |
| Illustration | The dragon wiggles on "dragon", the cave glows on "cave" |
| Pages | Turns itself through all 4, then: *"That is the whole story. Now give the number to someone far away."* |
| Button | Becomes **▶ Watch again** when it finishes |

**If you hear nothing** but the pages still turn: the console will say
`Preview: speech synthesis produced no audio; pacing the highlight instead` and the banner will
read *"no speech voice available"*. That means your machine has no TTS voices installed — the
visual tour still completes, which is by design.

---

## 2. The shelf

Click **The Rabbit Who Waited for the Moon**.

**Expect:** it becomes the highlighted card, and **the keypad legend changes** to
`1 Rabbit thump · 2 Twinkle · 3 Moon hum`. Click the boat and it becomes `1 Foghorn · 3 Sea hum`.

If the legend does not change, it is reading stale JavaScript — hard-refresh.

Click **▶ Watch the story** again and confirm you get *the rabbit*, not the dragon. Set it back
to **the dragon** before the call test so the rest of this matches.

---

## 3. The live call

Tick **Auto‑answer (for little ones)** on the landing page first — your hands will be full holding
the phone.

Confirm the server now sees you: `curl -s localhost:3000/api/health` → `"childAppOnline": true`,
and the terminal shows `Storybook open (1 on this server)`.

**Dial `+1 201 890 3507` from your phone.**

### 3a. The story menu

**Expect to hear:**

> *"Welcome to Once Upon a Call. Choose tonight's story for Maya. Press 1 for the little dragon
> who couldn't sleep. Press 2 for the rabbit who waited for the moon. Press 3 for the little boat
> that sailed home. Take your time; press a number when you are ready."*

**Terminal:** `NCCO request: { ... from: '<your number>' ... }`

**Press 2** (Android: tap **Keypad** in the call screen first).

You can press **during** the prompt — it barges in, so you never have to sit through the whole
menu once you know it.

**If you press nothing**, you get 10 seconds and then it asks a second time rather than choosing
for you:

> *"Let's try that again. Press 1 for… Press 2 for… Press 3 for… Or stay on the line for the
> little dragon who couldn't sleep."*

Terminal: `Story menu: nothing pressed, asking again`. Pressing a digit with no story behind it
(say `7`) gets the same second chance. Only after two misses does it proceed with the dragon:
`Story menu: no choice after 2 attempts, keeping dragon`.

**Worth testing deliberately:** let it time out twice and confirm you end up in the dragon story
rather than the call dropping.

**Expect:**

- Terminal: `Story set to "The Rabbit Who Waited for the Moon" (chosen on the keypad: 2)`
- **The laptop shelf switches to the rabbit before a word is read.** This is your best shot for
  the video.
- Then: *"Opening The Rabbit Who Waited for the Moon. Press pound to turn the page, star to go
  back, and one, two or three for surprises."*

### 3b. Connecting

**Terminal:**

```
EVENT started outbound to= leg=...
EVENT ringing ...
EVENT answered inbound to= leg=<parent leg uuid>
EVENT answered outbound to=xr_user_1 leg=...
Listening to keypad on parent leg <uuid> (the child answered)
```

`Listening to keypad` is the important one — **no keypad line means `#` will do nothing.**

**On the laptop:** the guide collapses, the storybook appears, a lip-synced avatar appears to its
left, and the status reads `Story time!`.

**Browser console:** `Call audio: context running, boost x2.5, element muted`

### 3c. Reading

Read page 1 out loud, slowly.

| What | Expected |
|---|---|
| Audio | You hear yourself through the laptop (delayed — that's normal) |
| Avatar | Its mouth moves while you talk |
| Words | Light up as you say them |
| Caption strip | Shows what you just said, under the illustration |
| Banner | `Listening — words light up as they are read` |

**If the voice is too quiet:** reload with `?gain=4` on the URL. `?gain=1` turns the boost off.
**If words don't light up:** you have no Deepgram key — the banner says
`Reading along (add a Deepgram key to light up words)`. Everything else still works.

---

## 4. The keypad

With the call live, press each of these and check **both** the terminal and the screen.

| Press | Terminal | On screen |
|---|---|---|
| `#` | `KEYPAD: #` | Page 2 of 4, banner `Dad turned the page (#)` |
| `#` | `KEYPAD: #` | Page 3 |
| `*` | `KEYPAD: *` | Back to page 2 |
| `1` | `KEYPAD: 1` | Rabbit's ears twitch, banner `Dad pressed 1: Rabbit thump`, a low sound |
| `2` | `KEYPAD: 2` | Stars twinkle rapidly |
| `3` | `KEYPAD: 3` | The moon appears / rings, even on pages that don't normally show one |

**Every one of 1, 2 and 3 must visibly change the picture on every page.** Six of these used to do
nothing; if you find another, that's a real bug.

The status pill on the landing page should track: `Story time — page 2 of 4`.

---

## 5. The child sends something back

On the laptop, click **⭐ Hug** in the panel to the right of the book.

| What | Expected |
|---|---|
| Terminal | `Said to parent: Maya just sent you a big hug.` |
| **Your phone** | A voice says *"Maya just sent you a big hug."* |
| Laptop | Status `Sent to Dad 💛`, stars twinkle, banner shows what was sent |

**This is the moment to film.** Hold the phone to the camera so the mic catches it. Note that
*only the phone hears it* — the laptop does not play it. That is the point of per-leg TTS.

---

## 6. Hang up and the keepsake

**Hang up the phone.**

**Terminal — the two lines that matter:**

```
Parent hung up
RECORDING ready: https://api.nexmo.com/v1/files/<uuid>
Recording downloaded -> /recordings/<uuid>.mp3
```

- If the third line says `download failed: ...` instead, **paste it to me** — replay will still
  work visually but without audio.
- `Caregiver SMS not sent (US SMS may need 10DLC registration)` is expected and harmless unless
  you set `CAREGIVER_NUMBER`.

**Laptop:** banner `Tonight's story is saved 📖`, status pill turns purple: `Tonight's story is
saved`.

Now click **Replay** in the 3D panel.

**Expect:** the recording plays and the pages turn and words light up **in time with your voice** —
the same timeline, replayed. Banner: `Replaying Dad's story from last time`.

Also open `/caregiver.html` in a new tab: the story should be listed with a player and a
**⬇ Save this story** link.

---

## 7. The one that matters — nobody answers

This is the headline feature and the thing to rehearse most.

**Close the laptop tab entirely.**

**Terminal:** `Storybook closed (0 left)` — this is what makes the next part work. Confirm with
`curl -s localhost:3000/api/health` → `"childAppOnline": false`.

**Call the number again.** Choose a story at the menu as before.

**Expect to hear — no ringing, no waiting:**

> *"Maya isn't at the storybook right now. You can still read tonight's story and it will be
> waiting in the morning, with the pages turning in your voice. The Little Dragon Who Couldn't
> Sleep. Press pound when you finish each page. Hang up when you're done."*

**Terminal:** `Listening to keypad on parent leg <uuid> (reading to an empty room)`

Now read a page aloud and **press `#`**.

| What | Expected |
|---|---|
| Terminal | `KEYPAD: #` |
| **Your phone** | A voice says *"Page 2."* |

That spoken page number is your only feedback — there is no screen and no child reacting. Read a
couple more pages, pressing `#` between them, then **hang up**.

**Terminal:**

```
Parent finished reading to the empty room
RECORDING ready: ...
Recording downloaded -> /recordings/<uuid>.mp3
A story is waiting for Maya in the morning.
```

**Now reopen the app in the browser.**

| Where | Expected |
|---|---|
| Landing page | An amber notice: **"Dad read you a story last night."** Open the storybook and press play. |
| 3D panel | The button now reads **`Dad read you a story`** in warm orange — not "Replay" |
| Status | `Dad left you a story` |

Click that button.

**Expect:** the recording plays, the pages turn where you pressed `#`, and the banner reads
**`Dad read you this last night, while you were asleep`**.

Then check the notice **disappears** — it has been heard now. `curl -s localhost:3000/api/state`
should show `"waitingStories": 0`.

---

## 8. The PIN gate (optional, for one video shot)

In `.env`:

```
APPROVED_NUMBERS=<a number that is NOT your phone>
FAMILY_PIN=2468
```

Restart (`npm start`) and call from your phone.

**Expect:** *"Welcome to Once Upon a Call. Please enter your family PIN, followed by pound."*
Terminal shows `PIN entered: ****`. Enter `2468#` and the story menu follows. Enter anything else
and you get *"That PIN isn't right. Goodbye."*

**Remember to clear both values afterwards** or your own phone will be locked out of every other test.

---

## 9. The automated suites

None of these need a Vonage account, a phone, or credentials.

```bash
npm test                  # story data + narration sync + the whole call flow
```

**Expect:** `ALL PREVIEW CHECKS PASSED` then `ALL FLOW CHECKS PASSED` (21 checks — it boots a real
server with a throwaway key and drives every webhook the way Vonage would).

```bash
npm run fixture &         # static server on :3210
npm run test:browser      # needs Chrome installed
```

**Expect:** `ALL LAYOUT CHECKS PASSED`, `ALL PAGE CHECKS PASSED`, `ALL ART CHECKS PASSED`,
`ALL EFFECT CHECKS PASSED`. It writes `expanded.png` / `compact.png` to look at.

---

## When something is wrong

| Symptom | Cause | Fix |
|---|---|---|
| `user cannot be empty or NULL` | You called before the browser got a token | Open the app, wait for `Session created successfully`, then dial |
| Call connects but `#` does nothing | No `Listening to keypad` line in the terminal | Hang up and call again; if it persists, paste the `subscribeDTMF failed` line |
| No audio from the call | AudioContext suspended by autoplay policy | Click anywhere on the page, or reload with `?gain=1` |
| Voice too quiet | Default boost too low for your setup | Reload with `?gain=4` |
| Scene looks tiny on a big monitor | 3D size is angular, not pixel-based | Reload with `?dist=0.9` |
| Menu chose for you before you could press | You need the in-call dialpad open first | Tap **Keypad** as soon as the call connects; you now get two 10s windows |
| Old button labels / stale behaviour | Cached JavaScript | **Ctrl+Shift+R**. This is the single most common cause of "it's broken" |
| `Cannot find module ...` | Dependencies changed | `npm install` |
| Unattended path won't trigger | A storybook tab is still open somewhere | Close all tabs; terminal must say `Storybook closed (0 left)` |
| `TypeError: xb.SpatialPanel is not a constructor` | XR Blocks was upgraded | The importmap is pinned to `595aeb64` on purpose — do not bump it |

## What to send me if something fails

The terminal from `NCCO request:` through to `Recording downloaded ->`, plus the browser console.
Those two together identify almost anything in this list.
