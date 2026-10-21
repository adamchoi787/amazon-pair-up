# Video handoff — composite build (2026-10-21)

Tony will not screen-record. Build the submission video as a **composite**: capture real app states programmatically, then assemble stills/short clips, captions and a synthesized voiceover with ffmpeg. The result is one English MP4 under three minutes that follows the shot list in [DEMO_SCRIPT.md](DEMO_SCRIPT.md).

Read first: [DEMO_SCRIPT.md](DEMO_SCRIPT.md), [RECORDING_CHECKLIST.md](RECORDING_CHECKLIST.md), [AWARD_GAPS.md](AWARD_GAPS.md), [EVIDENCE.md](EVIDENCE.md).

## State on handoff

- `main` = deployed `v0.8.0` (`6895b52` app code; later commits are docs). 175/175 tests, typecheck clean, CI green.
- Live: `https://d3cxpkmhl89rw9.cloudfront.net` (OAuth; `/app/`, `/app/demo.html`, `/watch/`, `/mcp-apps/market.html` return 200).
- Machine: Windows, ffmpeg 9 on PATH, Python available, Node project. Playwright is not installed yet. No local AWS credentials.

## Method

1. **Capture from the real app.** Run the server locally with `AUTH_MODE=none` on a fresh disposable database (`npm run reset`, then `npm run dev`); the `?as=` shortcuts and `/app/demo.html?scenario=calculator|lunch` then work without sign-in. Drive it with Playwright (add as a devDependency) at 1920×1080, deviceScaleFactor 2. For each shot, perform the real actions (type the request, confirm the deal, PairUp Point, "I'm here", service booking) and save screenshots at each state, plus short Playwright `recordVideo` clips where motion helps (typing, card appearing). Every frame shows genuine app output from these actions.
2. **Assemble with ffmpeg.** Per shot: stills with gentle zoom/pan (`zoompan`) or the clip, cross-fades between shots, burned-in captions and a matching `.srt`. Lower-third labels as listed below. 1920×1080, 30 fps, H.264 + AAC, target length 2:50–2:55, hard limit under 3:00.
3. **Voiceover.** Use the voiceover lines in DEMO_SCRIPT.md. Preferred: Amazon Polly neural voice (on-theme for AWS); it needs Tony to run `aws login` first. Fallback: edge-tts (`pip install edge-tts`, en-US neural voice). Fit each shot's duration to its narration audio.
4. **Keep the build reproducible.** Scripts in `scripts/video/` (capture, tts, assemble). Outputs in `video/` (add to `.gitignore`); commit scripts only.

## Required labels (on screen)

- **Simulated Alexa+ experience** and **Demo market** on the app shots.
- **Demo delivery quote — no carrier booking** on any Hub delivery frame.
- Ring beat: the local `ring:simulate` webhook is labelled **Local simulated webhook**. Production has no Ring Playground token, so official Ring footage is absent; leave a slot that Tony can fill with a Ring Playground screenshot if he provisions one, and otherwise the Ring track entry stays pending.
- Bee beat: **Synthetic Bee-format fixture / watch preview**. The Bee track entry stays pending.
- Evidence beat (2:10–2:35): render the passing results from EVIDENCE.md (Bedrock inference, health/build-info, CI) as a clean card plus the architecture line. AgentCore currently streams `<thinking>` text without a clean final answer (AWARD_GAPS.md) and `agents/agentcore/src/agent.ts:51` still reports `0.7.0`; show AgentCore as hosted only after that is fixed, redeployed and re-collected. Otherwise show Bedrock results only.

## Content rules

- Real seed data only; the calculator request must say **good condition** (otherwise the cracked TI-83 seed wins). Future service date, Pacific time, UW campus.
- Keep credentials, tokens and private context out of every frame.
- Use only music/footage you have rights to; silence under the voiceover is acceptable.

## Done when

- `video/pairup-demo.mp4` (< 3:00, 1080p) and `video/pairup-demo.srt` exist, built from `scripts/video/*`.
- Tony has reviewed it via SendUserFile, and the shot-to-script mapping is noted at the end of DEMO_SCRIPT.md.
- Upload to YouTube/Vimeo and the Devpost submission remain Tony's actions.
