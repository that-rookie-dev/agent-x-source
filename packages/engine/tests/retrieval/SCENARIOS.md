# Manual / simulated scenario checklist (Phase 7.6 · T7/T8)

Recorded 2026-07-21 against the offline synthetic corpus + unit harness.

| Scenario | Query / setup | Expected | Result |
|----------|---------------|----------|--------|
| T7 KB cite | `ERR_AUTH_401` (q01) | Top evidence includes auth chunk; citeable `[E#]` | **PASS** — `evaluateQuery` hitRelevant=true; tool formatter emits `[E1 · KB · …]` |
| T8 Abstain | CEO birthday / stock / medical / 2099 world cup (q09–q11, q20, q28) | No relevant product chunks; abstain path | **PASS** — abstainAccuracy=1.0 on golden abstain set; empty marker contract tested |
| Conflict / hedge | Auth JWT vs Storage Postgres both above threshold for “compare auth and storage” (q07) | Both sections eligible; packer may keep multiple sources | **PASS** — diversity cap allows ≤3/source; compare chunk + section chunks available |
| Exact code | `session_uuid dd25259d` / `FOLLOWS edge type` | Hybrid/lexical path surfaces chunk | **PASS** — Precision@5 frozen 0.96 on find set |
| Weak only | distance-only noise below `minScoreKb` | Empty evidence + `EMPTY_EVIDENCE_MARKER` | **PASS** — score-gate unit test T5 |

Live desktop confirmation (optional ops): upload a PDF → ask a fact → verify `[E#]` in answer; ask unrelated → abstain. Runbook: `RETRIEVAL_REINDEX_RUNBOOK.md`.
