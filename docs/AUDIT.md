# NafsiLog — Phase A Audit (pre-AI baseline)

Audited commit: `943a953` (tag `baseline-pre-ai`). Repository contents: `index.html` (2,667 lines, ~178 KB, all CSS/HTML/JS inline) and a 10-byte `README.md`. No build step, no backend, no tests, no CI. Deployed as a static site on GitHub Pages.

## 1. Screens and workflows (verified)

| Screen | Entry | What it does |
|---|---|---|
| Lock | on load | 4-digit PIN create / confirm / unlock; "skip" link on first run |
| Home (`go('home')`) | nav 0 | today card, streak / total / mean mood, last 8 logs, quick-exercise shortcuts |
| Daily (`daily`) | nav 1 | mood 1–10, sleep hours, 3 events, stressor + distress 1–10, intrusive thought, gratitude, 10 quick tags; one record per date (overwrite) |
| Scales (`scales`) | nav 2 | PHQ-9, GAD-7 (0–3 per item, total only saved), custom 1–10 scale, history (last 20) |
| Exercises (`exercises`) | nav 3 | 7 tabs: CBT thought record (7 steps), behavioural activation (6), fear ladder (5), emotion acceptance (5, 3-min timer), 4-7-8 breathing, activity schedule, session history with per-session Markdown export |
| Report (`report`) | nav 4 | rule-based "psychological report" (needs ≥3 logs) + 4 chart tabs: mood/sleep line + 6-week heatmap, correlations (Pearson mood↔sleep, mood↔distress, weekday, tag means), weekday patterns, PHQ/GAD trend lines; Markdown export |
| Settings (`settings`) | nav 5 | profile (age, gender, marital status, goals, medical history/meds, baseline PHQ/GAD), change PIN, daily reminder, delete all |

All of these features listed in the mission were present. Not present: whole-dataset JSON export, any import, any backup/restore.

## 2. Data model — `localStorage`, prefix `nl_`

| Key | Shape | Written by |
|---|---|---|
| `nl_pin` | `"1234"` plaintext string | lock / settings |
| `nl_logs` | `[{date:'YYYY-MM-DD', mood, sleep|null, ev1, ev2, ev3, stressor, stressLevel, intrusive, gratitude, tags[], ts}]` | `saveDaily` (upsert by date) |
| `nl_scHist` | `[{type:'phq'|'gad', score, max, date, ts}]` (item answers are **not** stored) | `saveScResult` |
| `nl_customSc` | `[{name, score, notes, date, ts}]` | `saveCS` |
| `nl_sessions` | `[{type:'done-cbt'|'done-ba'|'done-fl'|'done-ea', ans:{…}, dur, date, ts}]` | `sessFinish` |
| `nl_cbtE` | legacy quick CBT entries `[{sit, auto, pro, con, alt, date, ts}]` (writer `saveCBT` is now unreachable from the UI, still read by the report) | — |
| `nl_actL` | `[{name, exp, act, date, ts}]` | `saveAct` |
| `nl_breathL` | `[{date, dur, cycles, ts}]` | breathing |
| `nl_profile` | `{age, gender, status, goals, medical, phqBaseline, gadBaseline}` | `saveProfile` |
| `nl_remTime` | `"21:00"` | reminder |

Reports are not persisted; they are recomputed on each visit.

## 3. Calculations

`avg`, population `stdDev`, `pearson` (returns null when n<3; UI requires ≥4), `calcStreak`, first-half vs second-half mood trend. The report then derives weighted "indices" (depression, anxiety, sleep, resilience, wellbeing) from mixed heuristics — when no PHQ-9/GAD-7 exists, the "depression index" is estimated from mean mood and then mapped back onto PHQ-9 severity labels.

## 4. PIN — limitations (must not be described as security)

- Stored in plaintext in `localStorage`; any script on the origin or anyone with device/devtools access can read it.
- "Skip" silently sets the PIN to `0000`.
- The lock is a CSS overlay; data is not encrypted and is readable without the PIN.
- No attempt limiting. `localStorage` is shared by every page on `drsakr86-hash.github.io` (same origin as the owner's other apps).
- It is a privacy curtain against casual glances, nothing more.

## 5. Export / import / deletion / backup

- Export: report Markdown (`exportMD`, last 7 logs + summary) and per-session Markdown. Both append an "instructions for Claude" footer intended for pasting into an external AI.
- Import: none. Backup: none.
- `clearAll()` deletes `logs, profile, scHist, cbtE, actL, breathL, customSc, pin, remTime` — **it misses `nl_sessions`**, so completed therapy sessions survive "delete all data permanently". (Bug, fixed.)

## 6. Mobile & accessibility

Responsive single column (max 680 px), fixed bottom nav, RTL throughout. Gaps: tag chips and scale options are `div`s (no keyboard focus / roles); no `aria-label`s; `maximum-scale=1.0` blocks pinch-zoom; emoji-only icons; `</head>` tag missing (browsers recover).

## 7. AI code

No model integration exists. "AI" is limited to Markdown exports with a footer asking the user to paste into Claude — which, if followed, sends journal text to a third party with no consent screen or minimisation.

## 8. Dependencies and deployment

Only Google Fonts (CSS). Static GitHub Pages; no server, no secrets, no Supabase. Any AI integration therefore requires a new server-side component.

## 9. Risks found

| Risk | Detail | Handling |
|---|---|---|
| Wrong-day records | `ds()` uses `toISOString()` (UTC). In Egypt (UTC+2/+3) entries saved between midnight and 02:00/03:00 are filed under the previous day and can overwrite it. | Fixed to local date; existing records untouched. |
| Incomplete deletion | `nl_sessions` not cleared. | Fixed; new AI keys also cleared. |
| Unescaped user text in `innerHTML` | tags, activity names, ladder items, custom scale names, session text. Self-only today, but becomes injectable once import or model output exists. | New code escapes everything; import is schema-validated; model output is rendered as text only. Key existing render paths patched with `esc()`. |
| Diagnostic language | Existing report prints "possible match with N DSM-5 major-depression criteria" and maps mood averages onto PHQ-9 severity labels; regex "death thoughts" detector matches ordinary words such as "انتهى". | Wording changed to non-diagnostic, estimated indices labelled as non-clinical; computations otherwise preserved. |
| PHQ-9 item 9 not acted on | Item 9 (thoughts of self-harm) is answered but never triggers support guidance. | Support card shown when item 9 ≥ 1 on save. Nothing else changes. |
| Duplicate / corrupted import | No import existed. | New import: validates every record, de-duplicates by date/ts, takes an automatic pre-import snapshot that can be restored. |
| API key exposure | n/a today; the obvious shortcut would put a key in `index.html`. | Key lives only in the server function's secrets. |

## 10. Plan (file level)

- `index.html` — additive: new `#page-ai` + nav button, deterministic analytics engine (`NLA`), pattern explorer, action planner, period reports, AI client with consent/minimisation, crisis detector, backup/import, bug fixes above. No change to existing keys or record shapes.
- `supabase/functions/nafsilog-ai/index.ts` — provider-independent proxy (Anthropic or any OpenAI-compatible API), validation, timeouts, bounded retry, rate limit, no payload logging.
- `supabase/migrations/…_ai_rate_limit.sql` — rate-limit table + RPC.
- `tests/` — Playwright end-to-end + unit tests with synthetic data, edge-function unit tests.
- `docs/` — this audit, architecture/privacy, deployment, manual checklist.
