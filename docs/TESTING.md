# Tests

Run everything: `./tests/run-all.sh` (Node 22+, Playwright + Chromium). All data is synthetic (`tests/fixtures.mjs`); no real journal content is used or logged.

## Results — run on 2026-10-30, branch `feature/nafsilog-ai`

| Suite | What | Result |
|---|---|---|
| JS syntax | both `<script>` blocks parsed | ✅ pass |
| `tests/edge.test.mjs` | Edge Function core + handler: config, validation, forbidden fields, crisis detector (incl. false-positive checks), output parsing, prompt/key isolation, auth/origin/method/body errors, retry on 529, timeout → 504, provider 401, rate limiting, server-side safety flag | ✅ 11/11 |
| `tests/e2e-existing.mjs` | PIN create/unlock, all pages render, daily save/upsert/reload, PHQ-9/GAD-7 scoring, report numbers, empty-data charts, CBT session, MD export, PIN change, delete-all | ✅ 11/11 (baseline `index.html`: 10/11 — delete-all left `nl_sessions`, fixed) |
| `tests/e2e-life.mjs` | keepMoney import (minimised, numbers vs independent computation), import guards/undo/delete, money risk levels, daily family fields + backup round-trip, father tab (stress spill-over, age-filtered missions, protections, children), crisis card on overview, money×mood, local chat for money/father/risk, AI scopes send aggregates only + persona in server prompt, server rejects names/notes, report extras + MD, consent v1 → re-consent, delete-all, 360 px | ✅ 15/15 |
| `tests/e2e-ai.mjs` | browser ↔ **real handler** with simulated provider: tabs render offline, stats match an independent computation, missing data (no NaN), pattern evidence/feedback, local chat, five-part reflection → thought record, crisis card offline, consent gate, secret-key guard, minimisation & forbidden fields, scope selection & redaction, crisis with AI on, failures (not configured / rate limit ×2 / timeout / malformed JSON / provider auth) with local fallback and journaling still working, explain-stats + invented-number flag, server rejection of forbidden fields, planner approve/complete/dismiss/goal progress, reports + comparison + MD/JSON + narrative + delete, history off/delete, backup export/import/no-duplicates/corrupt rows/pre-import restore/foreign file, delete-all, PHQ-9 item 9 card, non-diagnostic report wording, local date at 01:30 Cairo, 360/768 px no overflow + RTL | ✅ 24/24 |

Not executed: calls to a real AI provider; deployment to Supabase; real iOS/Android devices or the Median APK (mobile was emulated in Chromium at 360 and 768 px; screenshots in `tests/screenshots/`, git-ignored).

Re-run on 2026-10-30 after the comprehensive-analysis update: edge 11/11, existing 11/11, AI 24/24, comprehensive 15/15.

## Manual checklist (phone, after deploying)

1. Open the site → existing PIN works; Home, يومي, مقاييس, تمارين, تقريري, إعدادات look as before.
2. Save today's log at night after midnight → it appears under today's date.
3. 🤖 المساعد shows "وضع محلي"; ask «كيف كان مزاجي هذا الشهر؟» → numbers match تقريري.
4. Describe a situation → five guided questions → "افحص الفكرة في سجل الأفكار" pre-fills the CBT session.
5. Type a crisis phrase → red support card with tappable 123 / 16328 numbers appears immediately.
6. الاتجاهات: switch 7/30/90/مخصص → numbers and chart change; empty period shows the empty state.
7. الأنماط: each card shows evidence with dates, sufficiency, hypothesis, question; reject one → it moves to "رفضتها".
8. الخطة: approve one suggestion, complete it with a rating; it appears under goal progress in الاتجاهات.
9. التقارير: generate 14 days → comparison or the reason it isn't valid; export Markdown; delete.
10. الإعدادات → تصدير نسخة كاملة; then استيراد the same file → counts unchanged; استرجاع works.
11. Enable AI (consent checkbox required) → configure endpoint + code → اختبار الاتصال ✅ → send a message; check "استجابة نموذج ذكاء اصطناعي" label and the attached-data note; "👁 معاينة" shows only selected data.
12. Turn the network off → message shows an error and a local answer; journaling still saves.
13. الخصوصية: turn off "حفظ المحادثات", delete conversations/reports; "إيقاف وسحب الموافقة" returns to local mode.
14. الإعدادات → مسح كل البيانات → app returns to first-run PIN setup with nothing left.
15. keepMoney → الإعدادات → تصدير JSON; NafsiLog → 🤖 → 💰 المال → استيراد → numbers match keepMoney's dashboard (income, expense, debts).
16. 🧭 الصورة الشاملة shows four domains; anything without data says «غير معروف» and what to record.
17. يومي → «الأسرة والصحة» for a few days → 👨‍👧 أبوّتي shows minutes, rating and missions; adopt one.
