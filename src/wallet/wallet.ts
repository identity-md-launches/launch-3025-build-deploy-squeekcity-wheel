import { createWalletClient, custom, getAddress, type EIP1193Provider } from "viem";
import { sepolia } from "viem/chains";

/** EIP-6963 provider discovery plus a legacy window.ethereum fallback. Nothing is signed or paid. */
export interface DiscoveredWallet { uuid: string; name: string; icon: string; rdns: string; provider: EIP1193Provider }

export const TARGET_CHAIN = sepolia; // chain id 11155111
const LAST_KEY = "squeekcity.wallet.rdns";

export function discoverWallets(onChange: (w: DiscoveredWallet[]) => void): () => void {
  const found = new Map<string, DiscoveredWallet>();
  const handler = (e: Event) => {
    const d = (e as CustomEvent).detail as { info?: { uuid: string; name: string; icon: string; rdns: string }; provider?: EIP1193Provider };
    if (!d?.info || !d.provider) return;
    found.set(d.info.uuid, { ...d.info, provider: d.provider });
    onChange([...found.values()]);
  };
  window.addEventListener("eip6963:announceProvider", handler);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const legacy = (window as unknown as { ethereum?: EIP1193Provider & { isMetaMask?: boolean; isRabby?: boolean; isOkxWallet?: boolean } }).ethereum;
  const t = window.setTimeout(() => {
    if (found.size === 0 && legacy) {
      const name = legacy.isRabby ? "Rabby" : legacy.isOkxWallet ? "OKX Wallet" : legacy.isMetaMask ? "MetaMask" : "Browser wallet";
      found.set("legacy", { uuid: "legacy", name, icon: "", rdns: "legacy", provider: legacy });
      onChange([...found.values()]);
    }
  }, 400);
  return () => { window.removeEventListener("eip6963:announceProvider", handler); window.clearTimeout(t); };
}

export interface Session { wallet: DiscoveredWallet; address: `0x${string}`; chainId: number }

export async function connect(wallet: DiscoveredWallet): Promise<Session> {
  const client = createWalletClient({ transport: custom(wallet.provider) });
  const [address] = await client.requestAddresses();
  const chainId = await client.getChainId();
  localStorage.setItem(LAST_KEY, wallet.rdns);
  return { wallet, address: getAddress(address), chainId };
}

/** Silent reconnect: eth_accounts never opens a prompt. */
export async function tryReconnect(wallets: DiscoveredWallet[]): Promise<Session | null> {
  const rdns = localStorage.getItem(LAST_KEY);
  const w = wallets.find((x) => x.rdns === rdns);
  if (!w) return null;
  const accounts = (await w.provider.request({ method: "eth_accounts" })) as string[];
  if (!accounts?.length) return null;
  const chainId = parseInt((await w.provider.request({ method: "eth_chainId" })) as string, 16);
  return { wallet: w, address: getAddress(accounts[0]), chainId };
}

export async function switchToSepolia(wallet: DiscoveredWallet): Promise<void> {
  const client = createWalletClient({ transport: custom(wallet.provider) });
  try {
    await client.switchChain({ id: TARGET_CHAIN.id });
  } catch (e) {
    const code = (e as { code?: number; cause?: { code?: number } }).code ?? (e as { cause?: { code?: number } }).cause?.code;
    if (code === 4902) await client.addChain({ chain: TARGET_CHAIN });
    else throw e;
  }
}

export async function disconnect(wallet: DiscoveredWallet): Promise<void> {
  localStorage.removeItem(LAST_KEY);
  try { await wallet.provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] } as never); } catch { /* not every wallet supports revoking */ }
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Phones have no extensions: open this page inside a wallet's own browser. */
export const OPEN_IN: ReadonlyArray<{ id: string; name: string; href: (url: string) => string }> = [
  { id: "metamask", name: "MetaMask", href: (url) => `https://link.metamask.io/dapp/${url.replace(/^https?:\/\//, "")}` },
  { id: "rabby", name: "Rabby", href: (url) => `https://go.rabby.io/mobile/dapp?url=${encodeURIComponent(url)}` },
  { id: "okx", name: "OKX Wallet", href: (url) => `https://www.okx.com/download?deeplink=${encodeURIComponent(`okx://wallet/dapp/url?dappUrl=${encodeURIComponent(url)}`)}` },
];
export const isMobileBrowser = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && !(window as unknown as { ethereum?: unknown }).ethereum;
