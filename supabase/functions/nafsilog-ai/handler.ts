// HTTP handler, runtime-agnostic (Web Request/Response). Dependencies are injected so it can be unit-tested.
import {
  HttpError, LIMITS, MemoryLimiter, buildPrompt, callProvider, checkAccess, detectCrisis, extractText,
  normalizeOutput, originAllowed, providerRequest, readConfig, validateRequest,
} from './core.ts';

export interface Deps {
  env: (k: string) => string | undefined;
  fetch: typeof fetch;
  log?: (o: Record<string, unknown>) => void; // metadata only — never payloads
  memLimiter?: MemoryLimiter;
}

const list = (v?: string) => (v || '').split(',').map(s => s.trim()).filter(Boolean);

function cors(origin: string | null, allowed: string[]) {
  const allow = origin && (allowed.length === 0 || allowed.includes(origin)) ? origin : (allowed[0] || '*');
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization, apikey, x-client-info, x-nafsilog-access',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function rateLimitOk(deps: Deps, key: string): Promise<boolean> {
  const rawLimit = deps.env('RATE_LIMIT_PER_HOUR');
  const perHour = rawLimit != null && rawLimit !== '' && Number.isFinite(Number(rawLimit)) ? Math.max(0, Math.floor(Number(rawLimit))) : 30; // 0 = kill switch
  const url = deps.env('SUPABASE_URL'), svc = deps.env('SUPABASE_SERVICE_ROLE_KEY');
  if (url && svc && deps.env('RATE_LIMIT_BACKEND') !== 'memory') {
    try {
      const r = await deps.fetch(`${url}/rest/v1/rpc/nl_ai_rate_hit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: svc, authorization: `Bearer ${svc}` },
        body: JSON.stringify({ p_key: key, p_limit: perHour, p_window_seconds: 3600 }),
      });
      if (r.ok) return (await r.json()) === true;
      deps.log?.({ event: 'rate_limit_db_unavailable', status: r.status });
    } catch { deps.log?.({ event: 'rate_limit_db_unreachable' }); }
  }
  if (!deps.memLimiter || perHour === 0) deps.memLimiter = new MemoryLimiter(perHour, 3600_000);
  return deps.memLimiter.hit(key);
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const t0 = Date.now();
  const origin = req.headers.get('origin');
  const allowedOrigins = list(deps.env('ALLOWED_ORIGINS'));
  const headers = { ...cors(origin, allowedOrigins), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  let task = 'unknown';

  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
    if (!originAllowed(origin, allowedOrigins)) throw new HttpError(403, 'origin_not_allowed');

    const codes = list(deps.env('APP_ACCESS_CODES'));
    if (!codes.length) throw new HttpError(503, 'server_not_configured');
    const code = req.headers.get('x-nafsilog-access');
    if (!checkAccess(code, codes)) throw new HttpError(401, 'unauthorized');

    const len = Number(req.headers.get('content-length') || 0);
    if (len > LIMITS.bodyBytes) throw new HttpError(413, 'body_too_large');
    const raw = await req.text();
    if (raw.length > LIMITS.bodyBytes) throw new HttpError(413, 'body_too_large');
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new HttpError(400, 'invalid_json'); }
    const input = validateRequest(parsed);
    task = input.task;

    const { config, missing } = readConfig(deps.env);
    if (!config) { deps.log?.({ event: 'config_missing', missing }); throw new HttpError(503, 'server_not_configured'); }
    if (input.task === 'ping') return reply(200, { ok: true, task, result: { reply: 'ok', provider: config.provider, model: config.model } });

    if (!(await rateLimitOk(deps, await sha256(code!)))) throw new HttpError(429, 'rate_limited');

    // Server-side safety net in addition to the client's detector.
    const lastUser = [...input.messages].reverse().find(m => m.role === 'user');
    if (lastUser && detectCrisis(lastUser.content)) input.safety_flag = true;

    const { system, messages } = buildPrompt(input);
    const body = await callProvider(config, providerRequest(config, system, messages), deps.fetch);
    const { text, usage } = extractText(config, body);
    const result = normalizeOutput(input.task, text, input.safety_flag);
    deps.log?.({ event: 'ok', task, ms: Date.now() - t0, in_tokens: usage?.input, out_tokens: usage?.output });
    return reply(200, { ok: true, task, result, model: config.model });
  } catch (e) {
    const err = e instanceof HttpError ? e : new HttpError(500, 'internal_error');
    deps.log?.({ event: 'error', task, code: err.code, status: err.status, ms: Date.now() - t0 });
    return reply(err.status, { ok: false, error: err.code });
  }
}
