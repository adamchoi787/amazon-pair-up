---
title: Settling a deal between two private limits in an MCP server
published: false
tags: mcp, rust, webassembly, aws
---

A student wants a graphing calculator before an exam. A nearby student has one to sell. Our first sketch was “Carousell for agents”: let personal assistants find the listing and arrange the exchange. Building it exposed the more useful primitive: a standing request that can meet a seller later, from either direction.

That became PairUp. Items, lunch runs and event help share one MCP contract. An agent turns a sentence into a request, the server pairs it with an offer, and both people review the result. For hourly work, the card shows the rate, duration, total and whose approval is missing. Schedules are checked in code and one helper's bookings cannot overlap.

Pricing needed a similarly explicit rule. Suppose the public ask is $20, the seller accepts $15 or more, and the buyer offers $18. Our Rust library, pairing-core, accepts the $18 offer. It runs as a small WebAssembly module using integer cents:

```text
price = min(public ask, buyer offer)
accept when price meets the seller's private minimum and the walk-away floor
```

The seller's minimum determines acceptance. It does not change the accepted price. A floor preserves the earlier offered price after a buyer walks away. The host binds identities, limits retries and returns only the caller's permitted view.

The [MIT library](https://github.com/rairurairu/pairing-core) includes invariant tests, shared vectors and an MCP example. [PairUp](https://github.com/rairurairu/amazon-pair-up) adds transactional holds, scheduling, OAuth, MCP Apps cards and a voice host. Bedrock supplies embeddings and language understanding; Strands uses the same tools through an AgentCore entrypoint. The deterministic rules stay in the server.

The idea grew again during the hackathon. Bee context can prepare an exam-related need and ask for consent. Ring events can corroborate arrival at a PairUp Point. The Amazon Hub flow models a drop-off and pickup alternative using labelled demo locations and rates. Carrier booking and real locator access remain future integrations.

The useful design boundary is simple: agents interpret, deterministic code checks, and people approve. We are preparing a campus pilot to learn where that flow saves time and where it still confuses people. The repo distinguishes synthetic rehearsal data from device footage and measured pilot results.

Draft for Tony's review and optional publication. Add the final demo URL and observed results when available.
