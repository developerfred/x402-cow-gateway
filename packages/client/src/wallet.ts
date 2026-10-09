/**
 * Wallet abstraction for the x402 CoW Gateway.
 *
 * The x402 batch-settlement flow needs a viem account that can sign EIP-712
 * typed data (the payment vouchers). A `WalletProvider` yields exactly that,
 * so the signer can be backed by a raw key, a Privy server wallet, a Coinbase
 * CDP server wallet, or any future provider — without changing the gateway.
 *
 * Heavier providers (Privy, CDP) live in `@codingsh/x402-cow-wallets` so this
 * core package stays dependency-light. This file ships the always-available
 * raw-key provider.
 */
import { privateKeyToAccount } from "viem/accounts";
import type { LocalAccount } from "viem";

/** Produces a signing-capable viem account for the x402 payment flow. */
export interface WalletProvider {
  /** Short identifier for logs/telemetry (e.g. "private-key", "privy", "cdp"). */
  readonly kind: string;
  /**
   * Resolve the viem account used to sign x402 vouchers. May be async (remote
   * providers fetch/provision the account). Implementations should memoize.
   */
  getAccount(): Promise<LocalAccount>;
}

/** Raw-private-key wallet. Simplest provider; key lives in the runtime process. */
export class PrivateKeyWallet implements WalletProvider {
  readonly kind = "private-key";
  private readonly account: LocalAccount;

  constructor(privateKey: `0x${string}`) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
      throw new Error("privateKey must be a 0x-prefixed 32-byte hex string");
    }
    this.account = privateKeyToAccount(privateKey);
  }

  async getAccount(): Promise<LocalAccount> {
    return this.account;
  }
}
