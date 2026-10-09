#!/usr/bin/env node
/**
 * @codingsh/x402-cow-mcp — MCP server exposing x402 CoW Gateway quotes as tools
 * for any MCP-compatible agent (Claude, Cursor, ...).
 *
 * Powered by codingsh — https://github.com/developerfred/x402-cow-gateway (codingsh.eth)
 *
 * Required env:  WALLET_PRIVATE_KEY, RPC_URL
 * Optional env:  X402_BASE_URL, PAYMENT_NETWORK, ASSET, STATE_DIR,
 *                MAX_QUOTE_USDC, MAX_DEPOSIT_USDC, MAX_WITHDRAW_DELAY_HOURS,
 *                EXPECTED_PAYTO, EXPECTED_RECEIVER_AUTHORIZER
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CowGateway, type QuoteNetwork } from "@codingsh/x402-cow";
import { walletFromEnv } from "@codingsh/x402-cow-wallets";

const NETWORKS = [
  "mainnet", "base", "bnb", "xdai", "polygon",
  "arbitrum_one", "avalanche", "ink", "sepolia", "linea", "plasma",
] as const;

async function buildGateway(): Promise<CowGateway> {
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) throw new Error("RPC_URL is not set");
  // Smart-wallet layer: WALLET_PROVIDER = private-key (default) | privy | cdp.
  const wallet = await walletFromEnv();
  return new CowGateway({
    wallet,
    rpcUrl,
    baseUrl: process.env.X402_BASE_URL,
    paymentNetwork: process.env.PAYMENT_NETWORK,
    asset: process.env.ASSET,
    stateDir: process.env.STATE_DIR,
    maxQuoteUsdc: process.env.MAX_QUOTE_USDC,
    maxDepositUsdc: process.env.MAX_DEPOSIT_USDC,
    maxWithdrawDelayHours: process.env.MAX_WITHDRAW_DELAY_HOURS
      ? Number(process.env.MAX_WITHDRAW_DELAY_HOURS)
      : undefined,
    expectedPayTo: process.env.EXPECTED_PAYTO,
    expectedReceiverAuthorizer: process.env.EXPECTED_RECEIVER_AUTHORIZER,
  });
}

// Lazily construct so the process can start even before env is complete;
// errors surface as tool errors instead of crashing the transport.
let gatewayPromise: Promise<CowGateway> | undefined;
function gw(): Promise<CowGateway> {
  return (gatewayPromise ??= buildGateway());
}

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});
const fail = (e: unknown) => ({
  content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});

const server = new McpServer({ name: "x402-cow", version: "0.1.0" });

server.registerTool(
  "x402_cow_quote",
  {
    title: "Get a CoW Protocol swap quote",
    description:
      "Fetch a paid CoW Protocol swap quote over x402 (pay-per-quote in USDC). Token amounts are atomic (scaled by the token's decimals). Provide exactly one amount field matching `kind`.",
    inputSchema: {
      network: z.enum(NETWORKS).describe("Quote network (independent of the payment network)."),
      sellToken: z.string().describe("ERC-20 address to sell."),
      buyToken: z.string().describe("ERC-20 address to buy."),
      from: z.string().describe("Trader address."),
      kind: z.enum(["sell", "buy"]),
      sellAmountBeforeFee: z.string().optional().describe("Atomic sell amount (kind=sell)."),
      sellAmountAfterFee: z.string().optional(),
      buyAmountAfterFee: z.string().optional().describe("Atomic buy amount (kind=buy)."),
      receiver: z.string().optional(),
    },
  },
  async (args) => {
    try {
      const result = await (await gw()).quote({ ...args, network: args.network as QuoteNetwork });
      return ok(result);
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "x402_cow_inspect",
  {
    title: "Inspect x402 payment terms",
    description:
      "Read the current x402 payment terms (price per quote, minimum deposit, withdrawal delay) for a network without signing or paying.",
    inputSchema: {
      network: z.enum(NETWORKS).describe("Quote network to inspect."),
    },
  },
  async (args) => {
    try {
      const terms = await (await gw()).inspect(args.network as QuoteNetwork);
      return ok(terms);
    } catch (e) {
      return fail(e);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
