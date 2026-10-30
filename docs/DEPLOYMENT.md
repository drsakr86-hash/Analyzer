# Deployment

## 1. Front end (GitHub Pages)

Nothing to build. Merging this branch into `main` publishes `index.html` at https://drsakr86-hash.github.io/Analyzer/. The app works fully without any backend (local mode).

Rollback: `git revert` the merge, or redeploy tag `baseline-pre-ai`. User data in browsers is untouched either way (only new `nl_ai_*` keys were added; the old app ignores them).

## 2. Backend (optional — only for AI responses)

Prerequisites: a Supabase project, the Supabase CLI, and an API key from the provider you choose.

```bash
# from the repository root
supabase login
supabase link --project-ref <your-project-ref>

# rate-limit table + function (stores only hashed access code + counter)
supabase db push            # applies supabase/migrations/20261030000000_nafsilog_ai_rate_limit.sql

# secrets — never put these in index.html
supabase secrets set \
  AI_PROVIDER=anthropic \
  AI_MODEL=claude-sonnet-5-5 \
  AI_API_KEY=<provider key> \
  APP_ACCESS_CODES=<long random code, e.g. from: openssl rand -hex 24> \
  ALLOWED_ORIGINS=https://drsakr86-hash.github.io

supabase functions deploy nafsilog-ai --no-verify-jwt
```

`--no-verify-jwt` is intentional: the app has no user accounts; the function enforces its own access code, origin allowlist and rate limit.

### Secrets reference

| Name | Required | Notes |
|---|---|---|
| `AI_PROVIDER` | yes | `anthropic` or `openai_compatible` |
| `AI_MODEL` | yes | e.g. `claude-sonnet-5-5` (or `claude-haiku-5-5` for lower cost). No default — the function will not guess a model. |
| `AI_API_KEY` | yes | provider key |
| `AI_BASE_URL` | for `openai_compatible` | e.g. `https://api.openai.com/v1` |
| `APP_ACCESS_CODES` | yes | comma-separated; remove one to revoke a device |
| `ALLOWED_ORIGINS` | recommended | comma-separated |
| `RATE_LIMIT_PER_HOUR` | no | default 30 per access code; `0` disables the service |
| `AI_MAX_OUTPUT_TOKENS` | no | default 900 (100–4000) |
| `AI_TIMEOUT_MS` | no | default 25000 (3000–55000) |
| `AI_MAX_RETRIES` | no | default 1 (0–2), only on 429/5xx/timeout |
| `RATE_LIMIT_BACKEND` | no | set `memory` to skip the DB limiter |

If the migration is not applied the function falls back to a per-instance in-memory limiter (logged as `rate_limit_db_unavailable`).

### Verify

```bash
curl -s -X POST "https://<ref>.supabase.co/functions/v1/nafsilog-ai" \
  -H "content-type: application/json" -H "x-nafsilog-access: <code>" \
  -d '{"task":"ping"}'
# → {"ok":true,"task":"ping","result":{"reply":"ok","provider":"anthropic","model":"..."}}
```

A missing secret returns `503 {"error":"server_not_configured"}`; the function logs which names are missing (never their values).

## 3. Connect the app

In the app: **🤖 المساعد → 🔐 الخصوصية والإعداد → تفعيل…**, read and accept the consent, then enter
- عنوان الخدمة: `https://<ref>.supabase.co/functions/v1/nafsilog-ai`
- رمز الوصول: the code from `APP_ACCESS_CODES`
- (optional) the project's publishable/anon key

Press **اختبار الاتصال**. ✅ means a real round-trip through the function (ping does not call the model). Send one chat message to verify the model.

## 4. Median.co APK

No change needed; the wrapper loads the same Pages URL. If the WebView sends a different `Origin`, add it to `ALLOWED_ORIGINS` (or leave the list empty and rely on the access code).

## Still to configure (not done in this change)

- Choosing the provider/model and creating the API key.
- Creating/linking the Supabase project, applying the migration, setting secrets, deploying the function.
- Entering endpoint + access code on each device.
- Merging the PR to publish the front end.
