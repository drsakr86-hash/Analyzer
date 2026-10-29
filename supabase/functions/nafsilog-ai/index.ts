// Supabase Edge Function entry point: `supabase functions deploy nafsilog-ai --no-verify-jwt`
// Required secrets: AI_PROVIDER, AI_MODEL, AI_API_KEY, APP_ACCESS_CODES (see docs/DEPLOYMENT.md).
import { handle } from './handler.ts';
import { MemoryLimiter } from './core.ts';

const lim = Deno.env.get('RATE_LIMIT_PER_HOUR');
const memLimiter = new MemoryLimiter(lim != null && lim !== '' && Number.isFinite(Number(lim)) ? Math.max(0, Math.floor(Number(lim))) : 30, 3600_000);

Deno.serve((req) => handle(req, {
  env: (k) => Deno.env.get(k),
  fetch,
  memLimiter,
  // Metadata only. Never log request bodies, journal text, codes or keys.
  log: (o) => console.log(JSON.stringify(o)),
}));
