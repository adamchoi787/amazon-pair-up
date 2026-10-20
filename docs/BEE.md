# Bee context for PairUp

PairUp reads need snippets from the user's Bee to-dos and conversation summaries
and offers a prepared request. Accepting the suggestion posts it. The suggested
budget comes from the user's similar requests; when none exists, ask for one.
Need snippets expire after 30 days. Dismiss or forget suggestions in the app.

Create a Bee token in **Devices**. Set `PAIRUP_URL` to your server base URL and
`PAIRUP_DEVICE_TOKEN` to that token. The bridge supports three modes:

```bash
npm run bee:bridge
npm run bee:bridge -- --poll
npm run bee:bridge -- --replay data/bee-demo-events.jsonl
```

The default mode launches `bee stream --json` using an authenticated Bee CLI.
Polling uses `BEE_API_TOKEN`, the public API base
`https://api.developer.bee.amazon.dev`, and `GET /v1/todos`. The replay file is
labelled demo data. For local development with authentication disabled, set
`PAIRUP_USER_ID=u_tony` instead of a device token. The calculator summary should
suggest a graphing calculator, the to-do should suggest printer paper, and the
email task and hiking chat should yield no suggestion.

An agent with Bee MCP can read the user's to-dos or daily summary with its
available Bee tools, then call PairUp `add_context` with source `bee`, the signal
kind, the need snippet and its stable `external_id`. Call `get_suggestions`, read
the suggestion aloud, and wait for an explicit yes before `accept_suggestion`.
Forward the user's need clause. The bridge excludes raw utterance events.

The live API and CLI modes need a Bee account and credentials. Replay validates
the local integration; describe it as demo data in the video. Entering the Bee
track remains Tony's decision and requires meeting the event's device rules.

Source: [Bee developer API](https://docs.bee.computer/docs/api).
