// The bill sheet. Chips only enter the game through buy-ins from the house.
// Transfers between players are loans: the giver is owed, the receiver owes.
//
//   net chips = current stack - bought in + lent - borrowed
//
// Nets always sum to zero, so the settlement is just "who pays whom".

export class Ledger {
  constructor(data) {
    this.entries = data?.entries ?? [];
    this.seq = data?.seq ?? 0;
  }

  add(entry) {
    const e = { id: ++this.seq, at: Date.now(), ...entry };
    this.entries.push(e);
    return e;
  }

  rows(players, tokenValue, stackOf = (uid) => players.get(uid)?.stack ?? 0) {
    const rows = new Map();
    const row = (uid) => {
      if (!rows.has(uid)) {
        const p = players.get(uid);
        rows.set(uid, { uid, name: p?.name ?? 'Unknown', avatar: p?.avatar ?? null, boughtIn: 0, buyIns: 0, lent: 0, borrowed: 0, stack: stackOf(uid) });
      }
      return rows.get(uid);
    };
    for (const e of this.entries) {
      if (e.type === 'buyin') { row(e.uid).boughtIn += e.amount; row(e.uid).buyIns++; }
      if (e.type === 'transfer') { row(e.from).lent += e.amount; row(e.to).borrowed += e.amount; }
    }
    for (const r of rows.values()) {
      r.net = r.stack - r.boughtIn + r.lent - r.borrowed;
      r.money = round2(r.net * tokenValue);
    }
    return [...rows.values()].sort((a, b) => b.net - a.net);
  }
}

// Fewest-ish payments: biggest debtor pays biggest creditor until everyone is square.
export function settle(rows, tokenValue) {
  const debtors = rows.filter((r) => r.net < 0).map((r) => ({ uid: r.uid, name: r.name, left: -r.net }));
  const creditors = rows.filter((r) => r.net > 0).map((r) => ({ uid: r.uid, name: r.name, left: r.net }));
  debtors.sort((a, b) => b.left - a.left);
  creditors.sort((a, b) => b.left - a.left);
  const payments = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amt = Math.min(debtors[i].left, creditors[j].left);
    payments.push({ from: debtors[i].uid, fromName: debtors[i].name, to: creditors[j].uid, toName: creditors[j].name, chips: amt, money: round2(amt * tokenValue) });
    debtors[i].left -= amt;
    creditors[j].left -= amt;
    if (debtors[i].left === 0) i++;
    if (creditors[j].left === 0) j++;
  }
  return payments;
}

const round2 = (x) => Math.round(x * 100) / 100;
