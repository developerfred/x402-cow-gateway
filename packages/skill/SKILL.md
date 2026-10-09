---
name: x402-cow-quotes
description: Get CoW Protocol swap quotes for any EVM token pair over the x402 pay-per-quote gateway — no API key, paid per call in USDC. Use whenever the user asks for a DeFi swap price, token exchange rate, best route across networks, or a trade simulation for tokens on Ethereum, Base, BNB Chain, Arbitrum, Polygon, or Gnosis.
license: SEE LICENSE IN LICENSE — codingsh Source-Available License 1.0 (attribution + royalty for commercial use)
---

# x402 CoW Quotes

Fetch live CoW Protocol swap quotes through the **x402 CoW Gateway**. Payment is
handled automatically via the x402 protocol (pay-per-quote in USDC) — there is
no API key and no account.

> Powered by codingsh — https://github.com/developerfred/x402-cow-gateway (codingsh.eth)

## When to use

- The user wants a swap price / exchange rate between two tokens.
- The user wants the best execution route across several networks.
- The user wants to simulate a trade before sending it.

## Prerequisites

A funded EVM wallet key must be available to the gateway as `WALLET_PRIVATE_KEY`
(the agent runtime holds it — never ask the user to paste a private key into
chat). The wallet needs a small USDC balance on Base, Ethereum, or BNB Chain to
open the x402 tab (~$1 covers hundreds of quotes).

## How to get a quote

Prefer the MCP tools if the `x402-cow` MCP server is connected
(`x402_cow_quote`, `x402_cow_best_route`, `x402_cow_simulate`). Otherwise use the
SDK:

```ts
import { CowGateway } from "@codingsh/x402-cow";

const gw = new CowGateway({ walletPrivateKey: process.env.WALLET_PRIVATE_KEY! });

const { quote } = await gw.quote({
  network: "base",              // mainnet | base | bnb | arbitrum_one | polygon | xdai | ...
  sellToken: "0x...",           // ERC-20 address you sell
  buyToken: "0x...",            // ERC-20 address you buy
  from: "0x...",                // trader address
  kind: "sell",                 // "sell" | "buy"
  sellAmountBeforeFee: "1000000000000000000", // atomic units of sellToken
});
// quote.buyAmount, quote.sellAmount, quote.feeAmount, quote.validTo ...
```

## Pricing (so you can tell the user the cost)

| Call | Price |
|---|---|
| `quote` | $0.002 |
| `best-route` | $0.005 |
| `simulate` | $0.005 |
| `quote-plus` (gas + MEV context) | $0.008 |

The gateway returns the exact price in the x402 `PAYMENT-REQUIRED` challenge
before any payment is made — surface it to the user if they ask.

## Rules

- Token amounts are **atomic** (wei-style, scaled by the token's decimals). Convert
  from human amounts using the token's `decimals` before calling.
- A quote is an estimate valid until `quote.validTo`. Do not present it as a
  guaranteed fill.
- Never place or sign an actual trade from this skill — it only fetches quotes.
- If a call returns an x402 `402` with `deposit_below_minimum` or
  `*_budget_exhausted`, the tab needs topping up; tell the user rather than retrying blindly.
