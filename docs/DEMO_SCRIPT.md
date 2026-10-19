# Demo video script (under 3:00, English, no third-party brands or music)

Judges may stop at 3:00, so put the best material first.

| Time | Shot | Words |
|---|---|---|
| 0:00–0:15 | Title + one line | "AmazonPairUp: a voice-first marketplace that pairs buyers and sellers on Alexa+. Say what you have or what you need, and Alexa pairs you up, negotiates and closes the deal." |
| 0:15–0:30 | Problem | "Trading with another person means photos, forms and haggling. So small things rarely change hands, and the buyer next door never finds the seller." |
| 0:30–1:30 | **Core demo** (split screen: voice + live dashboard) | Seller: "Alexa, sell my TI-84 for $20. I'll accept anything above $15." · Buyer: "Alexa, I need a graphing calculator today, maximum $18." · Alexa: "Found it: TI-84 Plus graphing calculator for $17, $3 below asking. Meet-up: HKUST campus. Should I confirm it?" · "Yes." · Dashboard: deal confirmed, 🔒 limits never shown. |
| 1:30–1:50 | Long tail | "$2 pocket tissues" bought in one sentence. "When friction is near zero, even a $2 item is worth trading." |
| 1:50–2:25 | How it works | Architecture diagram: Alexa+ → MCP server (Streamable HTTP, spec 2025-11-25) → Bedrock intent extraction → pgvector hybrid search → deterministic negotiation → deal. Mention that private limits are enforced on the server. |
| 2:25–2:45 | Bee | "With Bee connected, Alexa can act before you ask." Real Bee data → proactive suggestion. |
| 2:45–3:00 | Close | Impact line + team names. |

## Recording checklist
- [ ] Run `npm run reset` before each take
- [ ] Dashboard open, zoomed to 125%
- [ ] Deployed URL, not localhost, if possible
- [ ] Captions on the spoken lines
