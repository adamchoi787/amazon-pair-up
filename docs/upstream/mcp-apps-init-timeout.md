# Draft issue: show a bounded initialization failure path in the host example

Destination: [MCP Apps issues](https://github.com/modelcontextprotocol/ext-apps/issues).
Status: **draft feature request; Tony publishes**. This describes a host integration concern, rather than a measured failure rate in the SDK.

## Ready-to-paste body

While embedding MCP Apps with ext-apps 1.7.5, we needed to handle a view that never sends `ui/notifications/initialized` (for example, its JavaScript cannot run). A host that leaves the frame at height zero can otherwise leave its loading skeleton indefinitely.

Reproduction proposal: serve a UI resource whose module throws before `app.connect()`, render it in the basic host, and observe whether the host clears loading and offers a fallback. Expected: a documented bounded wait, cleanup and an accessible text fallback. The protocol can continue to allow slow hosts; this is a request for a host example or helper with configurable timeout behavior.

PairUp registers `bridge.oninitialized` before loading the view, races it against eight seconds, clears the timer, closes the bridge, removes the frame and skeleton, and offers “Open Deals, or ask me for your deal status.” A later mount is a fresh attempt. Please add that failure/recovery pattern to the reference host, with a small regression test.

Code evidence: `src/web/host.ts` and `src/web/main.ts` in [PairUp](https://github.com/rairurairu/amazon-pair-up). Publish the submitted commit before linking code lines.
