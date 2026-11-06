import { useEffect, useRef, useState } from "react";
import { OPEN_IN, TARGET_CHAIN, connect, disconnect, discoverWallets, isMobileBrowser, shortAddr, switchToSepolia, tryReconnect, type DiscoveredWallet, type Session } from "../wallet/wallet";

const WALLET_MARKS: Record<string, string> = {
  metamask: "#f6851b", rabby: "#7084ff", okx: "#1a1a20",
};

export function WalletControl() {
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const mobile = isMobileBrowser();

  useEffect(() => discoverWallets(setWallets), []);
  useEffect(() => {
    if (session || !wallets.length) return;
    tryReconnect(wallets).then((s) => s && setSession(s)).catch(() => undefined);
  }, [wallets, session]);
  useEffect(() => {
    if (!session) return;
    const p = session.wallet.provider;
    const onAcc = (a: unknown) => { const list = a as string[]; if (!list?.length) setSession(null); else setSession((s) => s && { ...s, address: list[0] as `0x${string}` }); };
    const onChain = (c: unknown) => setSession((s) => s && { ...s, chainId: parseInt(String(c), 16) });
    p.on?.("accountsChanged", onAcc as never); p.on?.("chainChanged", onChain as never);
    return () => { p.removeListener?.("accountsChanged", onAcc as never); p.removeListener?.("chainChanged", onChain as never); };
  }, [session?.wallet]);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    sheet.current?.querySelector<HTMLElement>("button, a")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    addEventListener("keydown", onKey);
    return () => { removeEventListener("keydown", onKey); (prev ?? trigger.current)?.focus(); };
  }, [open]);

  async function pickWallet(w: DiscoveredWallet) {
    setPending(w.uuid); setNote(null);
    try { setSession(await connect(w)); setOpen(false); }
    catch (e) { setNote((e as { shortMessage?: string }).shortMessage ?? "The wallet did not connect. Try again when you're ready."); }
    finally { setPending(null); }
  }

  if (session) {
    const wrong = session.chainId !== TARGET_CHAIN.id;
    return (
      <div className="wallet-on">
        {wrong ? (
          <button className="btn btn-accent" onClick={async () => {
            setNote(null);
            try { await switchToSepolia(session.wallet); } catch { setNote("Network switch was declined."); }
          }}>Switch to Sepolia</button>
        ) : <span className="chip" title={`Connected with ${session.wallet.name} on Ethereum Sepolia`}>Sepolia</span>}
        <button className="btn" onClick={async () => { await disconnect(session.wallet); setSession(null); }} aria-label={`Disconnect ${session.address}`}>
          <span className="mono">{shortAddr(session.address)}</span> · Disconnect
        </button>
        {note && <span className="wallet-note" role="status">{note}</span>}
      </div>
    );
  }
  return (
    <>
      <button ref={trigger} className="btn btn-accent" onClick={() => setOpen(true)}>Connect</button>
      {open && (
        <div className="sheet-bg" onClick={() => setOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="wallet-title" ref={sheet} onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2 id="wallet-title">Connect a wallet</h2>
              <button className="x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>
            <p className="muted small">Optional. SqueekCity never asks for a payment, approval or signature. Connecting shows your address on Ethereum Sepolia.</p>
            {wallets.filter(() => !mobile || wallets.length > 0).map((w) => (
              <button key={w.uuid} className="row" disabled={!!pending} onClick={() => pickWallet(w)}>
                <span className="ic">{w.icon ? <img width={28} height={28} src={w.icon} alt="" /> : <span className="mark" style={{ background: "#5b7cfa" }} />}</span>
                <span>{w.name}{pending === w.uuid ? " · opening…" : ""}</span>
              </button>
            ))}
            {mobile && OPEN_IN.map((w) => (
              <a key={w.id} className="row" href={w.href(location.href)}>
                <span className="ic"><span className="mark" style={{ background: WALLET_MARKS[w.id] }} /></span>
                <span>Open in {w.name}</span>
              </a>
            ))}
            {!wallets.length && !mobile && (
              <p className="small">No browser wallet found. Install MetaMask, Rabby or OKX Wallet, then reload this page.</p>
            )}
            {note && <p className="small warn" role="status">{note}</p>}
          </div>
        </div>
      )}
    </>
  );
}
