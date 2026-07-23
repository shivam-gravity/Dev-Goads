import { useEffect, useRef, useState } from "react";
import { api, type FundsSnapshot } from "../api/client.js";

/**
 * "Manage Funds" — the Ads Manager's funds surface, mirroring the Polluxa CRM's WalletWidget
 * (a compact balance chip in the page header that opens a funds panel). Shows BOTH the connected
 * Meta ad account's REAL billing snapshot (balance, spend, cap, funding source) AND the internal
 * wallet ledger + transactions. "Add Funds" deep-links to Meta's own billing UI — Meta owns the
 * money; this app never holds it — exactly like the CRM does. Only rendered on the Meta network tab.
 */

function formatMinor(minor: number, currency: string): string {
  // Most currencies use 2 minor digits; the zero-decimal ones Meta reports as whole units.
  const zeroDecimal = new Set(["JPY", "KRW", "VND", "CLP", "HUF", "TWD", "IDR"]);
  const divisor = zeroDecimal.has(currency.toUpperCase()) ? 1 : 100;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / divisor);
  } catch {
    return `${(minor / divisor).toFixed(2)} ${currency}`;
  }
}
function formatCents(cents: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

const TX_LABELS: Record<string, string> = {
  top_up: "Top up",
  ad_spend: "Ad spend",
  refund: "Refund",
  adjustment: "Adjustment",
};

export default function ManageFunds({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<FundsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = () => {
    setLoading(true);
    api.getFunds(workspaceId)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  // Load once on mount so the chip can show the balance without opening the panel.
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [workspaceId]);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const meta = data?.meta ?? null;
  const wallet = data?.wallet ?? null;
  const chipBalance = meta
    ? formatMinor(meta.balanceMinor, meta.currency)
    : wallet
    ? formatCents(wallet.balanceCents, wallet.currency)
    : "—";

  return (
    <div className="manage-funds" ref={ref}>
      <button
        type="button"
        className="manage-funds-chip"
        onClick={() => { if (!open) load(); setOpen((o) => !o); }}
        title="Manage Funds"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <line x1="2" y1="10" x2="22" y2="10" />
        </svg>
        <span className="manage-funds-chip-label">Funds</span>
        <strong className="manage-funds-chip-balance">{chipBalance}</strong>
      </button>

      {open && (
        <div className="manage-funds-panel">
          <div className="manage-funds-panel-head">
            <span>Manage Funds</span>
            {meta?.billingUrl && (
              <a href={meta.billingUrl} target="_blank" rel="noreferrer" className="manage-funds-add-btn">+ Add Funds</a>
            )}
          </div>

          {loading && !data && <p className="manage-funds-muted">Loading…</p>}

          {meta ? (
            <div className="manage-funds-stats">
              <div className="manage-funds-stat">
                <span className="manage-funds-stat-label">Balance</span>
                <span className="manage-funds-stat-value">{formatMinor(meta.balanceMinor, meta.currency)}</span>
              </div>
              <div className="manage-funds-stat">
                <span className="manage-funds-stat-label">Lifetime spend</span>
                <span className="manage-funds-stat-value">{formatMinor(meta.amountSpentMinor, meta.currency)}</span>
              </div>
              {meta.spendCapMinor != null && (
                <div className="manage-funds-stat">
                  <span className="manage-funds-stat-label">Spend cap</span>
                  <span className="manage-funds-stat-value">{formatMinor(meta.spendCapMinor, meta.currency)}</span>
                </div>
              )}
              <div className="manage-funds-stat">
                <span className="manage-funds-stat-label">Payment method</span>
                <span className="manage-funds-stat-value">{meta.fundingSource ?? "—"}</span>
              </div>
              <p className="manage-funds-source-note">
                Meta ad account <code>act_{meta.adAccountId}</code>{meta.accountStatus ? ` · ${meta.accountStatus}` : ""} — billed directly by Meta.
              </p>
            </div>
          ) : (
            !loading && (
              <p className="manage-funds-muted">
                No Meta ad account connected — showing the workspace wallet only. Connect Meta to see the real ad-account balance.
              </p>
            )
          )}

          {wallet && (
            <div className="manage-funds-wallet">
              <div className="manage-funds-wallet-head">
                <span>Workspace wallet</span>
                <strong>{formatCents(wallet.balanceCents, wallet.currency)}</strong>
              </div>
              {(data?.transactions?.length ?? 0) > 0 ? (
                <ul className="manage-funds-tx">
                  {data!.transactions.slice(0, 8).map((t) => (
                    <li key={t.id} className="manage-funds-tx-row">
                      <span className={`manage-funds-tx-type manage-funds-tx-${t.type}`}>{TX_LABELS[t.type] ?? t.type}</span>
                      <span className="manage-funds-tx-desc">{t.description}</span>
                      <span className={`manage-funds-tx-amt ${t.amountCents < 0 ? "neg" : "pos"}`}>
                        {t.amountCents < 0 ? "−" : "+"}{formatCents(Math.abs(t.amountCents), wallet.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="manage-funds-muted">No wallet transactions yet.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
