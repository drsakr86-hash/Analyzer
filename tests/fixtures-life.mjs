// Synthetic keepMoney (Hybrid) export, schema v16. No real financial data.
const pad = n => String(n).padStart(2, '0');
export function ym(offset, base = new Date()) { const d = new Date(base.getFullYear(), base.getMonth() + offset, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }

export function makeKeepMoney({ base = new Date() } = {}) {
  const tx = [];
  let id = 0;
  const add = (o) => tx.push({ id: 't' + (++id), accountId: 'bank', tags: [], createdAt: '2026-01-01T00:00:00Z', description: 'وصف سري للحركة', ...o });
  const expenses = { '-4': 24000, '-3': 25000, '-2': 32000, '-1': 31000, '0': 9000 };
  for (const off of [-4, -3, -2, -1, 0]) {
    const m = ym(off, base);
    add({ type: 'Income', amount: 20000, date: `${m}-01`, category: 'مركز دمنهور للعيون', sourceId: 'sal_dmn' });
    if (off !== 0) add({ type: 'Income', amount: 10000, date: `${m}-15`, category: 'عيادة الرحمانية', sourceId: 'cl_rah' });
    add({ type: 'Expense', amount: expenses[off] - 3000, date: `${m}-05`, category: off % 2 ? 'أكل' : 'مدارس' });
    if (off !== 0) add({ type: 'Expense', amount: 3000, date: `${m}-10`, category: 'أقساط', debtId: 'd1' });
    add({ type: 'Saving', amount: 1000, date: `${m}-02`, category: 'ادخار', goalId: 'g1' });
    add({ type: 'Expense', amount: 2000, date: `${m}-06`, category: 'إيجار العيادة', bizId: 'cl_rah' });
  }
  add({ type: 'Transfer', amount: 5000, date: `${ym(-1, base)}-20`, accountId: 'bank', toAccountId: 'cash' });
  add({ type: 'Expense', amount: -5, date: `${ym(-1, base)}-21`, category: 'تالف' }); // invalid → rejected
  return {
    schemaVersion: 16, exportedAt: new Date().toISOString(),
    settings: { currency: 'EGP' },
    accounts: [{ id: 'bank', name: 'البنك', type: 'bank', openingBalance: 30000 }, { id: 'cash', name: 'نقدي', type: 'cash', openingBalance: 0 }],
    transactions: tx,
    debts: [
      { id: 'd1', kind: 'i_owe', party: 'اسم دائن سري', principal: 60000, interestRate: 10, installments: 12, dueDate: '2020-01-01', note: 'ملاحظة' },
      { id: 'd2', kind: 'owed_to_me', party: 'صديق', principal: 5000 },
    ],
    goals: [{ id: 'g1', name: 'تعليم الأولاد', target: 100000, initial: 5000 }, { id: 'g2', name: 'سيارة', target: 200000, initial: 0 }],
    investments: [{ id: 'i1', kind: 'gold', qty: 10, buyPrice: 3000, currentPrice: 4000 }],
    subscriptions: [{ id: 's1', name: 'Netflix', amount: 200, cycle: 'monthly' }, { id: 's2', name: 'سحابة', amount: 1200, cycle: 'yearly' }],
    recurring: [], charities: [], tombstones: [], catBudgets: {},
  };
}

/** Independent expectations (written separately from the app's engine). */
export function expected(km, base = new Date()) {
  const months = [-3, -2, -1].map(o => ym(o, base));
  const inM = (t, m) => t.date.slice(0, 7) === m;
  const ok = km.transactions.filter(t => t.amount >= 0);
  const tot = (type, m, f = () => true) => ok.filter(t => t.type === type && inM(t, m) && f(t)).reduce((s, t) => s + t.amount, 0);
  const inc = months.map(m => tot('Income', m)), exp = months.map(m => tot('Expense', m)), pers = months.map(m => tot('Expense', m, t => !t.bizId));
  const sumInc = inc.reduce((a, b) => a + b), sumExp = exp.reduce((a, b) => a + b);
  const deficit = months.filter((m, i) => exp[i] > inc[i]).length;
  // bank balance: opening + income − expense − saving − transfer out
  const bank = 30000 + ok.filter(t => t.accountId === 'bank').reduce((s, t) => s + ({ Income: 1, Expense: -1, Saving: -1, Charity: -1 }[t.type] || 0) * t.amount, 0) - 5000;
  const liquid = Math.max(0, bank) + 5000;
  const avgPersonal = pers.reduce((a, b) => a + b) / 3;
  const paid = ok.filter(t => t.debtId === 'd1').reduce((s, t) => s + t.amount, 0);
  const debtRemaining = 66000 - paid;
  const debtService = 3000 / (sumInc / 3); // one 3000 instalment per month
  return { avgIncome: sumInc / 3, avgExpense: sumExp / 3, savingsRate: (sumInc - sumExp) / sumInc, deficit, liquid, emergency: liquid / avgPersonal, debtRemaining, debtService, txValid: ok.length };
}
