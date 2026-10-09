# 🐄 x402 CoW Gateway

**Pay-per-quote DeFi swaps for AI agents.** A monetized [x402](https://github.com/coinbase/x402) gateway that resells [CoW Protocol](https://cow.fi) swap quotes to bots and AI agents — no API key, no sign-up, pay a few tenths of a cent per quote in USDC.

> Built on [`x402.cow.fi`](https://x402.cow.fi/docs/#/). Powered by **codingsh** · `codingsh.eth`

🔗 **Landing page:** https://developerfred.github.io/x402-cow-gateway/

---

## Why

`api.cow.fi` is free but rate-limited and built for humans. `partners.cow.fi` needs a BD call. `x402.cow.fi` is pay-per-quote for machines — perfect, but your agent still has to speak raw x402. This gateway wraps that for you and ships it three ways any agent can consume:

- **MCP server** — `@codingsh/x402-cow-mcp`, works with any MCP-compatible agent (Claude, Cursor, …)
- **Claude Skill** — drop-in skill for Claude Code / Claude
- **npm SDK** — `@codingsh/x402-cow`, typed client that wraps the x402 payment handshake

## How it works

```
AI agent ──pays $0.002──▶  x402 CoW Gateway  ──pays $0.001──▶  x402.cow.fi
(x402 client)              (resource server +                  (CoW orderbook)
                            x402 buyer; one USDC tab)
                                   │
                                   └── fee ($0.001) ──▶ codingsh.eth
```

The gateway is simultaneously an x402 **resource server** to the agent and an x402 **buyer** to cow.fi. It keeps a single USDC "tab" open with cow.fi (deposit once, batch-settled vouchers after), charges the agent a small markup, and the margin always accrues to **`codingsh.eth`**.

## Pricing

| Endpoint | What you get | Price / call |
|---|---|---|
| `quote` | One CoW Protocol swap quote | **$0.002** |
| `best-route` | Quotes across networks, best returned | **$0.005** |
| `simulate` | Quote + execution simulation | **$0.005** |
| `quote-plus` | Quote + gas & MEV context | **$0.008** |

Pricing is a pluggable [`FeePolicy`](packages/api/src/pricing.ts) (`flat` · `bps` · `tiered`). The default is cost-plus on the base quote and value-based on premium endpoints — grounded in 2026 agent-API pricing norms (cost-plus for pass-through, value pricing where a call drives an attributable result).

## Repository layout

```
packages/
  api/      x402 resource server (deploys to Vercel) — wraps cow.fi, applies the fee policy
  mcp/      MCP server — exposes the gateway as tools for any agent
  client/   @codingsh/x402-cow — typed SDK that handles the x402 payment flow
  skill/    Claude Skill (SKILL.md + examples)
docs/       SEO landing page (GitHub Pages, served from /docs)
```

## Quickstart

### MCP (any agent)

```json
{
  "mcpServers": {
    "x402-cow": {
      "command": "npx",
      "args": ["-y", "@codingsh/x402-cow-mcp"],
      "env": { "WALLET_PRIVATE_KEY": "0x..." }
    }
  }
}
```

### SDK

```ts
import { CowGateway } from "@codingsh/x402-cow";

const gw = new CowGateway({ walletPrivateKey: process.env.WALLET_PRIVATE_KEY! });
const { quote } = await gw.quote({
  network: "base",
  sellToken: "0x...",
  buyToken: "0x...",
  from: "0x...",
  kind: "sell",
  sellAmountBeforeFee: "1000000000000000000",
});
```

## Self-hosting & license

This project is **source-available, not open source**. You may read, study, and
run it, but **commercial use requires attribution to codingsh and a royalty** —
see [`LICENSE`](LICENSE) (codingsh Source-Available License 1.0). Non-commercial
and small-scale use (under the Free Threshold) is royalty-free, attribution
still required.

> The LICENSE is a template, not legal advice — have counsel review it before relying on it.

## Roadmap

- [ ] `packages/client` — x402 buyer against `x402.cow.fi` (uses `@x402/evm`)
- [ ] `packages/api` — x402 resource server + fee policy → payout
- [ ] `packages/mcp` — MCP tools
- [ ] `packages/skill` — Claude Skill
- [ ] Atomic fee split via x402 v2 `exact` scheme (`extra.splits`) — pay `codingsh.eth` in the same tx, no sweeping
- [ ] `$CoW` payment option
- [ ] Prepaid volume tab with blended discount

## Credits

Built on the [x402 protocol](https://github.com/coinbase/x402) and [CoW Protocol](https://cow.fi). Not affiliated with or endorsed by CoW DAO or Coinbase.
