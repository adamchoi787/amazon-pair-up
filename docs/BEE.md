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

## Official Bee Skill + PairUp Skill

Install the official [Bee Skill](https://github.com/bee-computer/bee-skill/tree/main/bee-cli)
alongside `skills/pairup/`, or connect the CLI's `bee mcp` server. For this
education scenario, use `bee todos list --json` or `bee today --context --json`
to locate the student's own calculator-before-the-exam need. The official
Skill's command map explains these choices. Forward the relevant need clause
with `add_context`, `source: "bee"`, and a stable `external_id`; then call
`get_suggestions`, supply a budget if requested, and wait for explicit acceptance.

The bridge's live command is `bee stream --json --types
todo-created,todo-updated,update-conversation-summary,journal-created,journal-updated,update-location`.
All flags and six event names were checked against the current
[bee-cli README](https://github.com/bee-computer/bee-cli) on October 20, 2026.

For the final video, record a new need through the actual Bee device or Bee
software on Apple Watch. Show that need arriving through Bee, the resulting
PairUp suggestion, the student's budget/yes and the useful request or matched
deal. Keep unrelated conversations and credentials out of the take. Add the
device/software used and recording date to the evidence checklist.
