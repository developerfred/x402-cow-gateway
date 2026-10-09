/**
 * Coinbase CDP server-wallet provider.
 *
 * Backs x402 signing with a Coinbase Developer Platform server wallet, wrapped
 * as a viem account. Requires the optional peer dep `@coinbase/cdp-sdk`.
 */
import { CdpClient } from "@coinbase/cdp-sdk";
import { toAccount } from "viem/accounts";
import type { LocalAccount } from "viem";
import type { WalletProvider } from "@codingsh/x402-cow";

export interface CdpWalletOptions {
  /** CDP API key id. Falls back to CDP_API_KEY_ID. */
  apiKeyId?: string;
  /** CDP API key secret. Falls back to CDP_API_KEY_SECRET. */
  apiKeySecret?: string;
  /** CDP wallet secret (signing). Falls back to CDP_WALLET_SECRET. */
  walletSecret?: string;
  /** Named server account to get-or-create. Default "x402-cow-gateway". */
  accountName?: string;
}

export class CdpWallet implements WalletProvider {
  readonly kind = "cdp";
  private readonly cdp: CdpClient;
  private account?: LocalAccount;

  constructor(private readonly opts: CdpWalletOptions = {}) {
    this.cdp = new CdpClient({
      apiKeyId: opts.apiKeyId,
      apiKeySecret: opts.apiKeySecret,
      walletSecret: opts.walletSecret,
    });
  }

  async getAccount(): Promise<LocalAccount> {
    if (!this.account) {
      const server = await this.cdp.evm.getOrCreateAccount({
        name: this.opts.accountName ?? "x402-cow-gateway",
      });
      // The CDP server account exposes address/signMessage/signTypedData; viem's
      // toAccount wraps that CustomSource object as a LocalAccount for the x402
      // signer. Cast to the param type — the runtime object must be passed as-is.
      this.account = toAccount(server as unknown as Parameters<typeof toAccount>[0]) as LocalAccount;
    }
    return this.account;
  }
}
