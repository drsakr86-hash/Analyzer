// Unit tests for the Edge Function core + handler. Run: node --experimental-strip-types tests/edge.test.mjs
import * as core from '../supabase/functions/nafsilog-ai/core.ts';
import { handle } from '../supabase/functions/nafsilog-ai/handler.ts';
import { test, assert, eq, summary } from './harness.mjs';

const ENV = {
  AI_PROVIDER: 'anthropic', AI_MODEL: 'test-model', AI_API_KEY: 'sk-test-SECRET', APP_ACCESS_CODES: 'code-a,code-b',
  ALLOWED_ORIGINS: 'https://drsakr86-hash.github.io', RATE_LIMIT_PER_HOUR: '3', RATE_LIMIT_BACKEND: 'memory',
};
const env = (over = {}) => (k) => ({ ...ENV, ...over })[k];
const okBody = (text) => ({ content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 } });
function mkFetch(responses) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  };
  f.calls = calls;
  return f;
}
const req = (body, headers = {}) => new Request('https://x.supabase.co/functions/v1/nafsilog-ai', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://drsakr86-hash.github.io', 'x-nafsilog-access': 'code-a', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const chat = { task: 'chat', messages: [{ role: 'user', content: 'كيف كان مزاجي هذا الأسبوع؟' }], context: { stats: { moodMean: 5.4, n: 6 } } };

console.log('Edge function');

await test('config: missing secrets reported, values clamped', async () => {
  const r = core.readConfig(() => undefined);
  assert(!r.config && r.missing.length === 3, 'missing list');
  const r2 = core.readConfig(env({ AI_TIMEOUT_MS: '999999', AI_MAX_RETRIES: '9' }));
  eq([r2.config.timeoutMs, r2.config.maxRetries], [55000, 2], 'clamped');
  const r3 = core.readConfig(env({ AI_PROVIDER: 'openai_compatible' }));
  assert(r3.missing.some(m => m.startsWith('AI_BASE_URL')), 'base url required');
});

await test('validation rejects bad task / sizes / forbidden fields', async () => {
  const bad = [
    { task: 'hack' }, { task: 'chat', messages: [] }, { task: 'chat', messages: [{ role: 'system', content: 'x' }] },
    { task: 'chat', messages: [{ role: 'user', content: 'x'.repeat(2001) }] },
    { task: 'explain_stats', context: { profile: { medical: 'x' } } },
    { task: 'explain_stats', context: { big: 'x'.repeat(15000) } },
  ];
  for (const b of bad) { let threw = false; try { core.validateRequest(b); } catch { threw = true; } assert(threw, 'should reject ' + JSON.stringify(b).slice(0, 60)); }
  eq(core.validateRequest(chat).task, 'chat', 'valid chat');
});

await test('crisis detector (ar/en) and no false positive on ordinary text', async () => {
  for (const t of ['أفكر في الانتحار', 'مش عايز أعيش خلاص', 'I want to kill myself', 'أريد أن أموت']) assert(core.detectCrisis(t), t);
  for (const t of ['انتهى الاجتماع متأخراً', 'كنت متعباً اليوم', 'الموت والحياة في الأدب']) assert(!core.detectCrisis(t), 'fp: ' + t);
});

await test('output parsing: fenced JSON, loose JSON, HTML stripped, plain-text chat fallback', async () => {
  const o = core.normalizeOutput('chat', '```json\n{"reply":"<b>مرحبا</b>","follow_up_questions":["سؤال؟"],"suggested_actions":[{"title":"مشي","step":"امش 10 دقائق"}]}\n```', false);
  eq([o.reply, o.follow_up_questions.length, o.suggested_actions.length], ['مرحبا', 1, 1], 'parsed');
  eq(core.normalizeOutput('chat', 'نص عادي فقط', false).reply, 'نص عادي فقط', 'fallback');
  const s = core.normalizeOutput('chat', '{"reply":"x","suggested_actions":[{"title":"a","step":"b"}]}', true);
  eq([s.safety_concern, s.suggested_actions.length], [true, 0], 'no actions under safety');
  let threw = false; try { core.normalizeOutput('suggest_actions', 'garbage', false); } catch (e) { threw = e.code === 'invalid_model_output'; }
  assert(threw, 'structured task needs JSON');
});

await test('prompt: data block attached, safety note added, never contains API key', async () => {
  const { system, messages } = core.buildPrompt({ ...core.validateRequest(chat), safety_flag: true });
  assert(system.includes('Follow rule 6'), 'safety');
  assert(messages[0].content.includes('STORED_DATA') && messages[0].content.includes('5.4'), 'data');
  const cfg = core.readConfig(env()).config;
  const call = core.providerRequest(cfg, system, messages);
  assert(!call.init.body.includes('sk-test-SECRET'), 'key not in body');
  eq(call.init.headers['anthropic-version'], '2023-06-01', 'version header');
  const oc = core.providerRequest({ ...cfg, provider: 'openai_compatible', baseUrl: 'https://api.example.com/v1/' }, system, messages);
  eq(oc.url, 'https://api.example.com/v1/chat/completions', 'openai url');
});

await test('handler: happy path returns normalized result, logs metadata only', async () => {
  const logs = [];
  const f = mkFetch([{ body: okBody('{"reply":"تبدو الأيام الأخيرة أهدأ.","follow_up_questions":[]}') }]);
  const res = await handle(req(chat), { env: env(), fetch: f, log: o => logs.push(o) });
  const j = await res.json();
  eq([res.status, j.ok, j.result.reply], [200, true, 'تبدو الأيام الأخيرة أهدأ.'], 'response');
  assert(!JSON.stringify(logs).includes('مزاجي') && !JSON.stringify(logs).includes('code-a'), 'no payload/code in logs');
  eq(res.headers.get('access-control-allow-origin'), 'https://drsakr86-hash.github.io', 'cors');
});

await test('handler: auth, origin, config, method and body errors', async () => {
  const f = mkFetch([]);
  const s = async (r, e = env()) => (await handle(r, { env: e, fetch: f })).status;
  eq(await s(req(chat, { 'x-nafsilog-access': 'wrong' })), 401, 'bad code');
  eq(await s(req(chat, { origin: 'https://evil.example' })), 403, 'origin');
  eq(await s(req(chat), env({ AI_API_KEY: '' })), 503, 'not configured');
  eq(await s(req(chat), env({ APP_ACCESS_CODES: '' })), 503, 'no codes configured');
  eq(await s(req('{not json')), 400, 'bad json');
  eq(await s(new Request('https://x/f', { method: 'GET' })), 405, 'GET');
  eq(f.calls.length, 0, 'provider never called');
});

await test('handler: retries once on 529 then succeeds; timeout maps to 504', async () => {
  const f = mkFetch([{ status: 529 }, { body: okBody('{"reply":"ok"}') }]);
  const res = await handle(req(chat), { env: env(), fetch: f });
  eq([res.status, f.calls.length], [200, 2], 'retried');
  const slow = async (_u, init) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => { const e = new Error('a'); e.name = 'AbortError'; rej(e); }));
  const res2 = await handle(req(chat), { env: env({ AI_TIMEOUT_MS: '3000', AI_MAX_RETRIES: '0' }), fetch: slow });
  eq([res2.status, (await res2.json()).error], [504, 'provider_timeout'], 'timeout');
});

await test('handler: provider 401 -> 502 provider_auth, no retry', async () => {
  const f = mkFetch([{ status: 401 }]);
  const res = await handle(req(chat), { env: env(), fetch: f });
  eq([res.status, (await res.json()).error, f.calls.length], [502, 'provider_auth', 1], 'auth');
});

await test('handler: rate limit after N requests per access code', async () => {
  const deps = { env: env(), fetch: mkFetch(Array.from({ length: 5 }, () => ({ body: okBody('{"reply":"ok"}') }))) };
  const st = [];
  for (let i = 0; i < 4; i++) st.push((await handle(req(chat), deps)).status);
  eq(st, [200, 200, 200, 429], 'limited');
});

await test('handler: server-side crisis detection forces safety flag', async () => {
  const f = mkFetch([{ body: okBody('{"reply":"أنا هنا معك.","suggested_actions":[{"title":"x","step":"y"}]}') }]);
  const r = await handle(req({ task: 'chat', messages: [{ role: 'user', content: 'أفكر أن أنهي حياتي' }], context: {} }), { env: env(), fetch: f });
  const j = await r.json();
  eq([j.result.safety_concern, j.result.suggested_actions.length], [true, 0], 'safety');
  assert(JSON.parse(f.calls[0].init.body).system.includes('Follow rule 6'), 'prompt flagged');
});

process.exit(summary('Edge function') ? 1 : 0);
