# Tool contract (frozen, so change it only after telling the team)

Endpoint: `POST /mcp`, Streamable HTTP, stateless, MCP protocol `2025-11-25`.
Auth: `Authorization: Bearer $MCP_API_KEY` when set. Identity: `X-User-Id` header, or a `user_id` argument (temporary).

Every successful result is JSON (as text **and** `structuredContent`) with a `say` field, a short sentence Alexa can speak.
Errors the user can fix come back as `isError: true` with `{ "say": "..." }`.

## Privacy rules

| Field | Visible to |
|---|---|
| listing `ask_price` | everyone |
| listing `min_price` | seller only, as `your_min_price` |
| intent `max_price` | buyer only, as `your_max_price` |
| negotiation failure | nobody gets numbers ("can't meet your budget") |

## Tools

### `create_listing`
`title`*, `ask_price`*, `min_price`, `description`, `category`, `condition` (`new|like_new|good|fair|for_parts`), `quantity`, `auto_accept` (default true), `location`, `availability`
→ `{ listing, say }`

### `create_buy_intent`
`need` and/or `raw_request`*, `max_price` (required if not in `raw_request`), `min_condition`, `quantity`, `needed_by` (ISO), `location`, `source` (`voice|bee_context`)
→ `{ intent, say }`. Structured args win; `raw_request` is parsed to fill the gaps.

### `find_matches`
`intent_id`*, `limit` (1–10, default 3)
→ `{ intent_id, matches: [listing + within_budget_at_ask + score], say }`

### `negotiate`
`intent_id`*, `listing_id`*
→ `{ deal, saved_vs_ask, say }` or `{ deal: null, say }`. Creates a **proposed** deal. With `auto_accept`, the seller is already confirmed.

### `confirm_deal` / `decline_deal`
`deal_id`*. Call `confirm_deal` **only after the user explicitly says yes.**
→ `{ deal, say }`. The deal is `confirmed` once both sides have confirmed; the listing is then marked `sold`.

### `get_deal_status`
`deal_id` (optional) → `{ deals, say }`

## Conversation flow Alexa+ should follow

```
seller speaks → create_listing
buyer speaks  → create_buy_intent → find_matches → (offer best) → negotiate
             → Alexa: "Got it for $17, confirm?" → user "yes" → confirm_deal
```
