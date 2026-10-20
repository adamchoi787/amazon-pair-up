# Handoff branch audit

October 20, 2026. Worktrees are retained for Tony to remove when convenient.

| Branch / worktree | Result |
|---|---|
| `claude/lucid-lichterman-f00e30` | Merged through `codex/design-integration`. Kept the token system, icons, motion, all four app surfaces and design tests alongside Ring and delivery. |
| `claude/mystifying-kapitsa-908773` | Ported `demo.html`, auth device slots, trusted parent messages and cross-tab news through `codex/two-device-demo`. Used current UW users, PairUp naming and shared tokens. Its older market/auth/schema implementation remains superseded. |
| `claude/nifty-banach-fc4da0` | Reviewed its README, Skill, connection/tool references and schema test. Current `skills/pairup/SKILL.md` and TOOL_CONTRACT cover the evolved tool set; old references describe earlier names and fields. Added current YAML/spec and live-tool coverage in `test/skill.test.ts`. Ready for removal. |
| `claude/unruffled-chaum-2f4a78` | Reviewed uncommitted database, service, MCP, idempotency and test changes. Main already has argument hashes, key conflict detection, error release, expiry and privacy-scoped replays; its existing idempotency tests cover those contracts. Ported the missing structured-request extraction optimization and a focused regression to `test/agent-friendly.test.ts`. Older key scoping and `idempotency_keys` table are superseded by main's `idempotent_calls`. Ready for removal. |

`vendor/pairing-core` and `src/market/negotiation.ts` were left with their original contents.
