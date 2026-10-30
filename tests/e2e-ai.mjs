// End-to-end tests for NafsiLog AI. The browser talks to the REAL edge handler (supabase/functions/nafsilog-ai/handler.ts)
// running in this Node process; only the upstream model provider is faked.
// Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --experimental-strip-types tests/e2e-ai.mjs
import fs from 'node:fs';
import path from 'node:path';
import { chromium, test, assert, eq, summary, openApp, unlock, store } from './harness.mjs';
import { makeDataset, seedScript } from './fixtures.mjs';
import { handle } from '../supabase/functions/nafsilog-ai/handler.ts';

const EP = 'https://unit-test.supabase.co/functions/v1/nafsilog-ai';
const SHOTS = path.resolve('tests/screenshots'); fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const data = makeDataset();
data.profile.medical = 'SECRET-MED-HISTORY';
const baseSeed = seedScript(data);
const readySettings = ['nl_ai_settings', JSON.stringify({ enabled: true, consentVersion: 2, consentAt: '2026-10-30T00:00:00Z', endpoint: EP, accessCode: 'test-code', keepHistory: true })];

/** Fake upstream model + real handler. `model(sentBody)` returns the model's raw text or {status}. */
function server({ model = () => '{"reply":"حسناً"}', env = {}, raw } = {}) {
  const log = { requests: [], upstream: [] };
  const ENV = { AI_PROVIDER: 'anthropic', AI_MODEL: 'fake-model', AI_API_KEY: 'sk-ant-FAKE', APP_ACCESS_CODES: 'test-code', ALLOWED_ORIGINS: '', RATE_LIMIT_BACKEND: 'memory', RATE_LIMIT_PER_HOUR: '100', AI_MAX_RETRIES: '0', ...env };
  const fakeFetch = async (_url, init) => {
    const body = JSON.parse(init.body); log.upstream.push(body);
    const r = model(body);
    if (r && r.status) return new Response('{}', { status: r.status });
    return new Response(JSON.stringify({ content: [{ type: 'text', text: r }], usage: {} }), { status: 200 });
  };
  const deps = { env: k => ENV[k], fetch: fakeFetch };
  const onRoute = async (route) => {
    const rq = route.request();
    if (!rq.url().startsWith(EP)) return false;
    if (rq.method() === 'POST') log.requests.push(JSON.parse(rq.postData() || '{}'));
    if (raw) { const r = raw(rq); if (r === 'abort') { await route.abort('timedout'); return true; } await route.fulfill(r); return true; }
    const res = await handle(new Request(rq.url(), { method: rq.method(), headers: rq.headers(), body: rq.method() === 'POST' ? rq.postData() : undefined }), deps);
    await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
    return true;
  };
  return { log, onRoute };
}
async function app(opts = {}) {
  const r = await openApp(browser, { seed: opts.seed || baseSeed, viewport: opts.viewport, onRoute: opts.onRoute });
  await unlock(r.page);
  await r.page.evaluate(() => { go('ai'); aiSwitch(0); });
  return r;
}
const send = async (page, text) => { await page.fill('#aiInput', text); await page.click('#aiSendBtn'); await page.waitForFunction(() => !aiBusy); await page.waitForTimeout(50); };
const lastBot = page => page.evaluate(() => { const m = aiCurrentConv().messages.filter(x => x.role === 'assistant'); return m[m.length - 1]; });

console.log('NafsiLog AI');

await test('AI page: all six tabs render, local mode, no JS errors, no network', async () => {
  const s = server();
  const { page, errors, ctx } = await app({ onRoute: s.onRoute });
  assert((await page.textContent('#page-ai .pg-title')).includes('NafsiLog AI — المساعد التحليلي الشخصي'), 'title');
  assert((await page.textContent('#aiStatus')).includes('وضع محلي'), 'local pill');
  for (let t = 0; t < 6; t++) { await page.evaluate(i => aiSwitch(i), t); assert(!(await page.textContent('#aiContent')).includes('تعذر عرض'), 'tab ' + t); }
  eq(errors, [], 'errors'); eq(s.log.requests.length, 0, 'no requests');
  await ctx.close();
});

await test('analytics: page statistics equal an independent computation', async () => {
  const { page, ctx } = await app();
  const st = await page.evaluate(() => NLA.stats(NLA.load(), NLA.period(30)));
  const today = await page.evaluate(() => ds());
  const from = new Date(today + 'T00:00:00'); from.setDate(from.getDate() - 29);
  const f = from.toLocaleDateString('en-CA');
  const L = data.logs.filter(l => l.date >= f && l.date <= today);
  const moods = L.map(l => l.mood), mean = moods.reduce((a, b) => a + b, 0) / moods.length;
  const sorted = [...moods].sort((a, b) => a - b), med = sorted.length % 2 ? sorted[sorted.length >> 1] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const sd = Math.sqrt(moods.reduce((a, v) => a + (v - mean) ** 2, 0) / (moods.length - 1));
  const S2 = L.filter(l => l.sleep > 0), xs = S2.map(l => l.mood), ys = S2.map(l => l.sleep);
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  let n = 0, dx = 0, dy = 0; xs.forEach((x, i) => { n += (x - mx) * (ys[i] - my); dx += (x - mx) ** 2; dy += (ys[i] - my) ** 2; });
  const r = n / Math.sqrt(dx * dy);
  const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
  eq([st.daysLogged, st.mood.mean, st.mood.median, st.mood.sd, st.moodSleep.n, st.moodSleep.r, st.coverage],
    [L.length, r1(mean), r1(med), r1(sd), S2.length, r2(r), Math.round(L.length / 30 * 100)], 'stats');
  const dist = L.filter(l => l.stressor);
  eq(st.distress.n, dist.length, 'distress only counted when a stressor was written');
  eq(st.exercises.ba, data.sessions.filter(s => s.type === 'done-ba' && s.date >= f).length, 'ba count');
  await ctx.close();
});

await test('missing data: empty store gives nulls (no NaN), empty states and an "insufficient" report', async () => {
  const { page, errors, ctx } = await app({ seed: [['nl_pin', '"1234"']] });
  const st = await page.evaluate(() => NLA.stats(NLA.load(), NLA.period(30)));
  assert(!JSON.stringify(st).includes('NaN') && st.mood.mean === null && st.moodSleep.r === null, 'nulls');
  await page.evaluate(() => aiSwitch(1)); assert((await page.textContent('#aiContent')).includes('لا توجد تسجيلات'), 'trend empty');
  await page.evaluate(() => aiSwitch(2)); assert((await page.textContent('#aiContent')).includes('لا تظهر أنماط'), 'patterns empty');
  await page.evaluate(() => { aiSwitch(4); aiGenReport(); });
  const rep = (await store(page, 'ai_reports'))[0];
  assert(rep.insufficient.length >= 3 && !rep.comparison.valid, 'insufficient listed');
  eq(errors, [], 'errors');
  await ctx.close();
});

await test('patterns: hypotheses carry evidence with dates, sufficiency and a question; rejection persists', async () => {
  const { page, ctx } = await app();
  const pats = await page.evaluate(() => NLA.patterns(NLA.load(), NLA.period(30)));
  assert(pats.length >= 2, 'some patterns: ' + pats.length);
  for (const p of pats) assert(p.evidence.length && p.evidence.every(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date)) && p.question && p.hypothesis && p.suff.label, 'shape ' + p.id);
  assert(pats.every(p => !/لديك (اكتئاب|اضطراب)|تشخيص(ك)? (هو|ب)/.test(p.hypothesis + p.observation)), 'no diagnostic labels');
  await page.evaluate(() => aiSwitch(2));
  const id = pats[0].id;
  await page.evaluate(i => aiPatFb(i, 'rejected'), id);
  eq((await store(page, 'ai_patternFb'))[id].status, 'rejected', 'stored');
  assert((await page.textContent('#aiContent')).includes('أنماط رفضتها (1)'), 'moved to rejected');
  await ctx.close();
});

await test('local chat answers data questions from computed stats and labels the source', async () => {
  const s = server();
  const { page, ctx } = await app({ onRoute: s.onRoute });
  await send(page, 'كيف كان مزاجي هذا الشهر؟');
  const st = await page.evaluate(() => NLA.stats(NLA.load(), NLA.period(30)));
  const m = await lastBot(page);
  assert(m.source === 'local' && m.text.includes(`${st.mood.mean}/10`), 'mean in reply');
  assert((await page.textContent('#aiMsgs')).includes('رد محلي'), 'label');
  eq(s.log.requests.length, 0, 'nothing sent');
  await ctx.close();
});

await test('guided five-part reflection ends with a summary and pre-fills the thought record', async () => {
  const { page, ctx } = await app();
  for (const t of ['تأخرت عن موعد مهم', 'سيظن الجميع أنني مهمل', 'خجل 70', 'حرارة في الوجه', 'تجنبت الرد على الرسائل']) await send(page, t);
  const m = await lastBot(page);
  assert(m.text.includes('سيظن الجميع أنني مهمل') && m.text.includes('ليست من سجلاتك المخزنة'), 'summary distinguishes conversation from records: ' + m.text.slice(0, 200));
  await page.click('button:has-text("افحص الفكرة")');
  eq(await page.evaluate(() => [SS.ans.situation, SS.ans.hotThought, SS.step]), ['تأخرت عن موعد مهم', 'سيظن الجميع أنني مهمل', 1], 'prefilled');
  await ctx.close();
});

await test('crisis language shows safety resources locally and nothing is sent when AI is off', async () => {
  const s = server();
  const { page, ctx } = await app({ onRoute: s.onRoute });
  await send(page, 'مش عايز أعيش خلاص');
  const html = await page.innerHTML('#aiMsgs');
  assert(html.includes('tel:123') && html.includes('16328') && html.includes('ai-safety'), 'resources');
  eq(s.log.requests.length, 0, 'no network');
  await ctx.close();
});

await test('consent gate: enabling requires the checkbox; no request before consent', async () => {
  const s = server();
  const { page, ctx } = await app({ onRoute: s.onRoute });
  await page.evaluate(() => aiSwitch(5));
  await page.click('button:has-text("تفعيل")');
  await page.click('button:has-text("موافقة وتفعيل")');
  eq((await page.evaluate(() => AIService.status())), 'off', 'still off without checkbox');
  await page.check('#aiConsentChk'); await page.click('button:has-text("موافقة وتفعيل")');
  eq(await page.evaluate(() => AIService.status()), 'needs_config', 'needs config');
  await page.evaluate(() => aiSwitch(0));
  await send(page, 'كيف كان مزاجي؟');
  const msgs = await page.evaluate(() => aiCurrentConv().messages.map(m => m.source));
  assert(msgs.includes('error') && msgs.includes('local'), 'error + local fallback: ' + msgs);
  eq(s.log.requests.length, 0, 'nothing sent');
  await ctx.close();
});

await test('config guard: provider secret keys are refused; endpoint must be https', async () => {
  const { page, ctx } = await app({ seed: [...baseSeed, readySettings] });
  await page.evaluate(() => aiSwitch(5));
  await page.fill('#aiCode', 'sk-ant-api03-abc'); await page.click('#aiContent button:text-is("حفظ")');
  eq((await store(page, 'ai_settings')).accessCode, 'test-code', 'secret rejected');
  await page.fill('#aiCode', 'ok-code'); await page.fill('#aiEp', 'http://evil.example/x'); await page.click('#aiContent button:text-is("حفظ")');
  eq((await store(page, 'ai_settings')).endpoint, EP, 'http rejected');
  await ctx.close();
});

await test('AI chat via real handler: data minimisation by default, sensitive fields never sent, reply rendered as text', async () => {
  const s = server({ model: () => '{"reply":"<img src=x onerror=window.__pwned=1>يبدو أن الأسبوع كان متقلباً. ما الذي حدث يوم الثلاثاء؟","follow_up_questions":["ما الذي ساعدك؟"],"suggested_actions":[{"title":"مشي قصير","step":"امش 10 دقائق بعد العمل","timeframe":"3 أيام","reason":"تحسن المزاج بعد الأنشطة"}],"safety_concern":false}' });
  const { page, errors, ctx } = await app({ seed: [...baseSeed, readySettings], onRoute: s.onRoute });
  assert((await page.textContent('#aiStatus')).includes('مفعّل'), 'ready');
  await send(page, 'كيف أفهم تقلب مزاجي؟');
  eq(s.log.requests.length, 1, 'one request');
  const body = JSON.stringify(s.log.requests[0]);
  assert(s.log.requests[0].context.stats && !s.log.requests[0].context.journal && !s.log.requests[0].context.sessions, 'only stats scope');
  for (const forbidden of ['SECRET-MED-HISTORY', 'medical', '"age"', 'nl_pin', '1234', 'كوب شاي هادئ', 'اجتماع عمل متأخر']) assert(!body.includes(forbidden), 'leaked ' + forbidden);
  assert(!JSON.stringify(s.log.upstream).includes('test-code'), 'access code not forwarded upstream');
  const html = await page.innerHTML('#aiMsgs');
  assert(html.includes('استجابة نموذج ذكاء اصطناعي') && html.includes('ملخص أرقام'), 'labels and context note');
  assert(!(await page.evaluate(() => window.__pwned)) && !html.includes('<img'), 'no injection');
  await page.click('.ai-fu .chip');
  await page.waitForFunction(() => !aiBusy);
  eq(s.log.requests.length, 2, 'follow-up chip sends');
  eq(s.log.requests[1].messages.length, 3, 'history included (user, assistant, user)');
  await page.click('button:has-text("أضفها لخطتي")');
  const acts = await store(page, 'ai_actions');
  eq([acts.length, acts[0].source, acts[0].status], [1, 'ai', 'active'], 'adopted only on click');
  eq(errors, [], 'errors');
  await ctx.close();
});

await test('user-selected scopes are honoured; journal text is redacted and capped at 7 days', async () => {
  const s = server();
  const seed = [...baseSeed, ['nl_ai_settings', JSON.stringify({ ...JSON.parse(readySettings[1]), scopes: { stats: false, journal: true, sessions: false, scales: true, goals: false } })]];
  const { page, ctx } = await app({ seed, onRoute: s.onRoute });
  await page.evaluate(() => { const l = S.get('logs'); l[l.length - 1].stressor = 'اتصل بي 01001234567 على a@b.com'; S.set('logs', l); });
  await send(page, 'ماذا تلاحظ؟');
  const c = s.log.requests[0].context;
  assert(!c.stats && c.journal && c.scales, 'scopes');
  assert(c.journal.length <= 7 && c.journal.every(j => !('ev1' in j)), 'cap & fields');
  const t = JSON.stringify(c.journal);
  assert(!t.includes('01001234567') && !t.includes('a@b.com') && t.includes('[رقم]'), 'redacted');
  await ctx.close();
});

await test('crisis + AI on: safety card first, safety flag sent, no suggested actions shown', async () => {
  const s = server({ model: () => '{"reply":"أنا هنا معك.","suggested_actions":[{"title":"x","step":"y"}],"safety_concern":true}' });
  const { page, ctx } = await app({ seed: [...baseSeed, readySettings], onRoute: s.onRoute });
  await send(page, 'أفكر في الانتحار');
  eq(s.log.requests[0].safety_flag, true, 'flag');
  assert(s.log.upstream[0].system.includes('Follow rule 6'), 'server prompt in safety mode');
  const roles = await page.evaluate(() => aiCurrentConv().messages.map(m => m.role));
  eq(roles.slice(0, 2), ['user', 'safety'], 'card shown immediately');
  eq((await lastBot(page)).actions.length, 0, 'no actions in crisis');
  await ctx.close();
});

await test('failures: server not configured, 429, timeout and malformed JSON fall back gracefully', async () => {
  const cases = [
    [server({ env: { AI_API_KEY: '' } }), 'الخادم يعمل لكنه غير مهيأ'],
    [server({ env: { RATE_LIMIT_PER_HOUR: '0' } }), 'الحد المسموح'],
    [server({ raw: () => ({ status: 429, body: '{"ok":false,"error":"rate_limited"}', contentType: 'application/json' }) }), 'الحد المسموح'],
    [server({ raw: () => 'abort' }), 'تعذر الوصول'],
    [server({ raw: () => ({ status: 200, body: 'not json', contentType: 'application/json' }) }), 'رد غير صالح'],
    [server({ model: () => ({ status: 401 }) }), 'تعذر الوصول'],
  ];
  for (const [s, expected] of cases) {
    const { page, errors, ctx } = await app({ seed: [...baseSeed, readySettings], onRoute: s.onRoute });
    await send(page, 'كيف كان مزاجي هذا الشهر؟');
    const msgs = await page.evaluate(() => aiCurrentConv().messages);
    const err = msgs.find(m => m.source === 'error');
    assert(err && err.text.includes(expected), `expected "${expected}" got ${err && err.text}`);
    assert(msgs.some(m => m.source === 'local' && m.text.includes('/10')), 'local fallback answered');
    // journaling still works after a failure
    await page.evaluate(() => go('daily')); await page.click('button:has-text("حفظ تسجيل اليوم")');
    assert((await store(page, 'logs')).some(l => l.date === new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })), 'daily save ok');
    eq(errors, [], 'no JS errors');
    await ctx.close();
  }
});

await test('explain stats sends only computed numbers; invented numbers are flagged', async () => {
  const s = server({ model: () => '{"explanation":"متوسط مزاجك جيد، وتحسن بنسبة 37.5% وفق تقديري.","caveats":["العينة صغيرة"]}' });
  const { page, ctx } = await app({ seed: [...baseSeed, readySettings], onRoute: s.onRoute });
  await page.evaluate(() => aiSwitch(1));
  await page.click('button:has-text("اشرح لي هذه النتائج")');
  await page.waitForSelector('#aiExplain .ai-bubble');
  const c = s.log.requests[0].context;
  assert(c.computed_stats && !JSON.stringify(c).includes('كوب شاي') && !c.journal, 'numbers only');
  const t = await page.textContent('#aiExplain');
  assert(t.includes('37.5%') && t.includes('لم يحسبها التطبيق'), 'flagged');
  await ctx.close();
});

await test('server rejects a client that tries to send forbidden profile fields', async () => {
  const s = server();
  const { page, ctx } = await app({ seed: [...baseSeed, readySettings], onRoute: s.onRoute });
  const err = await page.evaluate(async () => { try { await AIService.call('explain_stats', { context: { profile: { medical: 'x' } } }); return 'none'; } catch (e) { return e.code; } });
  eq(err, 'forbidden_context_field', 'rejected');
  await ctx.close();
});

await test('action planner: approve, complete with reflection, dismiss, custom step linked to goal', async () => {
  const { page, ctx } = await app();
  await page.evaluate(() => aiSwitch(3));
  const n = await page.locator('.ai-act.suggest').count();
  assert(n >= 2, 'suggestions ' + n);
  eq(await store(page, 'ai_actions'), null, 'nothing stored before approval');
  await page.locator('.ai-act.suggest button:has-text("اعتمدها")').first().click();
  await page.locator('.ai-act.suggest button:has-text("ليست مناسبة")').first().click();
  let acts = await store(page, 'ai_actions');
  eq(acts.map(a => a.status).sort(), ['active', 'dismissed'], 'statuses');
  await page.locator('.ai-act.active button:has-text("أنجزتها")').click();
  await page.click('#aiUseful .chip[data-val="5"]'); await page.fill('#aiReflNote', 'ساعدني'); await page.click('#aiModal button:has-text("حفظ")');
  acts = await store(page, 'ai_actions');
  const d = acts.find(a => a.status === 'done');
  eq([d.reflection.useful, d.reflection.note], [5, 'ساعدني'], 'reflection');
  await page.fill('#aiNewTitle', 'اتصال بأخي'); await page.fill('#aiNewStep', 'مكالمة 5 دقائق'); await page.selectOption('#aiNewGoal', 'القلق');
  await page.click('button:has-text("إضافة")');
  eq((await store(page, 'ai_actions')).find(a => a.title === 'اتصال بأخي').goal, 'القلق', 'goal link');
  await page.evaluate(() => aiSwitch(1));
  assert((await page.textContent('#aiContent')).includes('0/1 خطوات منجزة'), 'goal progress shown');
  await ctx.close();
});

await test('reports: choose period, generate, compare, export MD/JSON, AI narrative, delete', async () => {
  const s = server({ model: () => '{"summary":"فترة فيها تحسن بسيط في المزاج.","observations":["النوم أقل في بعض الأيام"],"next_steps":["استمر في المشي"]}' });
  const { page, ctx } = await app({ seed: [...baseSeed, readySettings], onRoute: s.onRoute });
  await page.evaluate(() => aiSwitch(4));
  await page.click('.ai-period .chip:text-is("14 يوماً")');
  await page.click('button:has-text("إنشاء التقرير")');
  let reps = await store(page, 'ai_reports');
  eq([reps.length, reps[0].days, reps[0].comparison.valid], [1, 14, true], 'report + comparison');
  const [md] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Markdown")')]);
  const mdText = fs.readFileSync(await md.path(), 'utf8');
  assert(mdText.includes('ليس تشخيصاً') && mdText.includes('المقارنة بالفترة السابقة'), 'md content');
  const [js] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("JSON")')]);
  eq(JSON.parse(fs.readFileSync(await js.path(), 'utf8')).id, reps[0].id, 'json');
  await page.click('button:has-text("ملخص سردي")'); await page.waitForFunction(() => !aiBusy);
  reps = await store(page, 'ai_reports');
  assert(reps[0].narrative && reps[0].narrative.summary.includes('تحسن'), 'narrative stored');
  assert(!JSON.stringify(s.log.requests[0].context).includes('كوب شاي'), 'narrative uses numbers only');
  await page.click('.rep-block button:has-text("حذف")');
  eq(await store(page, 'ai_reports'), [], 'deleted');
  await ctx.close();
});

await test('history controls: not keeping history leaves nothing in storage; delete conversations', async () => {
  const { page, ctx } = await app();
  await send(page, 'كيف كان مزاجي هذا الشهر؟');
  assert((await store(page, 'ai_conv')).length === 1, 'stored');
  await page.evaluate(() => aiSwitch(5)); await page.uncheck('text=حفظ المحادثات على هذا الجهاز >> input');
  eq(await store(page, 'ai_conv'), null, 'removed from storage');
  await page.evaluate(() => aiSwitch(0));
  await send(page, 'وماذا عن نومي؟');
  eq(await store(page, 'ai_conv'), null, 'still not stored');
  await page.evaluate(() => aiSwitch(5)); await page.check('text=حفظ المحادثات على هذا الجهاز >> input');
  await page.click('.ai-row:has-text("المحادثات") .ai-link');
  eq(await store(page, 'ai_conv'), null, 'deleted');
  await ctx.close();
});

await test('backup: export → wipe → import restores; re-import adds no duplicates; corrupt rows rejected; pre-import restore', async () => {
  const { page, ctx } = await app();
  await page.evaluate(() => go('settings'));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("تصدير نسخة كاملة")')]);
  const file = await dl.path();
  const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert(!('pin' in exported.data) && exported.data.logs.length === data.logs.length, 'export content, no PIN');
  const counts = async () => page.evaluate(() => ['logs', 'sessions', 'scHist'].map(k => (S.get(k, []) || []).length));
  const orig = await counts();
  await page.evaluate(() => ['logs', 'sessions', 'scHist'].forEach(k => S.del(k)));
  await page.setInputFiles('#backupCard input[type=file]', file); await page.waitForTimeout(300);
  eq(await counts(), orig, 'restored');
  await page.setInputFiles('#backupCard input[type=file]', file); await page.waitForTimeout(300);
  eq(await counts(), orig, 'no duplicates');
  const bad = { app: 'NafsiLog', format: 2, data: { logs: [{ date: '2020-01-01', mood: 4 }, { date: 'nope', mood: 5 }, { date: '2020-01-02', mood: '<script>' }, 'x'], scHist: [{ type: 'evil', score: 3, date: '2020-01-01' }] } };
  const badPath = path.join(SHOTS, '..', 'tmp_bad_backup.json'); fs.writeFileSync(badPath, JSON.stringify(bad));
  await page.setInputFiles('#backupCard input[type=file]', badPath); await page.waitForTimeout(300);
  const c2 = await counts();
  eq([c2[0], c2[2]], [orig[0] + 1, orig[2]], 'only the one valid row merged');
  await page.click('button:has-text("استرجاع")'); await page.waitForTimeout(100);
  eq(await counts(), orig, 'pre-import snapshot restored');
  fs.unlinkSync(badPath);
  const notApp = path.join(SHOTS, '..', 'tmp_other.json'); fs.writeFileSync(notApp, '{"hello":1}');
  await page.setInputFiles('#backupCard input[type=file]', notApp); await page.waitForTimeout(200);
  eq(await counts(), orig, 'foreign file ignored'); fs.unlinkSync(notApp);
  await ctx.close();
});

await test('delete-all removes journal, sessions and every AI key', async () => {
  const { page, ctx } = await app({ seed: [...baseSeed, readySettings] });
  await send(page, 'مرحبا');
  await page.evaluate(() => { aiSwitch(4); aiGenReport(); clearAll(); });
  const left = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('nl_')));
  eq(left, [], 'all removed');
  await ctx.close();
});

await test('PHQ-9 item 9 ≥ 1 shows support resources after saving; existing score unchanged', async () => {
  const { page, ctx } = await app();
  await page.evaluate(() => go('scales'));
  for (let i = 0; i < 9; i++) await page.evaluate(q => setSc('phq', q, q === 8 ? 1 : 0), i);
  await page.click('button:has-text("حفظ النتيجة")');
  assert(await page.isVisible('#aiSafetyCard'), 'card');
  const h = await store(page, 'scHist'); eq([h[h.length - 1].score, Object.keys(h[h.length - 1]).sort()], [1, ['date', 'max', 'score', 'ts', 'type']], 'record shape unchanged');
  await ctx.close();
});

await test('existing report uses non-diagnostic wording', async () => {
  const { page, ctx } = await app();
  await page.evaluate(() => go('report'));
  const t = await page.textContent('#reportContent');
  assert(!/مطابقة محتملة|DSM-5 MDD|DSM-5 GAD|معايير الاكتئاب الكبير/.test(t), 'no DSM matching claims');
  assert(t.includes('ليست درجات سريرية'), 'indices labelled');
  await ctx.close();
});

await test('local date: an entry saved at 01:30 Cairo time is filed under the local day', async () => {
  const ctxp = await openApp(browser, { seed: baseSeed });
  await ctxp.page.clock.setFixedTime(new Date('2026-10-30T01:30:00+02:00'));
  eq(await ctxp.page.evaluate(() => ds()), '2026-10-30', 'local date');
  await ctxp.ctx.close();
});

await test('mobile 360px and 768px: no horizontal overflow, RTL, screenshots', async () => {
  for (const vp of [{ width: 360, height: 760 }, { width: 768, height: 1000 }]) {
    const s = server({ model: () => '{"reply":"مرحباً، ما الذي يشغلك اليوم؟","follow_up_questions":["ما أصعب لحظة اليوم؟"]}' });
    const { page, ctx } = await app({ viewport: vp, seed: [...baseSeed, readySettings], onRoute: s.onRoute });
    await send(page, 'أشعر بالتوتر قبل الاجتماعات');
    for (let t = 0; t < 6; t++) {
      await page.evaluate(i => aiSwitch(i), t);
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(ov <= 1, `overflow ${ov}px on tab ${t} at ${vp.width}`);
      if (vp.width === 360) await page.screenshot({ path: path.join(SHOTS, `ai-tab${t}-360.png`), fullPage: t !== 0 });
    }
    eq(await page.evaluate(() => getComputedStyle(document.body).direction), 'rtl', 'rtl');
    const navOv = await page.evaluate(() => [...document.querySelectorAll('.nav-btn')].some(b => b.scrollWidth > b.clientWidth + 2));
    assert(!navOv, 'nav labels fit');
    await ctx.close();
  }
});

await browser.close();
process.exit(summary('NafsiLog AI') ? 1 : 0);
