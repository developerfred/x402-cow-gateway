/**
 * Privy server-wallet provider.
 *
 * Backs x402 signing with a Privy server wallet — the agent never holds a raw
 * key; Privy custodies it and signs EIP-712 vouchers on request. Requires the
 * optional peer dep `@privy-io/node`.
 */
import { PrivyClient } from "@privy-io/node";
import { createViemAccount } from "@privy-io/node/viem";
import type { LocalAccount } from "viem";
import type { WalletProvider } from "@codingsh/x402-cow";

export interface PrivyWalletOptions {
  /** Privy app id. */
  appId: string;
  /** Privy app secret. */
  appSecret: string;
  /** The Privy wallet id to sign with. */
  walletId: string;
  /** The wallet's EVM address. */
  address: `0x${string}`;
  /** Optional authorization key (P-256) when the wallet is owner-gated. */
  authorizationPrivateKey?: string;
}

export class PrivyWallet implements WalletProvider {
  readonly kind = "privy";
  private readonly client: PrivyClient;
  private account?: LocalAccount;

  constructor(private readonly opts: PrivyWalletOptions) {
    if (!opts.appId || !opts.appSecret) throw new Error("PrivyWallet needs appId and appSecret");
    if (!opts.walletId || !opts.address) throw new Error("PrivyWallet needs walletId and address");
    this.client = new PrivyClient({ appId: opts.appId, appSecret: opts.appSecret });
  }

  async getAccount(): Promise<LocalAccount> {
    if (!this.account) {
      const acc = createViemAccount(this.client, {
        walletId: this.opts.walletId,
        address: this.opts.address,
        ...(this.opts.authorizationPrivateKey
          ? { authorizationContext: { authorization_private_keys: [this.opts.authorizationPrivateKey] } }
          : {}),
      });
      // PrivyViemAccount is a LocalAccount with a Privy-specific signTransaction;
      // the x402 tab flow only needs signTypedData/signMessage.
      this.account = acc as unknown as LocalAccount;
    }
    return this.account;
  }
}
