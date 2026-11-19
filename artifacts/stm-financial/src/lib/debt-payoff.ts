// Which debt entries have been paid off.
//
// Payments pay off the oldest debt first. A starting balance entered without
// a transaction (Family/Own profiles) is the oldest debt of all, and credit
// left over from paying too much pays off later debts as they come in.

export type PayoffTxn = { id: string; amount: number; date: string; created_at: string };
export type DebtPayoff = {
  /** Still unpaid on this debt entry. */
  left: number;
  /** Fully covered by payments. */
  paidOff: boolean;
  /** Some, but not all, of it has been paid. */
  partly: boolean;
};

const EPS = 0.005;

function chronological<T extends PayoffTxn>(txns: T[]): T[] {
  return [...txns].sort((a, b) => {
    const d = new Date(a.date).getTime() - new Date(b.date).getTime();
    return d !== 0 ? d : new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

/** For each debt entry (amount > 0), how much is still unpaid. Payments aren't in the map. */
export function debtPayoff(transactions: PayoffTxn[], currentBalance: number): Map<string, DebtPayoff> {
  const net = transactions.reduce((s, t) => s + (Number.isFinite(t.amount) ? t.amount : 0), 0);
  const opening = currentBalance - net;

  const open: { id: string; amount: number; left: number }[] = [];
  let credit = 0;
  if (opening > EPS) open.push({ id: "__opening", amount: opening, left: opening });
  else if (opening < -EPS) credit = -opening;

  const result = new Map<string, { amount: number; left: number }>();
  for (const t of chronological(transactions)) {
    if (!Number.isFinite(t.amount) || Math.abs(t.amount) < EPS) continue;
    if (t.amount > 0) {
      const used = Math.min(credit, t.amount);
      credit -= used;
      const entry = { id: t.id, amount: t.amount, left: t.amount - used };
      result.set(t.id, entry);
      if (entry.left > EPS) open.push(entry);
    } else {
      let pay = -t.amount;
      while (pay > EPS && open.length) {
        const d = open[0];
        const used = Math.min(pay, d.left);
        d.left -= used;
        pay -= used;
        if (d.left <= EPS) open.shift();
      }
      credit += pay;
    }
  }

  const out = new Map<string, DebtPayoff>();
  for (const [id, e] of result) {
    const left = e.left <= EPS ? 0 : e.left;
    out.set(id, { left, paidOff: left === 0, partly: left > 0 && left < e.amount - EPS });
  }
  return out;
}
