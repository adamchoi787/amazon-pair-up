# PairUp runtime evidence

Recorded 2026-10-20T14:45:00.519Z against https://d3cxpkmhl89rw9.cloudfront.net. Local revision: 6895b521f50453819a9ba55b5c1f73914f6f17f9.

Overall: **passed**. AgentCore was requested.

Recorded **October 20, 2026, 22:45 HKT**. Deployed application release: `v0.8.0` at `6895b52`. AgentCore was **version 2 READY**, image `590728476536.dkr.ecr.us-east-1.amazonaws.com/amazonpairup-agent:20261020144137`, digest `sha256:bcc5e49b1f34ebe34dfc75753455e737fbd106b7b75b7be873249b7eed479e6c`.

**Scope of this pass:** release identity and actual AWS inference/streaming. The AgentCore response below contains `<thinking>` text and no separate spoken final answer for this prompt. The current collector accepts any nonempty text without an error; it does not validate final-answer quality or successful execution of an MCP tool. Filter model reasoning from the spoken stream and add semantic checks before treating this as a complete voice-workflow acceptance test. The MCP client in the AgentCore source also still advertises applicationVersion `0.7.0` despite the package release being `0.8.0`.

## Additional release checks

- `check:release` passed all nine checks: product, version, UI fingerprint, full deployed commit, AI mode, OAuth, database readiness, app shell and asset manifest.
- Fresh judge-demo OAuth consent GET **200**, authorization POST **302**, S256 PKCE token exchange **200**. Credentials stayed out of output; grant revocation returned **200** after collection. This verifies the HTTP flow; a fresh-browser UI rehearsal is still needed.
- Live local-AWS preflight against the same model IDs: Titan embedding **1024 dimensions (1542 ms)**; Nova intent extraction **1326 ms**, calculator budget **18**; Nova tool selection **6870 ms**, `post_offer`. Returned tool calls were not executed and no market post/deal was created.
- EBS snapshot `snap-090f26166800f4a41` completed before the deploy. Daily DLM policy `policy-0ddd635b6cd059bad` is enabled.
- SSM confirmed application and CloudWatch agent **active**, current release directory `/opt/amazonpairup/releases/20261020144053-6895b52`. CloudWatch log events show this release starting at **14:41:15 UTC**.
- Four CloudWatch alarms were **OK**. The SNS alarm topic has **zero subscribers**, so email alert delivery remains unconfigured.
- SSM checked only configuration presence: `LWA_CLIENT_ID`, `LWA_CLIENT_SECRET`, `RING_ACCESS_TOKEN`, `RING_POINT_DEVICES`, `RING_HMAC_KEY` are **missing**. Production uses the judge demo sign-in; no live Ring interaction was claimed.
- Public MIT source and annotated release tag were pushed. [Release CI passed](https://github.com/rairurairu/amazon-pair-up/actions/runs/39441306891); local root **175/175** and AgentCore **4/4** tests passed.

## Health: passed

```json
{
  "status": 200,
  "body": {
    "product": "PairUp",
    "revision": "6895b521f50453819a9ba55b5c1f73914f6f17f9",
    "ui_fingerprint": "adde8b08f8c53f919314a712bef0e5c8ba27f8cb246cb93e9d2d00560d61fcef",
    "ok": true,
    "version": "0.8.0",
    "ai": "bedrock",
    "auth": "oauth",
    "agent": "bedrock",
    "uptime_s": 211,
    "mcp_sessions": 0,
    "subscriptions": 0
  }
}
```

## Browser build: passed

```json
{
  "status": 200,
  "body": {
    "version": "0.8.0",
    "fingerprint": "adde8b08f8c53f919314a712bef0e5c8ba27f8cb246cb93e9d2d00560d61fcef"
  }
}
```

## Submitted release identity: passed

```json
{
  "expected_revision": "6895b521f50453819a9ba55b5c1f73914f6f17f9",
  "deployed_revision": "6895b521f50453819a9ba55b5c1f73914f6f17f9",
  "expected_fingerprint": "adde8b08f8c53f919314a712bef0e5c8ba27f8cb246cb93e9d2d00560d61fcef",
  "deployed_fingerprint": "adde8b08f8c53f919314a712bef0e5c8ba27f8cb246cb93e9d2d00560d61fcef"
}
```

## Bedrock inference: passed

```json
{
  "status": 200,
  "body": {
    "message": {
      "role": "assistant",
      "content": [
        {
          "text": "<thinking>The User wants to review their existing posts but does not want to create or confirm anything. The tool that lists their own offers and requests is 'list_my_posts'.</thinking>\n"
        },
        {
          "toolUse": {
            "toolUseId": "tooluse_FmH619MQOkskmOsGgtSs9Q",
            "name": "list_my_posts",
            "input": {}
          }
        }
      ]
    },
    "stop": "tool_use",
    "mode": "bedrock",
    "inference": "bedrock"
  }
}
```

## AgentCore invocation: passed

```json
"event: message\ndata: {\"text\":\"<thinking\"}\n\nevent: message\ndata: {\"text\":\">\"}\n\nevent: message\ndata: {\"text\":\"The\"}\n\nevent: message\ndata: {\"text\":\" User\"}\n\nevent: message\ndata: {\"text\":\" wants\"}\n\nevent: message\ndata: {\"text\":\" to\"}\n\nevent: message\ndata: {\"text\":\" know\"}\n\nevent: message\ndata: {\"text\":\" which\"}\n\nevent: message\ndata: {\"text\":\" Pair\"}\n\nevent: message\ndata: {\"text\":\"Up\"}\n\nevent: message\ndata: {\"text\":\" tools\"}\n\nevent: message\ndata: {\"text\":\" help\"}\n\nevent: message\ndata: {\"text\":\" them\"}\n\nevent: message\ndata: {\"text\":\" review\"}\n\nevent: message\ndata: {\"text\":\" their\"}\n\nevent: message\ndata: {\"text\":\" existing\"}\n\nevent: message\ndata: {\"text\":\" posts\"}\n\nevent: message\ndata: {\"text\":\".\"}\n\nevent: message\ndata: {\"text\":\" The\"}\n\nevent: message\ndata: {\"text\":\" relevant\"}\n\nevent: message\ndata: {\"text\":\" tool\"}\n\nevent: message\ndata: {\"text\":\" for\"}\n\nevent: message\ndata: {\"text\":\" this\"}\n\nevent: message\ndata: {\"text\":\" is\"}\n\nevent: message\ndata: {\"text\":\" '\"}\n\nevent: message\ndata: {\"text\":\"list\"}\n\nevent: message\ndata: {\"text\":\"_\"}\n\nevent: message\ndata: {\"text\":\"my\"}\n\nevent: message\ndata: {\"text\":\"_\"}\n\nevent: message\ndata: {\"text\":\"posts\"}\n\nevent: message\ndata: {\"text\":\"'\"}\n\nevent: message\ndata: {\"text\":\",\"}\n\nevent: message\ndata: {\"text\":\" which\"}\n\nevent: message\ndata: {\"text\":\" lists\"}\n\nevent: message\ndata: {\"text\":\" the\"}\n\nevent: message\ndata: {\"text\":\" User\"}\n\nevent: message\ndata: {\"text\":\"'\"}\n\nevent: message\ndata: {\"text\":\"s\"}\n\nevent: message\ndata: {\"text\":\" own\"}\n\nevent: message\ndata: {\"text\":\" offers\"}\n\nevent: message\ndata: {\"text\":\" and\"}\n\nevent: message\ndata: {\"text\":\" requests\"}\n\nevent: message\ndata: {\"text\":\",\"}\n\nevent: message\ndata: {\"text\":\" newest\"}\n\nevent: message\ndata: {\"text\":\" first\"}\n\nevent: message\ndata: {\"text\":\",\"}\n\nevent: message\ndata: {\"text\":\" with\"}\n\nevent: message\ndata: {\"text\":\" their\"}\n\nevent: message\ndata: {\"text\":\" status\"}\n\nevent: message\ndata: {\"text\":\".</\"}\n\nevent: message\ndata: {\"text\":\"thinking\"}\n\nevent: message\ndata: {\"text\":\">\\n\"}\n\nevent: message\ndata: {\"text\":\"\"}\n\nevent: message\ndata: {\"text\":\"\"}\n\n"
```

This records actual responses. Local mock runs verify the collector and remain incomplete evidence for AWS. It does not establish Bee or Ring hardware provenance.
