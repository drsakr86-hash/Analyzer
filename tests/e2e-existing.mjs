// Regression tests for features that existed before the AI work.
// Run against the baseline:  APP=path/to/old/index.html node tests/e2e-existing.mjs
import { chromium, test, assert, eq, summary, openApp, unlock, store } from './harness.mjs';
import { makeDataset, seedScript } from './fixtures.mjs';

const browser = await chromium.launch();
const data = makeDataset();
const seed = seedScript(data);

console.log('Existing features');

await test('first run: PIN create + confirm unlocks and stores PIN', async () => {
  const { page, errors, ctx } = await openApp(browser);
  for (const d of '2580') await page.click(`.numpad-btn:text-is("${d}")`);
  await page.waitForTimeout(250);
  for (const d of '2580') await page.click(`.numpad-btn:text-is("${d}")`);
  await page.waitForSelector('#lockScreen', { state: 'hidden' });
  eq(await store(page, 'pin'), '2580', 'pin');
  eq(errors, [], 'no JS errors');
  await ctx.close();
});

await test('wrong PIN keeps lock, right PIN opens', async () => {
  const { page, ctx } = await openApp(browser, { seed });
  for (const d of '0000') await page.click(`.numpad-btn:text-is("${d}")`);
  await page.waitForTimeout(300);
  assert(await page.isVisible('#lockScreen'), 'lock still visible');
  await unlock(page);
  await ctx.close();
});

await test('all nav pages render without JS errors', async () => {
  const { page, errors, ctx } = await openApp(browser, { seed });
  await unlock(page);
  for (const p of ['daily', 'scales', 'exercises', 'report', 'settings', 'home']) {
    await page.evaluate(x => go(x), p);
    assert(await page.isVisible('#page-' + p), p + ' visible');
  }
  for (let t = 0; t < 7; t++) await page.evaluate(i => switchEx(i), t);
  for (let t = 0; t < 4; t++) await page.evaluate(i => switchSc(i), t);
  await page.evaluate(() => go('report'));
  for (let t = 0; t < 5; t++) { await page.evaluate(i => switchReportTab(i), t); await page.waitForTimeout(60); }
  eq(errors, [], 'no JS errors');
  await ctx.close();
});

await test('daily log saves, upserts by date and survives reload', async () => {
  const { page, ctx } = await openApp(browser, { seed });
  await unlock(page);
  const before = (await store(page, 'logs')).length;
  await page.evaluate(() => go('daily'));
  await page.fill('#moodSlider', '8');
  await page.fill('#sleepH', '7.5');
  await page.fill('#stressor', 'اختبار');
  await page.click('.tag-toggle:text-is("#إنجاز")');
  await page.click('button:has-text("حفظ تسجيل اليوم")');
  let logs = await store(page, 'logs');
  const today = await page.evaluate(() => ds());
  const t = logs.filter(l => l.date === today);
  eq(t.length, 1, 'one entry for today');
  eq([t[0].mood, t[0].sleep, t[0].tags.includes('#إنجاز')], [8, 7.5, true], 'fields');
  // save again -> still one entry
  await page.evaluate(() => go('daily'));
  await page.fill('#moodSlider', '6');
  await page.click('button:has-text("حفظ تسجيل اليوم")');
  logs = await store(page, 'logs');
  eq(logs.filter(l => l.date === today).length, 1, 'upsert not duplicate');
  assert(logs.length === before + 1 || logs.length === before, 'count');
  await page.reload();
  await unlock(page);
  eq((await store(page, 'logs')).find(l => l.date === today).mood, 6, 'persisted after reload');
  await ctx.close();
});

await test('PHQ-9 and GAD-7 scoring and save', async () => {
  const { page, ctx } = await openApp(browser, { seed });
  await unlock(page);
  await page.evaluate(() => go('scales'));
  // all "2" -> 18
  for (let i = 0; i < 9; i++) await page.evaluate(q => setSc('phq', q, 2), i);
  const shown = await page.textContent('#scContent');
  assert(shown.includes('18'), 'PHQ shows 18');
  await page.evaluate(() => saveScResult('phq', 18, 27));
  await page.evaluate(() => { const r = document.getElementById('aiSafetyCard'); if (r) r.remove(); });
  await page.evaluate(() => switchSc(1));
  for (let i = 0; i < 7; i++) await page.evaluate(q => setSc('gad', q, 1), i);
  assert((await page.textContent('#scContent')).includes('7'), 'GAD 7');
  const h = await store(page, 'scHist');
  eq(h[h.length - 1].score, 18, 'saved PHQ');
  await ctx.close();
});

await test('report renders statistics consistent with stored data', async () => {
  const { page, errors, ctx } = await openApp(browser, { seed });
  await unlock(page);
  await page.evaluate(() => go('report'));
  const txt = await page.textContent('#reportContent');
  const mean = (data.logs.reduce((a, l) => a + l.mood, 0) / data.logs.length).toFixed(1);
  assert(txt.includes(`متوسط ${mean}/10`), 'mean mood ' + mean);
  eq(errors, [], 'no errors');
  await ctx.close();
});

await test('charts handle empty data and few records', async () => {
  const { page, errors, ctx } = await openApp(browser, { seed: [['nl_pin', '"1234"'], ['nl_logs', JSON.stringify(data.logs.slice(0, 2))]] });
  await unlock(page);
  await page.evaluate(() => go('report'));
  assert((await page.textContent('#reportContent')).includes('البيانات غير كافية'), 'empty state');
  for (let t = 1; t < 5; t++) await page.evaluate(i => switchReportTab(i), t);
  eq(errors, [], 'no errors');
  await ctx.close();
});

await test('CBT session completes and is stored', async () => {
  const { page, ctx } = await openApp(browser, { seed });
  await unlock(page);
  await page.evaluate(() => { go('exercises'); switchEx(0); });
  await page.click('button:has-text("ابدأ الجلسة")');
  await page.fill('[data-key=situation]', 'موقف تجريبي');
  await page.click('button:has-text("التالي")');
  await page.click('button:has-text("التالي")');
  await page.fill('[data-key=hotThought]', 'فكرة تجريبية');
  for (let i = 0; i < 4; i++) await page.click('button:has-text("التالي")');
  await page.click('button:has-text("أنهِ الجلسة")');
  const s = await store(page, 'sessions');
  eq(s[s.length - 1].ans.hotThought, 'فكرة تجريبية', 'session stored');
  await ctx.close();
});

await test('report Markdown export downloads', async () => {
  const { page, ctx } = await openApp(browser, { seed });
  await unlock(page);
  await page.evaluate(() => go('report'));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportMD())]);
  assert(/nafsilog_report_.*\.md/.test(dl.suggestedFilename()), 'filename');
  await ctx.close();
});

await test('change PIN validates and saves', async () => {
  const { page, ctx } = await openApp(browser, { seed });
  await unlock(page);
  await page.evaluate(() => go('settings'));
  await page.fill('#curPin', '1234'); await page.fill('#newPin', '4321'); await page.fill('#confPin', '4321');
  await page.evaluate(() => changePin());
  eq(await store(page, 'pin'), '4321', 'pin changed');
  await ctx.close();
});

await test('delete all clears stored data', async () => {
  const { page, ctx } = await openApp(browser, { seed });
  await unlock(page);
  await page.evaluate(() => clearAll());
  const left = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('nl_') && !k.startsWith('nl_backup')));
  eq(left, [], 'no nl_ keys left');
  await ctx.close();
});

await browser.close();
process.exit(summary('Existing features') ? 1 : 0);
