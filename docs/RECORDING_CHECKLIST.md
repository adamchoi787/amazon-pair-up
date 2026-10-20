# Recording and submission checklist

Use this after the local validation in VALIDATION.md. Deadline: **October 24, 03:00 HKT**; team target **October 23, 21:00 HKT**.

## Release and judge access

- [ ] Push the prepared main branch to [the GitHub repository](https://github.com/rairurairu/amazon-pair-up); retain MIT LICENSE and the complete source/assets.
- [ ] Tony deploys `deploy/aws/deploy.sh`; deploy `agents/agentcore/deploy.sh` if claiming a hosted AgentCore run. Set the actual release revision and required auth/model settings from DEPLOY.md.
- [ ] Configure Login with Amazon or the labelled judge demo/passcode path. Rehearse sign-in in a fresh session; supply judge instructions and any demo credentials privately in the Devpost testing field.
- [ ] Run `npm run check:release -- --url <public-origin> --revision <full-submitted-commit> --expect-ai bedrock --expect-auth oauth`.
- [ ] With the judge/test account's `PAIRUP_TOKEN` in the environment, run `npm run evidence -- --url <public-origin>`; add `--agentcore-arn <runtime-arn>` if claiming AgentCore. AWS credentials are used only when Tony requests the optional runtime invocation. This command incurs a real model request. Confirm every requested check passes in `docs/EVIDENCE.md`.
- [ ] Keep evaluation access free and available through November 20, 12:00 PST / November 21, 04:00 HKT. The public repository already requires no collaborator invitations; private access needs the reviewers in the official FAQ.

## Track footage

- [ ] Alexa+: show a real MCP tool call, the buyer/seller flow and an interactive card. Caption **simulated Alexa+ experience** and **demo market**.
- [ ] Ring: generate a fresh official Playground token (or use an actual device), run `ring:probe`, and show PairUp consuming that device's event. Caption the official simulator and separately label any local `ring:simulate` webhook. Show both check-ins and the resulting arrival state. A local payload generator alone does not establish the official simulator requirement.
- [ ] Bee: secure a real Bee-device/Bee-on-Apple-Watch data source or an organizer-approved alternative; see BEE_DATA_SOURCES.md. Capture provenance, the actual Bee interaction, prepared suggestion and useful consented action. Until then, use the replay only as a labelled supporting integration and leave Bee entry pending.
- [ ] AWS: capture successful Bedrock inference and, if claimed, an actual AgentCore invocation. Health saying `ai: bedrock` alone does not prove a successful model call.
- [ ] Open Source: show the separate pairing-core repository briefly; contribution URLs and username are already prepared in SUBMISSION.md.

## Rehearsal

Use a disposable local/staging market. The two-device page is `/app/demo.html`; `?scenario=lunch` selects lunch. Local `?as=` sign-in works only with AUTH_MODE=none. On a hosted OAuth build, first sign each identity in from a full browser tab at `/app/?device=demo-calculator-seller` and `/app/?device=demo-calculator-buyer`, then reload the demo screens. This keeps external identity-provider pages outside the embedded frames. Use the lunch device slots when recording that scenario. Reload screens retains market state; use the documented seed/reset command only for the disposable database. Choose a future service date and say the time zone.

The calculator request must include **good condition** so the deliberately cheaper cracked TI-83 seed does not win the match. A Hub location/rate/reference is labelled demo data; the prototype models a delivery choice and creates no carrier booking or real pickup code.

## Final form

- [ ] Public English YouTube/Vimeo video **under three minutes**, with each entered track in that video. Check the URL without sign-in, audio intelligibility and captions. Use only footage/music/marks you have permission to include.
- [ ] Paste the description, hackathon-period evolution and track/mini-challenge answers from SUBMISSION.md.
- [ ] Paste every per-tool feedback row from PRODUCT_FEEDBACK.md, the full FRICTION_LOG.md answer and optional FEATURE_REQUESTS.md priorities.
- [ ] Paste Open Source contribution URL, repository URL and `rairurairu`. Add upstream issue/PR URLs only after actually publishing them.
- [ ] Add teammates and ensure they accepted; confirm entrant eligibility, team representation and rights in the form.
- [ ] Submit before the deadline and save the final Devpost URL. A saved draft is a separate step from submission.
