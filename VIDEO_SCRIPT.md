# Demo video — shooting script

**Target 4:15. Hard max 5:00.** Every line in **SAY** is meant to be read aloud as written.
Short sentences on purpose — they are easier to deliver and easier to follow.

## The four things the rubric wants (Rules.md)

| Criterion | Where this script earns it |
|---|---|
| **Technical Execution** — "is the Voice API *meaningfully* integrated" | Beats 3, 4, 5 — a real PSTN call, async DTMF driving AR, per-leg TTS, recording |
| **Creativity & Originality** — "an unexpected use case" | Beat 7 — the unattended read. This is the beat that wins. |
| **Real-World Potential** — "a clear problem, a real user" | Beats 1 and 9 |
| **Presentation Quality** — "understand what you built, why, and how" | The whole thing, and why nothing here is longer than it needs to be |

## Before you hit record

- `npm run demo` running. Wait for **`Public URL reachable`** before anything else.
- Chrome full-screen on the storybook. Terminal on a second window you can cut to.
- **Headphones in the laptop** or the phone will pick up the laptop speakers and echo.
- Phone's in-call dialpad already open before you dial — you don't want to film yourself hunting for it.
- **Film Beat 7 separately, as its own take.** It needs a second call with the storybook closed. Cut it in.
- If anything breaks: press **▶ Watch the story**. It drives the same page-turn, highlight and effect code. Never film a broken take.

---

## Beat 1 — The problem (0:00–0:20)

**SHOW:** Black screen, or a still of a payphone / a hospital bedside phone.

> **SAY:** "Tonight, two point seven million children in the United States have a parent in prison. A quarter of a million have a parent deployed overseas. For those kids, the thing that reaches home isn't an app. It's a phone call. Fifteen minutes on a handset, and no screen on the other end."

*Don't rush this. The silence after "no screen on the other end" is doing work.*

---

## Beat 2 — The idea (0:20–0:40)

**SHOW:** Cut to the storybook, open, waiting. **POINT AT** the status line reading **`Waiting for a story call…`**

> **SAY:** "Once Upon a Call turns that phone call into a bedtime story the child can see. The parent needs nothing but a phone. Any phone. A flip phone, a payphone, a prison handset. This is what's in the child's room."

---

## Beat 3 — The call, and choosing the book (0:40–1:20)

**DO:** Hold the phone in frame. Dial the Vonage number. **Let the phone audio play out loud.**

**EXPECT to hear:**
> *"Welcome to Once Upon a Call. Choose tonight's story for Maya. Press 1 for the little dragon who couldn't sleep. Press 2 for the rabbit who waited for the moon. Press 3 for the boat that sailed through the storm. Take your time; press a number when you are ready."*

**DO:** Press **2**.

**POINT AT** the shelf on screen — the card switches to *The Rabbit Who Waited for the Moon* before a single word is read.

> **SAY:** "The parent picks tonight's book from a keypad menu. They never see a screen. And watch — the shelf changes on the child's side before the story even starts."

**EXPECT:** the call connects. The avatar appears beside the book. Its mouth moves when you talk.

> **SAY:** "That's a real phone call over the public telephone network, through the Vonage Voice API, answered by the Vonage Client SDK running inside a WebXR app."

---

## Beat 4 — Reading, and the words lighting up (1:20–1:55)

**DO:** Read page one aloud into the phone, slowly.

**POINT AT** the words as they highlight.

> **SAY:** "The parent's voice does two jobs at once. It drives the avatar's mouth, and it feeds a live transcription — so each word lights up as it's read. The child follows along in their parent's actual voice."

**DO:** Say the word **"moon"** clearly.

**EXPECT:** the illustration reacts.

> **SAY:** "And the picture is listening for the story's own words."

---

## Beat 5 — The keypad becomes the controller (1:55–2:30)

**DO:** Hold the phone up so the keypad is visible. Press **#**.

**EXPECT:** the page turns on screen.

> **SAY:** "Press pound — the page turns."

**DO:** Press **1**.

**EXPECT:** the effect fires.

> **SAY:** "Press one — a surprise in the picture."

**DO:** Press **\***. **EXPECT:** page goes back.

**CUT TO TERMINAL for about three seconds.** **POINT AT** the `KEYPAD:` lines.

> **SAY:** "That's Vonage's asynchronous DTMF. Every key press comes off the live call as a webhook, straight into the 3D scene. A nineteen-seventies keypad, driving an augmented reality storybook, with no app on the parent's side at all."

---

## Beat 6 — The room answers back (2:30–2:55)

**DO:** Click **⭐ Hug** on screen. Hold the phone to the camera and **let it play out loud.**

**EXPECT to hear:**
> *"Maya just sent you a big hug."*

> **SAY:** "And it goes both ways. The child taps a star, and text-to-speech is played into the parent's leg of the call only. Nobody else on that line hears it. It's just for them."

---

## Beat 7 — The one that matters (2:55–3:50)

> **This is your differentiator. Slow down. Give it room.**

> **SAY:** "But here's the thing about those fifteen minutes. You don't get to choose when they happen. The call is scheduled. The child might be asleep."

**DO:** *(cut to the separate take)* Storybook closed. Dial the number. **Let the audio play.**

**EXPECT to hear:**
> *"Maya isn't at the storybook right now. You can still read tonight's story and it will be waiting in the morning, with the pages turning in your voice. The Rabbit Who Waited for the Moon. Press pound when you finish each page. Hang up when you're done."*

> **SAY:** "The call doesn't fail. It doesn't hang up. It invites them to read anyway."

**DO:** Read a page aloud. Press **#**.

**EXPECT:** the phone says *"Page 2."*

> **SAY:** "Vonage records it. The keypad still marks every page turn. And the page number is spoken back, so a parent reading into an empty room knows it registered."

**DO:** Hang up. **CUT TO TERMINAL.** **POINT AT** `Recording downloaded -> /recordings/`

> **SAY:** "A missed connection is never a wasted call."

---

## Beat 8 — The morning (3:50–4:05)

**DO:** Open the storybook. **POINT AT** the banner offering last night's story. Click **Replay**.

**EXPECT:** the recording plays, and the pages turn in time with it.

> **SAY:** "In the morning, the child opens the book — and hears last night's story, with the pages turning in their dad's own voice, exactly where he turned them."

---

## Beat 9 — Close (4:05–4:20)

**SHOW:** the storybook, quiet.

> **SAY:** "Voice is the one channel that reaches everywhere. No smartphone, no data plan, no app store. Once Upon a Call takes the humblest thing in communications — a phone call — and turns it into presence in a child's room. Built with the Vonage Voice API, in the browser."

**END CARD:** `Once Upon a Call` · `github.com/usv240/once-upon-a-call`

---

## If you're short on time

Cut in this order: **Beat 4** (shorten to 15s), then **Beat 6**, then **Beat 8**.
**Never cut Beat 7.** It is the reason this project wins.
