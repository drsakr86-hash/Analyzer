import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
export const { chromium } = pw;

const here = path.dirname(fileURLToPath(import.meta.url));
export const APP = process.env.APP ? path.resolve(process.env.APP) : path.resolve(here, '..', 'index.html');
export const APP_URL = pathToFileURL(APP).href;

const results = [];
let current = '';
export async function test(name, fn) {
  current = name;
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`  PASS  ${name}`); }
  catch (e) { results.push({ name, ok: false, err: e.message }); console.log(`  FAIL  ${name}\n        ${e.message.split('\n')[0]}`); }
}
export function assert(c, msg) { if (!c) throw new Error(msg || `assertion failed in "${current}"`); }
export function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || 'not equal'}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`); }
export function summary(label) {
  const f = results.filter(r => !r.ok);
  console.log(`\n${label}: ${results.length - f.length}/${results.length} passed`);
  return f.length;
}

/** Open the app in a fresh mobile context. `seed` = [[key, jsonString]] put into localStorage before load. */
export async function openApp(browser, { seed = [], viewport = { width: 390, height: 844 }, onRoute } = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'ar-EG', timezoneId: 'Africa/Cairo', acceptDownloads: true });
  // Offline sandbox: block fonts / any network the test does not explicitly mock.
  await ctx.route(/^https?:\/\//, async (route) => {
    if (onRoute) { const handled = await onRoute(route); if (handled) return; }
    return route.abort();
  });
  if (seed.length) await ctx.addInitScript((pairs) => {
    // seed once per context; the marker survives reloads (sessionStorage proved unreliable for file:// reloads)
    if (localStorage.getItem('__test_seeded')) return;
    localStorage.clear();
    for (const [k, v] of pairs) localStorage.setItem(k, v);
    localStorage.setItem('__test_seeded', '1');
  }, seed);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(APP_URL);
  return { ctx, page, errors };
}

export async function unlock(page, pin = '1234') {
  for (const d of pin) await page.click(`.numpad-btn:text-is("${d}")`);
  await page.waitForSelector('#lockScreen', { state: 'hidden' });
}

export const store = (page, key) => page.evaluate(k => JSON.parse(localStorage.getItem('nl_' + k)), key);
