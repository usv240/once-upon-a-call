# Demo video — shooting script

**Target 4:35. Hard max 5:00.** Every line in **SAY** is meant to be read aloud as written.
Short sentences on purpose — they are easier to deliver and easier to follow.

**The one sentence this whole video is trying to leave in a judge's head:**

> *"That was the project where a parent can read to their child from literally just a phone — and
> even if the kid misses the call, the story is waiting in the morning."*

Not *"that was the AR storybook project."* If a cut makes that sentence harder to arrive at, don't
make the cut.

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

## Beat 1 — The problem (0:00–0:25)

**SHOW:** Black screen, or a still of a payphone / a hospital bedside phone.

> **SAY:** "For some parents, bedtime happens from far away. A parent deployed overseas. A parent in a hospital bed. A parent in prison. And sometimes the only thing they have is a phone call."

*Beat. Then, slower:*

> **SAY:** "No video. No app. No internet on their side. Just a phone."

*Don't rush this. The silence after "just a phone" is doing work.*

*Named people land faster than numbers. A judge who is still doing arithmetic in the first ten
seconds is not yet listening to what you built.*

---

## Beat 2 — The idea (0:25–0:45)

**SHOW:** Cut to the storybook, open, waiting. **POINT AT** the status line reading **`Waiting for a story call…`**

> **SAY:** "Once Upon a Call turns that phone call into a bedtime story the child can see. The parent needs nothing but a phone. Any phone. A flip phone, a payphone, a prison handset. This is what's in the child's room."

---

## Beat 3 — The call, and choosing the book (0:45–1:25)

**DO:** Hold the phone in frame. Dial the Vonage number. **Let the phone audio play out loud.**

**EXPECT to hear:**
> *"Welcome to Once Upon a Call. Choose tonight's story for Maya. Press 1 for the little dragon who couldn't sleep. Press 2 for the rabbit who waited for the moon. Press 3 for the boat that sailed through the storm. Take your time; press a number when you are ready."*

**DO:** Press **2**.

**POINT AT** the shelf on screen — the card switches to *The Rabbit Who Waited for the Moon* before a single word is read.

> **SAY:** "The parent picks tonight's book from a keypad menu. They never see a screen. And watch — the shelf changes on the child's side before the story even starts."

**EXPECT:** the call connects. The avatar appears beside the book. Its mouth moves when you talk.

> **SAY:** "This is a real phone call through Vonage. The parent's ordinary phone is now connected directly to the child's storybook."

*Resist naming PSTN, the Client SDK and WebXR here. Four unfamiliar terms in one sentence and the
judge is decoding instead of watching. Beats 4 to 6 earn the technical credit anyway.*

---

## Beat 4 — Reading, and the words lighting up (1:25–2:00)

**DO:** Read page one aloud into the phone, slowly.

**POINT AT** the words as they highlight.

> **SAY:** "The parent's voice does two jobs at once. It drives the avatar's mouth, and it feeds a live transcription — so each word lights up as it's read. The child follows along in their parent's actual voice."

**DO:** Say the word **"moon"** clearly.

**EXPECT:** the illustration reacts.

> **SAY:** "And the picture is listening for the story's own words."

---

## Beat 5 — The keypad becomes the controller (2:00–2:40)

**DO:** Hold the phone up so the keypad is visible. Press **#**.

**EXPECT:** the page turns on screen.

> **SAY:** "Press pound — the page turns."

**DO:** Press **1**.

**EXPECT:** the effect fires.

> **SAY:** "Press one — a surprise in the picture."

**DO:** Press **\***. **EXPECT:** page goes back.

**DO:** Keep the phone and the screen in one shot for a moment — the keypad and the book together.

> **SAY:** "The parent has no app. No browser. Just a phone keypad — and that keypad is controlling the child's augmented-reality storybook in real time."

**CUT TO TERMINAL for about three seconds.** **POINT AT** the `KEYPAD:` lines scrolling past.

> **SAY:** "Vonage's asynchronous DTMF turns every key press into an event the WebXR experience can respond to."

*Say what is impressive before you say how it was done. Reverse the order and a non-technical
judge is still parsing "DTMF" when the moment has already passed.*

---

## Beat 6 — The room answers back (2:40–3:05)

**DO:** Click **⭐ Hug** on screen. Hold the phone to the camera and **let it play out loud.**

**EXPECT to hear:**
> *"Maya just sent you a big hug."*

> **SAY:** "And it goes both ways. The child taps a star, and text-to-speech is played into the parent's leg of the call only. Nobody else on that line hears it. It's just for them."

---

## Beat 7 — The one that matters (3:05–4:00)

> **This is your differentiator. Slow down. Give it room.**

> **SAY:** "But here's the thing about a scheduled call. You don't always get to choose when it happens. The child might be asleep."

*This phrasing also keeps the beat general. "Fifteen minutes" was prison-specific; a scheduled
call covers a deployment window, a ward's one cordless handset, and a shift on the other side of
the world just as well.*

**DO:** *(cut to the separate take)* **Let the audio play.**

*Setting this shot up - the empty room has to be genuinely empty, and the server decides that
before it decides anything else:*

1. **Close every storybook tab.** Closed, not minimised - a hidden tab still holds its socket and
   still counts as a storybook someone could answer.
2. The terminal prints `Storybook closed (0 left)`.
3. Confirm: `curl -s localhost:3000/api/health` shows `"childAppOnline":false`.
4. **Now dial.** The menu plays first, so press **2** straight away - barge-in cuts the prompt and
   takes you into the line below with no dead air to edit out.

*If you hear the story open normally instead, a tab was still open. Close it and redial; nothing
you do mid-call can move a connected call onto this path.*

**EXPECT to hear:**
> *"Maya isn't at the storybook right now. You can still read tonight's story and it will be waiting in the morning, with the pages turning in your voice. The Rabbit Who Waited for the Moon. Press pound when you finish each page. Hang up when you're done."*

> **SAY:** "The call doesn't fail. It doesn't hang up. It invites them to read anyway."

**DO:** Read a page aloud. Press **#**.

**EXPECT:** the phone says *"Page 2."*

> **SAY:** "Vonage records it. The keypad still marks every page turn. And the page number is spoken back, so a parent reading into an empty room knows it registered."

**DO:** Hang up. **CUT TO TERMINAL.** **POINT AT** `Recording downloaded -> /recordings/`

> **SAY:** "A missed connection is never a wasted call."

---

## Beat 8 — The morning (4:00–4:15)

**DO:** Open the storybook. **POINT AT** the banner offering last night's story. Click **Replay**.

**EXPECT:** the recording plays, and the pages turn in time with it.

> **SAY:** "In the morning, the child opens the book — and hears last night's story in their dad's own voice, with every page turning exactly where he turned it."

---

## Beat 9 — Close (4:15–4:35)

**SHOW:** the storybook, quiet.

> **SAY:** "No smartphone. No data plan. No app on the parent's side. Once Upon a Call takes the simplest thing in communications — a phone call — and turns it into presence in a child's room."

*Stop there. Let it sit.*

**END CARD:**

> ### Once Upon a Call
> *Be there for bedtime, from any phone.*
>
> `github.com/usv240/once-upon-a-call`

*The last thing on screen should be the product, not the stack. The judge already believes you can
build it — beats 3 through 8 proved that. What you want them carrying out of the room is what it
is for.*

---

## If you're short on time

Cut in this order: **Beat 4** (shorten to 15s), then **Beat 6**, then **Beat 8**.
**Never cut Beat 7.** It is the reason this project wins.
