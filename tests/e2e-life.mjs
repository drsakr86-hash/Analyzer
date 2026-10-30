// Comprehensive analysis: finance (keepMoney import), fatherhood, risk radar, persona.
// Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --experimental-strip-types tests/e2e-life.mjs
import fs from 'node:fs';
import path from 'node:path';
import { chromium, test, assert, eq, summary, openApp, unlock, store } from './harness.mjs';
import { makeDataset, seedScript } from './fixtures.mjs';
import { makeKeepMoney, expected } from './fixtures-life.mjs';
import { handle } from '../supabase/functions/nafsilog-ai/handler.ts';
import * as core from '../supabase/functions/nafsilog-ai/core.ts';

const TMP = path.resolve('tests/screenshots'); fs.mkdirSync(TMP, { recursive: true });
const KM = makeKeepMoney(), EXP = expected(KM);
const kmFile = path.join(TMP, 'tmp_keepmoney.json'); fs.writeFileSync(kmFile, JSON.stringify(KM));
const EP = 'https://unit-test.supabase.co/functions/v1/nafsilog-ai';
const browser = await chromium.launch();
const data = makeDataset();
// add family/exercise/parent fields to recent logs (parent score lower on stress days)
data.logs.forEach((l, i) => { l.familyMin = i % 3 === 0 ? 5 : 12; l.exerciseMin = i % 2 ? 0 : 20; l.parentScore = l.stressor && l.stressLevel >= 7 ? 2 : 4; });
const seed = seedScript(data);
const ready = ['nl_ai_settings', JSON.stringify({ enabled: true, consentVersion: 2, endpoint: EP, accessCode: 'c', keepHistory: true })];
const near = (a, b, tol = 0.051) => Math.abs(a - b) <= tol;

function server(modelText = '{"reply":"تمام"}') {
  const log = { req: [], up: [] };
  const env = { AI_PROVIDER: 'anthropic', AI_MODEL: 'm', AI_API_KEY: 'k', APP_ACCESS_CODES: 'c', RATE_LIMIT_BACKEND: 'memory', RATE_LIMIT_PER_HOUR: '100' };
  const deps = { env: k => env[k], fetch: async (_u, init) => { log.up.push(JSON.parse(init.body)); return new Response(JSON.stringify({ content: [{ type: 'text', text: modelText }] })); } };
  const onRoute = async route => {
    const rq = route.request(); if (!rq.url().startsWith(EP)) return false;
    log.req.push(JSON.parse(rq.postData() || '{}'));
    const res = await handle(new Request(rq.url(), { method: 'POST', headers: rq.headers(), body: rq.postData() }), deps);
    await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() }); return true;
  };
  return { log, onRoute };
}
async function app(opts = {}) {
  const r = await openApp(browser, { seed: opts.seed || seed, onRoute: opts.onRoute, viewport: opts.viewport });
  await unlock(r.page); await r.page.evaluate(() => go('ai'));
  return r;
}
async function importKM(page, file = kmFile) {
  await page.evaluate(() => aiSwitch('finance'));
  await page.setInputFiles('#aiContent input[type=file]', file); await page.waitForTimeout(300);
}

console.log('Comprehensive analysis');

await test('AI page opens on the overview with four domains and a father message; unknown money before import', async () => {
  const { page, errors, ctx } = await app();
  const t = await page.textContent('#aiContent');
  for (const d of ['نفسي', 'صحي وحياتي', 'مالي', 'عائلي']) assert(t.includes(d), d);
  assert(t.includes('كلمة من القلب') && t.includes('يا بُني'), 'father voice');
  const r = await page.evaluate(() => NLR.compute());
  eq(r.domains.find(d => d.id === 'money').level, 'unknown', 'money unknown without import');
  eq(errors, [], 'errors'); await ctx.close();
});

await test('keepMoney import: minimised storage and numbers equal an independent computation', async () => {
  const { page, ctx } = await app();
  await importKM(page);
  const fin = await store(page, 'fin');
  eq(fin.tx.length, EXP.txValid, 'valid tx count (1 rejected)');
  const raw = JSON.stringify(fin);
  assert(!raw.includes('وصف سري') && !raw.includes('ملاحظة'), 'descriptions/notes dropped');
  const a = await page.evaluate(() => NLF.analyze(NLF.load()));
  assert(near(a.avgIncome, EXP.avgIncome, 1) && near(a.avgExpense, EXP.avgExpense, 1), `avg ${a.avgIncome}/${a.avgExpense} vs ${EXP.avgIncome}/${EXP.avgExpense}`);
  assert(near(a.savingsRate, EXP.savingsRate, 0.001), `rate ${a.savingsRate} vs ${EXP.savingsRate}`);
  eq(a.deficitMonths, EXP.deficit, 'deficit months');
  assert(near(a.liquid, EXP.liquid, 1), `liquid ${a.liquid} vs ${EXP.liquid}`);
  assert(near(a.emergencyMonths, EXP.emergency, 0.01), `emergency ${a.emergencyMonths} vs ${EXP.emergency}`);
  eq(a.debtRemaining, EXP.debtRemaining, 'debt remaining');
  assert(near(a.debtService, EXP.debtService, 0.001), 'debt service');
  eq([a.overdue.length, a.owedToMe, Math.round(a.subsMonthly), a.investments, a.educationGoal], [1, 5000, 300, 40000, true], 'misc');
  eq(a.sources[0].name, 'مركز دمنهور للعيون', 'top source');
  await ctx.close();
});

await test('import guards: invalid file, NafsiLog backup and undo/delete', async () => {
  const { page, ctx } = await app();
  const bad = path.join(TMP, 'tmp_bad.json'); fs.writeFileSync(bad, '{"hello":1}');
  await importKM(page, bad); eq(await store(page, 'fin'), null, 'rejected');
  const nl = path.join(TMP, 'tmp_nl.json'); fs.writeFileSync(nl, JSON.stringify({ app: 'NafsiLog', data: {}, transactions: [] }));
  await importKM(page, nl); eq(await store(page, 'fin'), null, 'NafsiLog backup refused');
  await importKM(page);
  const km2 = makeKeepMoney(); km2.transactions = km2.transactions.slice(0, 5); const f2 = path.join(TMP, 'tmp_km2.json'); fs.writeFileSync(f2, JSON.stringify(km2));
  await importKM(page, f2); eq((await store(page, 'fin')).tx.length, 5, 'replaced');
  await page.click('button:has-text("الرجوع للاستيراد السابق")'); eq((await store(page, 'fin')).tx.length, EXP.txValid, 'undo');
  await page.click('button:has-text("حذف البيانات المالية")'); eq(await store(page, 'fin'), null, 'deleted');
  [bad, nl, f2].forEach(f => fs.unlinkSync(f)); await ctx.close();
});

await test('money risks after import: deficit high, emergency/overdue flagged, education goal recognised', async () => {
  const { page, ctx } = await app();
  await importKM(page);
  const r = await page.evaluate(() => NLR.compute());
  const money = r.domains.find(d => d.id === 'money');
  eq(money.level, 'high', 'money level');
  const titles = money.items.map(i => i.title + ':' + i.level);
  assert(titles.includes('التوازن الشهري:high') && titles.includes('ديون متأخرة:high'), titles.join(' | '));
  assert(!r.domains.find(d => d.id === 'family').items.some(i => i.title === 'هدف تعليم الأولاد'), 'education goal exists → no flag');
  await page.evaluate(() => aiSwitch('overview'));
  assert((await page.textContent('#aiContent')).includes('التوازن الشهري'), 'shown');
  await page.locator('#dom_money button:has-text("مراجعة أكبر 3 بنود")').click();
  eq((await store(page, 'ai_actions'))[0].source, 'risk', 'risk action adopted');
  await ctx.close();
});

await test('daily family & health fields save, reload and survive backup round-trip', async () => {
  const { page, ctx } = await app({ seed: [['nl_pin', '"1234"']] });
  await page.evaluate(() => go('daily'));
  await page.fill('#famMin', '35'); await page.fill('#exMin', '25'); await page.selectOption('#parentScore', '4');
  await page.click('.tag-toggle:text-is("#مال")');
  await page.click('button:has-text("حفظ تسجيل اليوم")');
  let l = (await store(page, 'logs'))[0];
  eq([l.familyMin, l.exerciseMin, l.parentScore, l.tags.includes('#مال')], [35, 25, 4, true], 'saved');
  await page.evaluate(() => go('daily'));
  eq([await page.inputValue('#famMin'), await page.inputValue('#parentScore')], ['35', '4'], 'restored in form');
  await page.fill('#famMin', ''); await page.click('button:has-text("حفظ تسجيل اليوم")');
  eq((await store(page, 'logs'))[0].familyMin, null, 'empty → null, not 0');
  await page.evaluate(() => go('settings'));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("تصدير نسخة كاملة")')]);
  const b = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  const v = await page.evaluate(o => nlValidateBackup(o).clean.logs[0], b);
  eq([v.exerciseMin, v.parentScore], [25, 4], 'validator keeps new fields');
  await ctx.close();
});

await test('father tab: numbers, stress spill-over, missions by age, protections and children', async () => {
  const { page, errors, ctx } = await app();
  await page.evaluate(() => aiSwitch('father'));
  const fx = await page.evaluate(() => NLFam.analyze(NLA.load(), NLA.period(30)));
  const today = await page.evaluate(() => ds()); const from = new Date(today + 'T00:00:00'); from.setDate(from.getDate() - 29);
  const L = data.logs.filter(l => l.date >= from.toLocaleDateString('en-CA'));
  eq(fx.famMean, Math.round(L.reduce((s, l) => s + l.familyMin, 0) / L.length * 10) / 10, 'family mean');
  assert(fx.psStress && fx.psStress.with === 2 && fx.psStress.without === 4, 'stress split ' + JSON.stringify(fx.psStress));
  const t = await page.textContent('#aiContent');
  assert(t.includes('دقيقتان قبل باب البيت') && t.includes('وقت خاص يومي'), 'missions from data');
  await page.fill('#nlChNick', 'سارة'); await page.fill('#nlChAge', '15'); await page.click('button:has-text("＋")');
  const ms = await page.evaluate(() => NLFam.missions(NLFam.analyze(NLA.load(), NLA.period(30)), nlFamily()).map(m => m.id));
  assert(!ms.includes('routine'), 'age filter (routine is for ≤12)');
  await page.locator('.ai-row:has-text("تأمين الحياة") select').selectOption('no');
  const fam = (await page.evaluate(() => NLR.compute())).domains.find(d => d.id === 'family');
  assert(fam.items.some(i => i.title === 'وثائق الحماية' && i.level === 'med'), 'protection flagged');
  assert(fam.items.some(i => i.title === 'انتقال الضغط إلى البيت'), 'spill-over risk');
  await page.locator('.ai-act.suggest button:has-text("اعتمدها")').first().click();
  eq((await store(page, 'ai_actions'))[0].source, 'father', 'father mission adopted');
  eq(errors, [], 'errors'); await ctx.close();
});

await test('crisis words in a recent journal entry put the safety card on the overview', async () => {
  const d2 = makeDataset(); d2.logs[d2.logs.length - 1].intrusive = 'مش عايز أعيش';
  const { page, ctx } = await app({ seed: seedScript(d2) });
  const h = await page.innerHTML('#aiContent');
  assert(h.includes('ai-safety') && h.includes('tel:123'), 'safety card'); await ctx.close();
});

await test('money × mood: link computed when logs overlap the imported range', async () => {
  const { page, ctx } = await app();
  await importKM(page);
  const link = await page.evaluate(() => NLF.moodLink(NLF.load(), NLA.load().logs));
  assert(link.enough && link.n >= 8, 'enough days ' + link.n);
  assert((await page.textContent('#aiContent')).includes('المال والمشاعر'), 'section'); await ctx.close();
});

await test('local chat answers money, father and risk questions from computed data', async () => {
  const { page, ctx } = await app();
  await importKM(page);
  await page.evaluate(() => aiSwitch('chat'));
  const ask = async q => { await page.fill('#aiInput', q); await page.click('#aiSendBtn'); await page.waitForTimeout(80); return page.evaluate(() => { const m = aiCurrentConv().messages; return m[m.length - 1].text; }); };
  const a = await page.evaluate(() => NLF.analyze(NLF.load()));
  assert((await ask('كام مصروفي الشهري؟')).includes(Math.round(a.avgExpense).toLocaleString('ar-EG')), 'money');
  assert((await ask('ازاي أكون أب كويس لولادي؟')).includes('مهمة الأسبوع'), 'father');
  assert((await ask('إيه المخاطر عندي؟')).includes('مالي'), 'risks'); await ctx.close();
});

await test('AI: finance/family scopes send aggregates only (no child, creditor or transaction text); father persona reaches prompt', async () => {
  const s = server();
  const scopes = { stats: false, journal: false, sessions: false, scales: false, goals: false, finance: true, family: true, risks: true };
  const { page, ctx } = await app({ seed: [...seed, ['nl_ai_settings', JSON.stringify({ ...JSON.parse(ready[1]), scopes })]], onRoute: s.onRoute });
  await importKM(page);
  await page.evaluate(() => { aiSwitch('father'); });
  await page.fill('#nlChNick', 'يوسف'); await page.fill('#nlChAge', '8'); await page.click('button:has-text("＋")');
  await page.evaluate(() => aiSwitch('chat'));
  await page.fill('#aiInput', 'إزاي أوازن بين الشغل والبيت؟'); await page.click('#aiSendBtn'); await page.waitForFunction(() => !aiBusy);
  const c = s.log.req[0].context, body = JSON.stringify(s.log.req[0]);
  assert(c.finance && c.family && c.risk_radar, 'scopes');
  for (const bad of ['يوسف', 'اسم دائن سري', 'وصف سري', 'Netflix', '"party"', '"nick"']) assert(!body.includes(bad), 'leaked ' + bad);
  eq([c.family.childrenCount, c.finance.deficitMonthsOfLast3], [1, EXP.deficit], 'aggregates');
  eq(s.log.req[0].persona, 'father', 'persona sent');
  assert(s.log.up[0].system.includes('wise, warm and honest father') && s.log.up[0].system.includes('not a licensed financial'), 'server prompt');
  await page.evaluate(() => { AIService.save({ persona: 'neutral' }); });
  await page.waitForTimeout(1600);
  await page.fill('#aiInput', 'وماذا عن الادخار؟'); await page.click('#aiSendBtn'); await page.waitForFunction(() => !aiBusy);
  assert(!s.log.up[1].system.includes('wise, warm and honest father'), 'neutral persona');
  await ctx.close();
});

await test('server rejects creditor names / notes / child names in context', async () => {
  for (const ctxObj of [{ x: { party: 'a' } }, { children: [{ nick: 'b' }] }, { y: [{ note: 'c' }] }]) {
    let code = ''; try { core.validateRequest({ task: 'explain_stats', context: ctxObj }); } catch (e) { code = e.code; }
    eq(code, 'forbidden_context_field', JSON.stringify(ctxObj));
  }
});

await test('report contains risk radar, finance and family; Markdown export too', async () => {
  const { page, ctx } = await app();
  await importKM(page);
  await page.evaluate(() => { aiSwitch('reports'); aiGenReport(); });
  const r = (await store(page, 'ai_reports'))[0];
  assert(r.risks.length === 4 && r.finance && r.finance.deficitMonths === EXP.deficit && r.family.famN > 0, 'extras');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Markdown")')]);
  const md = fs.readFileSync(await dl.path(), 'utf8');
  assert(md.includes('## رادار المخاطر') && md.includes('## المال') && md.includes('## الأسرة والأبوة'), 'md');
  await ctx.close();
});

await test('consent v1 users must re-consent (new data categories)', async () => {
  const { page, ctx } = await app({ seed: [...seed, ['nl_ai_settings', JSON.stringify({ enabled: true, consentVersion: 1, endpoint: EP, accessCode: 'c' })]] });
  eq(await page.evaluate(() => AIService.status()), 'needs_consent', 'status'); await ctx.close();
});

await test('delete-all removes finance and family data', async () => {
  const { page, ctx } = await app();
  await importKM(page); await page.evaluate(() => { nlFamilySave({ children: [{ nick: 'x', age: 3 }] }); clearAll(); });
  eq(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('nl_'))), [], 'empty'); await ctx.close();
});

await test('360px: new tabs have no horizontal overflow; screenshots', async () => {
  const { page, ctx } = await app({ viewport: { width: 360, height: 760 } });
  await importKM(page);
  for (const t of ['overview', 'finance', 'father']) {
    await page.evaluate(x => aiSwitch(x), t);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(ov <= 1, `${t} overflow ${ov}`);
    await page.screenshot({ path: path.join(TMP, `life-${t}-360.png`), fullPage: true });
  }
  await page.evaluate(() => go('daily'));
  await page.screenshot({ path: path.join(TMP, 'life-daily-360.png'), fullPage: true });
  await ctx.close();
});

await browser.close();
fs.unlinkSync(kmFile);
process.exit(summary('Comprehensive analysis') ? 1 : 0);
