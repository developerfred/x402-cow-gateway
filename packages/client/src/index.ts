/**
 * @codingsh/x402-cow — typed SDK to fetch CoW Protocol swap quotes over the
 * x402 pay-per-quote protocol (batch-settlement scheme).
 *
 * Modeled on the official x402.cow.fi buyer example. It speaks x402 against any
 * batch-settlement quote server — the x402 CoW Gateway (default) or x402.cow.fi
 * directly — opening a USDC "tab" once and paying per quote with signed vouchers.
 *
 * The signing account comes from a pluggable WalletProvider (raw key, Privy,
 * Coinbase CDP, ...), so an agent never has to hard-code a private key.
 *
 * Powered by codingsh — https://github.com/developerfred/x402-cow-gateway (codingsh.eth)
 */
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
} from "@x402/core/http";
import { BatchSettlementEvmScheme } from "@x402/evm/batch-settlement/client";
import { FileClientChannelStorage } from "@x402/evm/batch-settlement/client/file-storage";
import { toClientEvmSigner } from "@x402/evm";
import { createPublicClient, http, parseUnits, formatUnits } from "viem";
import { base, mainnet, bsc } from "viem/chains";
import type { Chain } from "viem";
import type { Network } from "@x402/fetch";
import { PrivateKeyWallet, type WalletProvider } from "./wallet.js";

export { PrivateKeyWallet, type WalletProvider } from "./wallet.js";

/** Default base URL — the x402 CoW Gateway. Point at COWFI_BASE to hit cow.fi directly. */
export const GATEWAY_BASE = "https://gateway.codingsh.dev";
/** The upstream x402.cow.fi base URL (no gateway fee). */
export const COWFI_BASE = "https://x402.cow.fi";

/** Base USDC, the default payment asset. */
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** Payment-network (eip155:*) → viem chain. */
const PAYMENT_CHAINS: Record<string, Chain> = {
  "eip155:8453": base,
  "eip155:1": mainnet,
  "eip155:56": bsc,
};

export type QuoteNetwork =
  | "mainnet" | "base" | "bnb" | "xdai" | "polygon"
  | "arbitrum_one" | "avalanche" | "ink" | "sepolia" | "linea" | "plasma";

export interface CowGatewayOptions {
  /**
   * Signing wallet. Provide a WalletProvider (Privy/CDP/raw) OR the convenience
   * `walletPrivateKey`. Exactly one is required.
   */
  wallet?: WalletProvider;
  /** Convenience: a raw private key, wrapped in a PrivateKeyWallet. */
  walletPrivateKey?: `0x${string}`;
  /** JSON-RPC URL for the PAYMENT network (must match `paymentNetwork`). */
  rpcUrl: string;
  /** Quote server base URL. Defaults to the x402 CoW Gateway. */
  baseUrl?: string;
  /** Payment network as an eip155 id. Default "eip155:8453" (Base). */
  paymentNetwork?: string;
  /** Payment asset (ERC-20) address. Default Base USDC. */
  asset?: string;
  /** Directory for persistent channel/tab state. Default "./.x402-state". */
  stateDir?: string;
  /** Max you will pay per quote, in USDC (<=6 decimals). Default "0.01". */
  maxQuoteUsdc?: string;
  /** Max you will deposit when opening/topping up the tab, in USDC. Default "1". */
  maxDepositUsdc?: string;
  /** Max channel withdrawal delay you will accept, in hours. Default 24. */
  maxWithdrawDelayHours?: number;
  /** If set, only sign challenges whose payTo matches (recommended for a known server). */
  expectedPayTo?: string;
  /** If set, only sign challenges whose extra.receiverAuthorizer matches. */
  expectedReceiverAuthorizer?: string;
}

export interface QuoteParams {
  /** Quote network (independent of the payment network). */
  network: QuoteNetwork;
  sellToken: string;
  buyToken: string;
  /** Trader address the quote is for. */
  from: string;
  kind: "sell" | "buy";
  /** Exactly one of these, matching `kind`. All in atomic token units. */
  sellAmountBeforeFee?: string;
  sellAmountAfterFee?: string;
  buyAmountAfterFee?: string;
  receiver?: string;
  validTo?: number;
  validFor?: number;
  appData?: string;
  priceQuality?: "fast" | "optimal" | "verified";
}

export interface QuoteResult {
  /** The CoW Protocol quote object. */
  quote: Record<string, unknown>;
  /** Full decoded response body. */
  raw: Record<string, unknown>;
  /** USDC actually charged for this quote (human string). */
  chargedUsdc: string;
  /** Payment network the charge settled on. */
  paymentNetwork: string;
}

export class CowGatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
    readonly body?: string,
  ) {
    super(message);
    this.name = "CowGatewayError";
  }
}

type PaidFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * A pay-per-quote CoW Protocol client. One instance holds one payment channel
 * (tab). Requests sharing a channel are serialized internally by the SDK — do
 * not fan out concurrent `quote()` calls on the same instance.
 *
 * The payment client is built lazily on first `quote()`, because resolving the
 * wallet account may be async (remote providers).
 */
export class CowGateway {
  private readonly baseUrl: string;
  private readonly paymentNetwork: Network;
  private readonly asset: string;
  private readonly chain: Chain;
  private readonly rpcUrl: string;
  private readonly stateDir: string;
  private readonly wallet: WalletProvider;
  private readonly maxQuote: bigint;
  private readonly maxDeposit: bigint;
  private readonly maxDelay: number;
  private readonly payToLc?: string;
  private readonly authLc?: string;
  private readonly plainFetch = globalThis.fetch;

  private paidFetch?: PaidFetch;
  private readyPromise?: Promise<void>;

  constructor(opts: CowGatewayOptions) {
    if (!opts.wallet && !opts.walletPrivateKey) {
      throw new Error("Provide either `wallet` (a WalletProvider) or `walletPrivateKey`");
    }
    if (opts.wallet && opts.walletPrivateKey) {
      throw new Error("Provide only one of `wallet` or `walletPrivateKey`, not both");
    }
    if (!opts.rpcUrl) throw new Error("rpcUrl is required for the payment network");

    this.wallet = opts.wallet ?? new PrivateKeyWallet(opts.walletPrivateKey as `0x${string}`);
    this.baseUrl = (opts.baseUrl ?? GATEWAY_BASE).replace(/\/$/, "");
    this.paymentNetwork = (opts.paymentNetwork ?? "eip155:8453") as Network;
    this.asset = opts.asset ?? BASE_USDC;
    this.rpcUrl = opts.rpcUrl;
    this.stateDir = opts.stateDir ?? "./.x402-state";

    const chain = PAYMENT_CHAINS[this.paymentNetwork];
    if (!chain) {
      throw new Error(
        `Unsupported paymentNetwork "${this.paymentNetwork}". Supported: ${Object.keys(PAYMENT_CHAINS).join(", ")}`,
      );
    }
    this.chain = chain;

    this.maxQuote = parseUnits(opts.maxQuoteUsdc ?? "0.01", 6);
    this.maxDeposit = parseUnits(opts.maxDepositUsdc ?? "1", 6);
    this.maxDelay = (opts.maxWithdrawDelayHours ?? 24) * 3600;
    if (this.maxQuote <= 0n || this.maxDeposit < this.maxQuote || this.maxDelay <= 0) {
      throw new Error("Invalid spend limits: require 0 < maxQuote <= maxDeposit and maxDelay > 0");
    }

    this.payToLc = opts.expectedPayTo?.toLowerCase();
    this.authLc = opts.expectedReceiverAuthorizer?.toLowerCase();
  }

  /** Which wallet provider backs this client (e.g. "private-key", "privy", "cdp"). */
  get walletKind(): string {
    return this.wallet.kind;
  }

  /** Build the x402 payment client once; subsequent calls reuse it. */
  private ensureReady(): Promise<void> {
    return (this.readyPromise ??= this.buildPaidFetch());
  }

  private async buildPaidFetch(): Promise<void> {
    const account = await this.wallet.getAccount();
    const publicClient = createPublicClient({ chain: this.chain, transport: http(this.rpcUrl) });
    const signer = toClientEvmSigner(account, publicClient);

    const assetLc = this.asset.toLowerCase();
    const { paymentNetwork, maxQuote, maxDeposit, maxDelay, payToLc, authLc } = this;

    const client = new x402Client().register(
      paymentNetwork,
      new BatchSettlementEvmScheme(signer, {
        storage: new FileClientChannelStorage({ directory: this.stateDir }),
        depositStrategy: ({ depositAmount }: { depositAmount: string }) => {
          if (BigInt(depositAmount) > maxDeposit) {
            throw new CowGatewayError("Requested deposit exceeds maxDepositUsdc", 402, "deposit_over_limit");
          }
          return depositAmount;
        },
      }),
    );

    // Only ever sign terms that pass every spend guard (and the optional server pins).
    client.registerPolicy((_version: number, requirements: any[]) =>
      requirements.filter((r) =>
        r.scheme === "batch-settlement" &&
        r.network === paymentNetwork &&
        typeof r.asset === "string" && r.asset.toLowerCase() === assetLc &&
        (payToLc === undefined || (typeof r.payTo === "string" && r.payTo.toLowerCase() === payToLc)) &&
        (authLc === undefined ||
          (typeof r.extra?.receiverAuthorizer === "string" &&
            r.extra.receiverAuthorizer.toLowerCase() === authLc)) &&
        typeof r.amount === "string" && /^\d+$/.test(r.amount) &&
        BigInt(r.amount) > 0n && BigInt(r.amount) <= maxQuote &&
        typeof r.extra?.minDeposit === "string" && /^\d+$/.test(r.extra.minDeposit) &&
        BigInt(r.extra.minDeposit) > 0n && BigInt(r.extra.minDeposit) <= maxDeposit &&
        typeof r.extra?.withdrawDelay === "number" &&
        Number.isSafeInteger(r.extra.withdrawDelay) &&
        r.extra.withdrawDelay > 0 && r.extra.withdrawDelay <= maxDelay,
      ),
    );

    client.setSpendControls({
      allowedAssets: [
        { network: paymentNetwork, asset: this.asset, maxAmountPerPayment: maxDeposit.toString() },
      ],
    });

    this.paidFetch = wrapFetchWithPayment(this.plainFetch, client);
  }

  /** Read current payment terms for a quote network without signing or paying. */
  async inspect(network: QuoteNetwork): Promise<ReturnType<typeof decodePaymentRequiredHeader>> {
    const res = await this.plainFetch(`${this.baseUrl}/${network}/api/v1/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const header = res.headers.get("PAYMENT-REQUIRED");
    if (res.status !== 402 || !header) {
      throw new CowGatewayError("No payment challenge returned", res.status, undefined, await res.text());
    }
    return decodePaymentRequiredHeader(header);
  }

  /** Fetch a paid CoW Protocol quote. Pays per call via the x402 tab. */
  async quote(params: QuoteParams): Promise<QuoteResult> {
    await this.ensureReady();
    const paidFetch = this.paidFetch!;
    const { network, ...body } = params;
    const res = await paidFetch(`${this.baseUrl}/${network}/api/v1/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    const responseHeader = res.headers.get("PAYMENT-RESPONSE");
    const requiredHeader = res.headers.get("PAYMENT-REQUIRED");
    const receipt = responseHeader ? decodePaymentResponseHeader(responseHeader) : undefined;

    if (res.status !== 200 || receipt?.success !== true) {
      const reason =
        receipt?.errorReason ??
        (requiredHeader ? decodePaymentRequiredHeader(requiredHeader).error : undefined);
      throw new CowGatewayError(
        `Quote payment did not settle (status ${res.status})`,
        res.status,
        reason as string | undefined,
        text,
      );
    }

    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!parsed.quote) {
      throw new CowGatewayError("Successful response without a quote", res.status, undefined, text);
    }

    const charged = (receipt.extra as Record<string, unknown> | undefined)?.chargedAmount;
    const chargedUsdc =
      typeof charged === "string" && /^\d+$/.test(charged) ? formatUnits(BigInt(charged), 6) : "0";

    return {
      quote: parsed.quote as Record<string, unknown>,
      raw: parsed,
      chargedUsdc,
      paymentNetwork: receipt.network,
    };
  }
}
