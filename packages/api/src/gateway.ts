/**
 * Gateway business logic — the x402-free core.
 *
 * On a paid request the server (server.ts) has already collected payment from
 * the agent via x402. Here we fetch the real CoW Protocol quote from upstream
 * (x402.cow.fi), apply the fee policy, and record the margin owed to codingsh.eth.
 */
import { CowGateway, COWFI_BASE, type QuoteNetwork } from "@codingsh/x402-cow";
import { policyFromEnv, formatUsd, type Endpoint, type Quote } from "./pricing.js";

export interface GatewayConfig {
  /** Operator wallet that funds the upstream cow.fi tab. */
  opsWalletPrivateKey: `0x${string}`;
  /** RPC URL for the upstream payment network. */
  opsRpcUrl: string;
  /** Upstream quote server. Defaults to x402.cow.fi. */
  upstreamBaseUrl?: string;
  /** Channel-state dir for the upstream tab. */
  stateDir?: string;
}

const policy = policyFromEnv();
let upstream: CowGateway | undefined;

function upstreamGateway(cfg: GatewayConfig): CowGateway {
  return (upstream ??= new CowGateway({
    walletPrivateKey: cfg.opsWalletPrivateKey,
    rpcUrl: cfg.opsRpcUrl,
    baseUrl: cfg.upstreamBaseUrl ?? COWFI_BASE,
    stateDir: cfg.stateDir ?? "./.x402-ops-state",
  }));
}

export interface QuoteOutcome {
  quote: Record<string, unknown>;
  raw: Record<string, unknown>;
  pricing: {
    endpoint: Endpoint;
    chargedToAgent: string;
    gatewayFee: string;
    upstreamCost: string;
    feeRecipient: string;
  };
}

/** The recipient of every gateway fee. Resolve the ENS to an address for on-chain settlement. */
export function feeRecipient(): string {
  return process.env.FEE_RECIPIENT ?? "codingsh.eth";
}

/**
 * Fetch an upstream quote, apply the fee policy, and emit a fee-ledger record.
 * The agent has already paid the gateway (via x402) before this runs.
 */
export async function handleQuote(
  cfg: GatewayConfig,
  network: QuoteNetwork,
  body: Record<string, unknown>,
  endpoint: Endpoint = "quote",
): Promise<QuoteOutcome> {
  const gw = upstreamGateway(cfg);
  const res = await gw.quote({ ...(body as object), network } as Parameters<CowGateway["quote"]>[0]);

  const priced: Quote = policy.price({ endpoint, network, cowCalls: 1 });
  recordFee(endpoint, network, priced, res.chargedUsdc);

  return {
    quote: res.quote,
    raw: res.raw,
    pricing: {
      endpoint,
      chargedToAgent: formatUsd(priced.total),
      gatewayFee: formatUsd(priced.fee),
      upstreamCost: formatUsd(priced.cowCost),
      feeRecipient: feeRecipient(),
    },
  };
}

/**
 * Append-only fee ledger. v1 logs the accrued margin; a sweeper forwards it to
 * codingsh.eth (or use x402 v2 `exact` splits to pay it atomically — see README).
 */
function recordFee(endpoint: Endpoint, network: string, priced: Quote, upstreamChargedUsdc: string): void {
  console.log(
    JSON.stringify({
      type: "fee_ledger",
      ts: new Date().toISOString(),
      endpoint,
      network,
      chargedToAgent: formatUsd(priced.total),
      gatewayFee: formatUsd(priced.fee),
      upstreamCost: formatUsd(priced.cowCost),
      upstreamChargedUsdc,
      feeRecipient: feeRecipient(),
    }),
  );
}
