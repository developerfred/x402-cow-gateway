/**
 * @codingsh/x402-cow-wallets — smart-wallet providers for the x402 CoW Gateway.
 *
 * Lets an agent back x402 payments with a custodied server wallet (Privy or
 * Coinbase CDP) instead of a raw private key, so no bare key lives in the agent.
 * Each provider yields a viem account the gateway uses to sign x402 vouchers.
 *
 * Note: Stripe is NOT here — Stripe's x402 is merchant-side settlement (the
 * gateway accepts agent payments and settles to a Stripe balance), not a payer
 * wallet. That belongs on the seller/gateway side; see the gateway README.
 *
 * Powered by codingsh — https://github.com/developerfred/x402-cow-gateway (codingsh.eth)
 */
import { PrivateKeyWallet, type WalletProvider } from "@codingsh/x402-cow";

export { PrivyWallet, type PrivyWalletOptions } from "./privy.js";
export { CdpWallet, type CdpWalletOptions } from "./cdp.js";
export { PrivateKeyWallet, type WalletProvider } from "@codingsh/x402-cow";

/**
 * Build a WalletProvider from environment variables. Select with
 * WALLET_PROVIDER = "private-key" | "privy" | "cdp" (default "private-key").
 * Providers are imported lazily so unused SDKs need not be installed.
 */
export async function walletFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<WalletProvider> {
  const which = (env.WALLET_PROVIDER ?? "private-key").toLowerCase();
  switch (which) {
    case "private-key": {
      const key = env.WALLET_PRIVATE_KEY;
      if (!key) throw new Error("WALLET_PRIVATE_KEY is required for WALLET_PROVIDER=private-key");
      return new PrivateKeyWallet(key as `0x${string}`);
    }
    case "privy": {
      const { PrivyWallet } = await import("./privy.js");
      return new PrivyWallet({
        appId: req(env, "PRIVY_APP_ID"),
        appSecret: req(env, "PRIVY_APP_SECRET"),
        walletId: req(env, "PRIVY_WALLET_ID"),
        address: req(env, "PRIVY_WALLET_ADDRESS") as `0x${string}`,
        authorizationPrivateKey: env.PRIVY_AUTHORIZATION_KEY,
      });
    }
    case "cdp": {
      const { CdpWallet } = await import("./cdp.js");
      return new CdpWallet({
        apiKeyId: env.CDP_API_KEY_ID,
        apiKeySecret: env.CDP_API_KEY_SECRET,
        walletSecret: env.CDP_WALLET_SECRET,
        accountName: env.CDP_ACCOUNT_NAME,
      });
    }
    default:
      throw new Error(`Unknown WALLET_PROVIDER "${which}" (use private-key | privy | cdp)`);
  }
}

function req(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
