# PairUp launch film: storyboard

The submission video is a 2:51 product launch film, cut to an original electro-swing arrangement of Offenbach's *Galop infernal* (the can-can). Every scene change, title slam and card entrance lands on the music's beat grid. The real app supplies every product frame. Motion graphics carry the story between them. The build is reproducible from `scripts/video/`, and [VIDEO_HANDOFF.md](VIDEO_HANDOFF.md) holds the method and labelling rules.

## What the film has to prove

Judges score technical implementation, design, potential impact and quality of idea, and each entered track must appear in the video. The film answers those in that order of feeling: a relatable need, one sentence that solves it, a complete deal, the hand-off, services, context, the engineering underneath, the size of the opportunity, and a memorable close.

| Judging question | Where the film answers it |
|---|---|
| Quality of idea | Cold open (a real campus need), the reveal, "things and services, one sentence" |
| Design | Real app cards inside the film's own art direction; one visual motif (two circles that find each other) |
| Technical implementation | Private limits, the Rust/WASM price rule with its real code, schedule checks, Ring arrival, the architecture run and live evidence |
| Potential impact | Fees kept by sellers, independent earners, opening a business in one sentence, a fair meeting place for agents |
| Alexa+ | A simulated Alexa+ voice conversation with MCP Apps cards from the real server |
| Ring | PairUp Point: doorbell press, both check-ins, "Both here" |
| Bee | A Bee-format note prepared into a request and approved on the watch |
| AWS Builder | Bedrock Nova and Titan, CloudFront, EC2 Graviton, CloudWatch, live checks |
| Open Source | pairing-core: MIT, Rust compiled to WebAssembly, its settle rule on screen |

## Art direction: "Cabaret Night"

The film has its own look, separate from the app's iris theme. It reads as a Paris cabaret poster restaged as a modern product keynote.

- **Palette.** Ink `#0D0A0B` and Velvet `#1C1215` backgrounds; Rouge `#FF4532` is the hero color; Cream `#F7EBD9` is the text and paper color; Marigold `#FFC23D` marks prices and successes; Cobalt `#3A55FF` appears only in the engineering act. The app's own screens keep their real colors inside the device frames.
- **Type.** Anton for slammed headlines, Instrument Serif Italic for the voice of the brand ("Say it once."), Space Grotesk for labels, JetBrains Mono for code and evidence.
- **Texture.** Animated film grain, a soft vignette, halftone dots and sunburst rays drawn in code, plus red and cream kick-line stripes for wipes.
- **Motif.** Two circles, the buyer and the seller, drift toward each other through the film and merge on every deal. They become the PairUp mark in the title and the end card.
- **Camera.** Slow push-ins on devices, 3D tilt on phones, whip pans with motion blur on scene changes and a scale punch on every downbeat of a drop.

## Music and sound

- **Arrangement.** *Galop infernal* (Offenbach, 1858; public domain) arranged from the score at 150 BPM in 4/4: a minor-key music-box version for the cold open, a full brass-and-drums drop for the title, a half-time groove under the narration, a mini drop on the deal, a doorbell breakdown for Ring, a heavy synth drop for the engineering act and a final chorus a whole step higher. Every instrument and effect is synthesized in `scripts/video/music.py`, so the score and its rights are ours.
- **Sound design.** Whooshes on whip pans, impacts on slams, UI ticks on card entrances, a cash-register sparkle on the deal, a two-tone doorbell, confetti pops, a riser before each drop and a reversed cymbal into the final chorus.
- **Voices.** Narrator: Ava (young, expressive US English). Characters: Sam, Mei and Tony are separate voices with a light phone-speaker tone, and PairUp's spoken reply uses its own calm voice. The music ducks under every line.
- **Master.** -14 LUFS integrated, -1 dBTP, for YouTube.

## Timeline

1 bar = 1.6 s (150 BPM, 4/4). Bars are counted from zero. The narration is the script; on-screen text is in small caps.

| Bars (time) | Scene | Picture | Sound and voice |
|---|---|---|---|
| 0–8 (0:00–0:13) | **Cold open: 11:47 PM** | Ink screen, a flip clock at 11:47 PM, a group chat filling with "anyone have a TI-84??" and "Seen by 43". A map of the UW campus at night: one red dot (you, McCarty Hall), one cream dot (a calculator in the next dorm), 200 m apart. The screen falls to black on "say it". | Ticking clock, minor-key music box, riser. "It's eleven forty-seven at night. Your exam is at nine." "And somewhere in the next dorm, the calculator you need is sitting in a drawer." "What if you could just… say it?" |
| 8–12 (0:13–0:19) | **Drop: title** | The two dots collide into the PairUp mark on the downbeat; PAIRUP slams in letter by letter, one letter per beat, over rotating sunburst rays; "Say it once." writes itself in serif italic. | Full can-can drop, crash, impact. "Meet PairUp!" in a stop-time break. |
| 12–20 (0:19–0:32) | **What it is** | Three cards kick in on the beat: ITEM "Sell my TI-84", ERRAND "Bring my lunch to McCarty Hall", JOB "Help at my event Saturday". A Seattle/UW pin drops. | Half-time groove. "PairUp pairs people who need something with people who have it, or can help. Things and services, right here at UW in Seattle." "Tell Alexa+ once, and PairUp finds your pair." |
| 20–26 (0:32–0:42) | **The seller** | Sam's phone in 3D tilt: his words type into the app, the reply arrives, and the real listing card shows "Private · Minimum $15". A padlock snaps shut over $15. Badge: SIMULATED ALEXA+ EXPERIENCE · DEMO MARKET. | Sam: "Sell my TI-84 for twenty dollars. I'll take anything above fifteen." "Sam sets his limit once. His fifteen-dollar floor stays private." |
| 26–34 (0:42–0:54) | **The buyer and the rule** | Mei's phone: her request, then the real match card (TI-84, $18, Amazon Hub Counter, demo location). The price rail animates: ask $20, Mei's budget $18, Sam's locked minimum; `price = min(ask, buyer_max)` from pairing-core lands the marker on $18. | Mei: "I need a graphing calculator in good condition near UW campus today. Max eighteen." "Her standing request meets his listing instantly. Our open price rule settles it at eighteen dollars, with a meeting spot right on campus." |
| 34–38 (0:54–1:01) | **Deal** | Both phones side by side. Mei says yes in a stop-time break and the band answers as her card turns Confirmed; Sam's phone lights up with the agreed deal (his delegated limit was his yes); the two circles merge into DEAL with gold confetti. | Mei: "Yes!" Hit. Notification. Hit. Full theme, cash-register sparkle. "They pay each other at the hand-off." |
| 38–48 (1:01–1:17) | **Ring: PairUp Point** | A Ring doorbell at the HUB north entrance, drawn in line art; each press rings out in rings of light. The real card moves from "on the way" to "checked in" to "Both here. Go ahead with the hand-off." The watch preview shows the same state. Badge: LOCAL SIMULATED WEBHOOK. | Breakdown with doorbell chime. "Meeting a stranger? Pick a PairUp Point: one Ring doorbell by the HUB. No staff needed." "Each doorbell press confirms an arrival, and PairUp keeps only the event type and time." PairUp: "Both here. Go ahead with the hand-off." |
| 48–60 (1:17–1:36) | **Services** | A route draws itself from the HUB to McCarty Hall. Priya posts lunch runs at $4 live, and Tony's request pairs with her: the real card shows $4 per job and the time waiting for the helper. The real event-help card: Saturday 2–6 PM Pacific, $10/hr, $40 total, waiting for the helper. A week grid snaps the booking into place; an overlapping block shakes and bounces off. | Groove returns. "And it books people, too!" Tony: "Find someone to pick up my lunch from the HUB to McCarty Hall by twelve thirty. Five dollars." "Event help on Saturday, two to six? Ten dollars an hour, forty total, in Pacific time." "The whole shift has to fit the helper's hours, bookings never overlap, and the helper gives the final yes." |
| 60–68 (1:36–1:49) | **Context** | A three-week calendar of Tony's lunch runs lights up day by day; the real For you dock offers "Your usual: pick up my lunch" at 11:38 AM. A Bee note card ("exam tomorrow, need a calculator") folds into a ready request, then the watch preview asking for the budget. Badge: SYNTHETIC BEE-FORMAT FIXTURE · WATCH PREVIEW. | "PairUp even learns your routine. Three weeks of lunch runs? It offers the next one before noon." "A Bee note about tomorrow's exam becomes a ready request, waiting for your yes, right on your wrist." |
| 68–82 (1:49–2:11) | **Engineering drop** | The palette turns cobalt. An architecture run lights node by node on the beat: Alexa+ → MCP server (2025-11-25) → Bedrock Nova + Titan → pgvector + full-text → pairing-core (Rust → WASM) → Postgres transaction → MCP Apps card. The real tool list scrolls past. An evidence wall stamps in: 175/175 tests, CI green, release check 9/9, Titan 1024-d, Nova tool use, CloudFront · EC2 Graviton · CloudWatch. | Heavy synth drop. "Under the hood: a production MCP server, ready for Alexa+ and any agent." "Amazon Bedrock reads what people mean. Nova understands each request, and Titan embeddings power hybrid search." "Then code takes over. Our Rust price rule, compiled to WebAssembly, settles every deal in exact cents." "Live on AWS. A hundred seventy-five tests, all green." |
| 82–94 (2:11–2:30) | **Impact** | Giant numbers slam on downbeats: 13–20% fees stamped out by 100% TO THE SELLER; 72.9M Americans earning independently; a one-line "business" typed in a speech bubble; then many agents (small circles) converging on one PairUp mark, each pair ending in a human check. | Building groove. "Resale sites keep up to twenty percent. On PairUp, the seller keeps every dollar." "Seventy-three million Americans already earn on their own. Here, opening a business takes one sentence." "And as personal agents start shopping for us, PairUp gives them a fair place to meet. An open rule sets the price. A human says yes." |
| 94–106 (2:30–2:50) | **Finale** | pairing-core on GitHub (MIT, Rust/WASM) and a UW pilot pin; then the key change: kick-line wipe, the two circles merge one last time into the mark, PAIRUP and "Say it once." End card with the repository links and ALEXA+ · RING · BEE · AWS · OPEN SOURCE. | Final chorus up a whole step, classic can-can ending. "The price rule is open source, so anyone can check it. Next stop: a real pilot, right here at UW." "PairUp." in the silent gap before the drop; "Say it once!" in the rest before the final chord. |

## Truth in every frame

- Product frames are screenshots of the real app, captured by `scripts/video/studio/capture/capture.mjs` from a fresh local market (the seed data, AUTH_MODE=none, mock AI mode). The local build's developer badge is hidden, matching the deployed app.
- App scenes carry SIMULATED ALEXA+ EXPERIENCE and DEMO MARKET. The Ring scene carries LOCAL SIMULATED WEBHOOK. The Bee scene carries SYNTHETIC BEE-FORMAT FIXTURE · WATCH PREVIEW. Any Hub delivery frame carries DEMO DELIVERY QUOTE — NO CARRIER BOOKING.
- Evidence numbers come from [EVIDENCE.md](EVIDENCE.md): 175/175 tests, release check 9/9, Titan 1024 dimensions, Nova tool selection. AgentCore appears in the architecture as the packaged Strands agent.
- Market numbers come from [SUBMISSION.md](SUBMISSION.md) and [research/](../research/README.md).

## Build

Python tools live in `scripts/video/.venv` (numpy, scipy, soundfile, edge-tts, faster-whisper, pedalboard, tinysoundfont, pyloudnorm, matplotlib, pillow). The SoundFont is GeneralUser GS in `video/build/sf/`.

```bash
npm --prefix scripts/video/studio install
```

1. `python scripts/video/tts.py`: every line in `timeline.json`, trimmed, with word timings; fails if a line overruns its bars.
2. `node scripts/video/studio/capture/capture.mjs`: resets `.data/video-capture`, starts the server (AUTH_MODE=none, mock AI, clock at 11:38 AM PT on Thursday, Oct 22) and captures every product state.
3. `python scripts/video/music.py`, `python scripts/video/mix.py`, then `python scripts/video/analyze.py --whisper` for loudness, the speech-to-music ratio per line and a Whisper read-back.
4. `node scripts/video/studio/prepare.mjs`, then `npx remotion render src/index.ts PairUp ../../../video/pairup-demo.mp4` in `scripts/video/studio`; `python scripts/video/srt.py` writes the captions.

`node scripts/video/studio/stills.mjs <bar> ...` renders review stills at any bar.
