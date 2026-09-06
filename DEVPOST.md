# Devpost submission copy

## Project name
Once Upon a Call

## Tagline
A live AR bedtime story, read over any phone — for every parent who can only phone home.

## Lens explored
**Access** (a plain phone becomes a way into a child's world) and **Connection** (the parent is *in the room*, not in a handset). Play shows up in the keypad-controlled illustrations.

## Try it in 90 seconds
Open the app and press **▶ Watch the story** — it narrates the whole book with page turns, word
highlighting and illustration effects, no phone required. Then, if you have a phone handy, call
the number on screen and do it for real.

## Inspiration
2.7 million US kids have a parent in jail or prison tonight. 250,000 more have a parent deployed. Add hospital stays and overseas work, and you get a huge group of parents whose only channel home is a plain voice call — often from a payphone or a landline with no screen at all. Existing "read to your kid remotely" apps need video on both ends; prison and military programs mail a recorded CD weeks later. We wanted the parent to be *present*, live, tonight, from the phone they already have.

## What it does
The call opens with a menu read aloud — *"press 1 for the little dragon who couldn't sleep, 2 for the rabbit who waited for the moon, 3 for the little boat that sailed home"* — so the parent picks tonight's book from a keypad, having never seen a screen. Then the story begins.

The parent dials a phone number. In the child's bedroom (AR headset, or a tablet/laptop in fallback), the parent appears as a lip-synced avatar next to a floating storybook. As they read, the words light up. Pressing **#** on their keypad turns the page, **\*** goes back, and **1/2/3** make the dragon roar, the stars twinkle, the moon hum. The child taps a star and the parent hears — in their ear only — *"Maya just sent you a big hug."* And if nobody is at the storybook when they call, it does not hang up. Whoever is calling may have booked that slot days ago — a prison phone allowance, a satellite window — so they are invited to read anyway. Vonage records it, their keypad still turns the pages into the timeline, and the page number is spoken back into their ear so they know it worked. In the morning the child opens the book to *"Dad read you a story last night"* and it plays back with the pages turning in his voice. A missed connection is never a wasted call.

Every story is recorded and can be replayed with the page turns and highlights in sync, for nights when the parent can't call. Live captions of the parent's speech run under the illustration, so a deaf or hard-of-hearing child can read along with a parent they cannot hear. Callers not on the family list are asked for a family PIN.

## How we built it
- **Vonage Voice API** — Client SDK in-app leg (the XR app answers the call), NCCO `talk`/`input`/`record`/`connect`, two different DTMF surfaces — a blocking NCCO `input` to choose the story before it starts, then an **asynchronous DTMF** subscription so keypad presses arrive as webhooks *during* the call, **per-leg text-to-speech** (`PUT /calls/{uuid}/talk`) so the child's messages are heard by the parent only, recording download for replay, and a Messages API SMS to the caregiver (wired and optional — US A2P traffic needs 10DLC registration, so the app logs and carries on when the carrier rejects it).
- **XR Blocks + three.js** — spatial panels and avatar from the DIALED IN workshop; a canvas-textured storybook with procedural illustrations that react to keywords and keypad.
- **Deepgram streaming ASR** on the parent's audio stream (forked from the same WebRTC stream that drives the lip-sync) for word-by-word highlighting.
- Node/Express + socket.io server, GitHub Codespaces for public webhooks.

## Challenges
XR Blocks shipped a breaking release (v0.20) days after the workshop — `SpatialPanel` and the simulator add-on disappeared from the CDN, so the workshop code stopped loading. We pinned to the exact August build and moved on. Vonage's async-DTMF webhook payload isn't documented in detail, so the handler is written to tolerate several shapes. And we designed the whole thing so it degrades gracefully: no headset → simulator; no ASR key → no highlighting but everything else works.

## Accomplishments
A phone keypad from any decade controls an AR scene. The AR scene talks back down the phone line. A parent with nothing but a phone can read a picture book *with* their child, not *at* a recorder — and on the night the child is already asleep, they read it anyway and it is waiting in the morning.

## Testing
Five suites, all runnable without a Vonage account. The whole call flow — answer webhook, story menu, the unattended NCCO, DTMF, recording, the morning replay — is driven end to end against the real server with a throwaway key. The layout is verified in a real browser
at 390 / 1280 / 1920 / 3840 px in both overlay states. Every page of every story is rendered to
a canvas and checked for blank illustrations — which caught a refactor that had silently deleted
the dragon. The narration's word-sync maths, the story data, and the companion pages are all
tested too.

## What we learned
The Voice API's "boring" primitives — DTMF, per-leg TTS, record, conversation — are the ones that reach the most people, because they work on every phone ever made. And designing for the caller's *time* rather than their device is what produced the best feature in the build: the story that gets through even when nobody picks up.

## What's next
Pilot with United Through Reading and prison family-literacy programs; per-family rooms keyed by dialed number; a larger shelf (adding a story is a JSON file, not code); licensed picture books; caregiver approval of new callers via Vonage Verify; illustrator-drawn scenes.

## Vonage Voice API features used
Client SDK (in-app voice), NCCO `talk` / `input` (DTMF) / `record` / `connect` / `conversation`, asynchronous DTMF
event subscription, per-leg TTS (`PUT /v1/calls/{uuid}/talk`), recording download, call event
webhooks, Users API, and the Messages API for the caregiver SMS (optional; subject to 10DLC).
