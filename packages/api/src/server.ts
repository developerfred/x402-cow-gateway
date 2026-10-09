/**
 * x402 CoW Gateway — resource server (Hono).
 *
 * The agent pays the gateway via x402 (handled by paymentMiddlewareFromConfig,
 * which verifies/settles through the configured facilitator). On success the
 * handler fetches the real CoW Protocol quote upstream and returns it.
 *
 * Powered by codingsh — https://github.com/developerfred/x402-cow-gateway (codingsh.eth)
 *
 * --- OPERATOR SETUP (required to run live) -------------------------------
 *   PAYTO_ADDRESS            collection wallet (sweeps the fee to codingsh.eth)
 *   FACILITATOR_URL          an x402 facilitator that verifies/settles on PAYMENT_NETWORK
 *   PAYMENT_NETWORK          eip155:8453 (Base) by default
 *   OPS_WALLET_PRIVATE_KEY   funds the upstream x402.cow.fi tab (the $0.001/quote cost)
 *   OPS_RPC_URL              RPC for the upstream payment network
 *   FEE_POLICY               flat | bps | tiered (default tiered)
 *   FEE_RECIPIENT            default "codingsh.eth"
 * v1 seller leg uses the `exact` scheme (facilitator-only). Switch to
 * `batch-settlement` for per-quote fee viability at scale (see README roadmap).
 * -------------------------------------------------------------------------
 */
import { Hono } from "hono";
import { paymentMiddlewareFromConfig } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { RoutesConfig } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import type { QuoteNetwork } from "@codingsh/x402-cow";
import { TieredPolicy, formatUsd } from "./pricing.js";
import { handleQuote, feeRecipient, type GatewayConfig } from "./gateway.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const PAYMENT_NETWORK = (process.env.PAYMENT_NETWORK ?? "eip155:8453") as Network;
const SELLER_SCHEME = process.env.SELLER_SCHEME ?? "exact";

// Advertised per-endpoint prices come straight from the fee policy.
const prices = new TieredPolicy();
const quotePrice = formatUsd(prices.price({ endpoint: "quote", network: "base", cowCalls: 1 }).total);

const cfg: GatewayConfig = {
  opsWalletPrivateKey: requireEnv("OPS_WALLET_PRIVATE_KEY") as `0x${string}`,
  opsRpcUrl: requireEnv("OPS_RPC_URL"),
  upstreamBaseUrl: process.env.UPSTREAM_BASE_URL,
};

const facilitator = new HTTPFacilitatorClient({ url: requireEnv("FACILITATOR_URL") });

const routes = {
  "POST /api/v1/:network/quote": {
    accepts: {
      scheme: SELLER_SCHEME,
      network: PAYMENT_NETWORK,
      payTo: requireEnv("PAYTO_ADDRESS"),
      price: quotePrice, // e.g. "$0.002000"
    },
    description: "CoW Protocol swap quote (resold over x402)",
  },
} satisfies RoutesConfig;

export const app = new Hono();

// x402 paywall on the quote route — verifies/settles the agent's payment first.
app.use("/api/v1/:network/quote", paymentMiddlewareFromConfig(routes, facilitator));

app.get("/healthz", (c) => c.json({ ok: true, feeRecipient: feeRecipient(), quotePrice }));

app.post("/api/v1/:network/quote", async (c) => {
  const network = c.req.param("network") as QuoteNetwork;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const result = await handleQuote(cfg, network, body);
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

// Local run: `pnpm --filter @codingsh/x402-cow-api dev`. On Vercel, use the
// hono/vercel adapter in an api/ entry instead.
if (process.env.RUN_SERVER === "1") {
  const { serve } = await import("@hono/node-server");
  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: app.fetch, port });
  console.log(`x402 CoW Gateway listening on :${port} (fee → ${feeRecipient()})`);
}

export default app;
