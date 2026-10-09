/**
 * Pluggable fee policy for the x402 CoW Gateway.
 *
 * All money is handled in ATOMIC USDC units (6 decimals) as `bigint` to avoid
 * floating-point drift. $1.00 === 1_000_000n.
 *
 * The gateway is both:
 *  - a resource SERVER to the agent (agent pays us), and
 *  - a BUYER to cow.fi (we pay cow.fi $0.001/quote out of our operator tab).
 *
 * Every policy returns a `Quote` splitting the agent's payment into:
 *  - `cowCost`  → the underlying cost we owe cow.fi
 *  - `fee`      → our margin, which ALWAYS accrues to codingsh.eth (`feeTo`)
 *  - `total`    → what the agent is charged (cowCost + fee)
 *
 * v1 collects to a single operator `payTo` and sweeps `fee` to `feeTo`.
 * v2 can pay `feeTo` atomically using x402 v2 `exact` scheme splits
 * (PaymentRequirements.extra.splits) — see README "Roadmap".
 */

export const USDC_DECIMALS = 6;

/** Parse a decimal USD string (e.g. "0.002") into atomic USDC units. */
export function usd(amount: string): bigint {
  const [whole, frac = ""] = amount.split(".");
  const fracPadded = (frac + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  return BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) + BigInt(fracPadded || "0");
}

/** Format atomic USDC units back to a human "$0.002000" string. */
export function formatUsd(atomic: bigint): string {
  const neg = atomic < 0n;
  const abs = neg ? -atomic : atomic;
  const whole = abs / 10n ** BigInt(USDC_DECIMALS);
  const frac = (abs % 10n ** BigInt(USDC_DECIMALS))
    .toString()
    .padStart(USDC_DECIMALS, "0");
  return `${neg ? "-" : ""}$${whole}.${frac}`;
}

export type Endpoint = "quote" | "best-route" | "simulate" | "quote-plus";

export interface PriceContext {
  endpoint: Endpoint;
  /** cow.fi quote network (base, mainnet, bnb, ...). */
  network: string;
  /** How many underlying cow.fi quotes this request will consume (>=1). */
  cowCalls: number;
}

export interface Quote {
  endpoint: Endpoint;
  /** atomic USDC the agent pays us. */
  total: bigint;
  /** atomic USDC we owe cow.fi. */
  cowCost: bigint;
  /** atomic USDC margin → codingsh.eth. */
  fee: bigint;
}

export interface FeePolicy {
  readonly name: string;
  price(ctx: PriceContext): Quote;
}

/** What cow.fi charges us per underlying quote today ($0.001). */
export const COW_UNIT_COST = usd("0.001");

/**
 * Cost-plus with a fixed per-call floor (RECOMMENDED v1 default).
 * A flat percentage on a $0.001 base is economically meaningless, so we add a
 * fixed fee instead → predictable, round, easy to advertise ("quotes at $0.002").
 */
export class FlatMarkupPolicy implements FeePolicy {
  readonly name = "flat-markup";
  constructor(private readonly feePerCall: bigint = usd("0.001")) {}

  price(ctx: PriceContext): Quote {
    const cowCost = COW_UNIT_COST * BigInt(ctx.cowCalls);
    const fee = this.feePerCall * BigInt(ctx.cowCalls);
    return { endpoint: ctx.endpoint, cowCost, fee, total: cowCost + fee };
  }
}

/** Percentage markup over the underlying cost (cost * (1 + bps/10000)). */
export class BpsMarkupPolicy implements FeePolicy {
  readonly name = "bps-markup";
  constructor(private readonly bps: bigint = 10_000n /* +100% */) {}

  price(ctx: PriceContext): Quote {
    const cowCost = COW_UNIT_COST * BigInt(ctx.cowCalls);
    const fee = (cowCost * this.bps) / 10_000n;
    return { endpoint: ctx.endpoint, cowCost, fee, total: cowCost + fee };
  }
}

/**
 * Value-based tiered pricing. Base quote stays near cost to win volume;
 * premium endpoints that bundle work (multi-network best-route, simulation,
 * gas+MEV enrichment) carry real margin. This is where the business earns.
 */
export class TieredPolicy implements FeePolicy {
  readonly name = "tiered";
  private readonly table: Record<Endpoint, bigint> = {
    quote: usd("0.002"),
    "best-route": usd("0.005"),
    simulate: usd("0.005"),
    "quote-plus": usd("0.008"),
  };
  constructor(overrides: Partial<Record<Endpoint, bigint>> = {}) {
    this.table = { ...this.table, ...overrides };
  }

  price(ctx: PriceContext): Quote {
    const total = this.table[ctx.endpoint];
    const cowCost = COW_UNIT_COST * BigInt(ctx.cowCalls);
    const fee = total - cowCost;
    if (fee < 0n) {
      throw new Error(
        `TieredPolicy: price ${formatUsd(total)} for "${ctx.endpoint}" is below cow.fi cost ${formatUsd(cowCost)}`,
      );
    }
    return { endpoint: ctx.endpoint, total, cowCost, fee };
  }
}

/** Build the active policy from env (FEE_POLICY=flat|bps|tiered). */
export function policyFromEnv(env: NodeJS.ProcessEnv = process.env): FeePolicy {
  switch ((env.FEE_POLICY ?? "tiered").toLowerCase()) {
    case "flat":
      return new FlatMarkupPolicy(env.FEE_PER_CALL ? usd(env.FEE_PER_CALL) : undefined);
    case "bps":
      return new BpsMarkupPolicy(env.FEE_BPS ? BigInt(env.FEE_BPS) : undefined);
    case "tiered":
    default:
      return new TieredPolicy();
  }
}
