import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// MCP prompts: ready-made starting points that hosts list as slash commands or
// suggestions (Claude, VS Code, the MCP Inspector). Each one turns a few words
// from the user into the request an agent should act on with the tools.

const user = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });

export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "sell_something",
    {
      title: "Sell something or offer a service",
      description: "Post an item to sell or a service you can do, with a public price and a private lowest price.",
      argsSchema: {
        what: z.string().describe("The item or the service, e.g. 'my TI-84 calculator' or 'lunch runs around campus'"),
        price: z.string().describe("The asking price or fee, e.g. '$20' or '$5 per run'"),
        lowest: z.string().optional().describe("Private lowest price you'd accept, e.g. '$15'"),
      },
    },
    ({ what, price, lowest }) =>
      user(
        `Post an offer on PairUp: ${what}, asking ${price}` +
          (lowest ? `, and I'll accept anything from ${lowest} (keep that private)` : "") +
          ". If someone is already waiting for it, read me the proposed deal and wait for my yes before confirming.",
      ),
  );

  server.registerPrompt(
    "find_something",
    {
      title: "Find an item or get help",
      description: "Ask for an item or for someone to do a task, with a private budget; returns a proposed deal when one fits.",
      argsSchema: {
        need: z.string().describe("What you need, e.g. 'a graphing calculator today' or 'someone to pick up my lunch from the HUB by 12:30'"),
        budget: z.string().describe("Your private maximum, e.g. '$18' or '$10 an hour'"),
      },
    },
    ({ need, budget }) =>
      user(
        `On PairUp I need ${need}, budget ${budget} (keep my budget private). ` +
          "Post the request, tell me the best offer in one sentence, and only confirm it after I say yes.",
      ),
  );

  server.registerPrompt(
    "whats_new",
    {
      title: "Any news?",
      description: "Deals waiting for your yes, booked jobs and meet-up details.",
    },
    () => user("Any news on PairUp? Tell me which deals are waiting for my yes first, then my meet-ups and jobs."),
  );
}
