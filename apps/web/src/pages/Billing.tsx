import { useEffect, useState } from "react";
import { api, Invoice } from "../api/client.js";

function firstOfMonthISO(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function Billing({ businessId }: { businessId: string }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setInvoices(await api.listInvoices(businessId));
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, [businessId]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      await api.generateInvoice(businessId, firstOfMonthISO(), todayISO());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate invoice");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="billing">
      <div className="dashboard-header">
        <h1>Billing</h1>
        <button onClick={handleGenerate} disabled={generating}>
          {generating ? "Generating..." : "Generate invoice for current period"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2>Invoices</h2>
        {invoices.length === 0 ? (
          <p>No invoices yet. Platform fee is a $49/mo base plus 12% of managed ad spend.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Ad spend</th>
                <th>Platform fee</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td>
                    {inv.periodStart} → {inv.periodEnd}
                  </td>
                  <td>${(inv.adSpendCents / 100).toFixed(2)}</td>
                  <td>${(inv.platformFeeCents / 100).toFixed(2)}</td>
                  <td>${(inv.totalCents / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
