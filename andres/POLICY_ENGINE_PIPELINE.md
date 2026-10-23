# Policy engine pipeline — Databricks-first plan

**Track focus:** Policy engine (not the full REROUTE Studio pitch alone).  
**Core idea:** Pre-process every ScorePlay artifact for *outright* violations in Databricks; keep survivors queryable for *contextual* rights when a marketing manager states an intent (player, game, territory, platform, time).

Related: [CDM_PLATFORM_PLAN.md](./CDM_PLATFORM_PLAN.md) · [UNIFIED_DATA_MODEL.md](./UNIFIED_DATA_MODEL.md) · **[databricks/](./databricks/)** (Unity Catalog DDL) · ScorePlay Connect webhooks (ingest → tag → transform → publish → archive).

---

## 1. Two decision layers (do not conflate)

| Layer | When | Question | Outcome |
|-------|------|----------|---------|
| **L1 — Safety / outright pre-process** | On every webhook / new media | “Is this artifact ever usable on club channels without special counsel?” | `AUTO_REJECT` → triage table · or `PASS_L1` → eligible pool |
| **L2 — Contextual rights** | When user states an intent / prompt | “Can *this* manager use *this* pool asset for *this* post (Wemby dunk, Saturday, FR, Instagram, sponsored)?” | `ALLOWED` · `BLOCKED` · `NEEDS_REVIEW` (+ reasons) |

**Invariant:** L1 never grants publish permission. L1 only removes blatant junk. L2 always requires intent (territory, platform, usage, competition, people, sponsor, expiry — and later venue/league/region packs).

```text
ScorePlay webhook
    → store raw event (all webhooks)
    → Databricks job L1 (safety + hard policy)
         ├─ AUTO_REJECT  → triage.rejected_artifacts
         └─ PASS_L1      → silver.eligible_artifacts (+ TL enrich)
                              │
Marketing prompt / PublishIntent
    → retrieve candidates (semantic + tags: Wemby, game, …)
    → Databricks job / SQL L2 (contextual packs)
    → decision + optional REROUTE / receipt
```

---

## 2. Example user story (L2)

> “I need to create a post on Saturday about the game that just happened with Wemby scoring or shooting.”

Parsed **PublishIntent** (extend as needed):

| Field | Example |
|-------|---------|
| `publishAt` | next Saturday (ISO) |
| `people` / query | Wembanyama |
| `action` | scoring / shooting (search cue) |
| `competition` | NBA |
| `territory` / region | from UI or prompt (e.g. FR, US-TX) |
| `platform` | instagram (default or asked) |
| `usage` | ORGANIC or SPONSORED |

Flow:

1. Query only `PASS_L1` artifacts (and not in reject triage).  
2. Narrow by game/event + player association (ScorePlay tags + TL).  
3. Run **L2** packs: player · team · league · venue · country/region · advertiser.  
4. Return ranked candidates with verdicts — marketing manager picks; human approves if `NEEDS_REVIEW`.

---

## 3. Databricks jobs

### Job A — `ingest_scoreplay_webhooks`

| Step | Action |
|------|--------|
| 1 | HTTP endpoint (Databricks / Cloudflare Worker / API Gateway) receives ScorePlay Connect webhook |
| 2 | Validate signature / secret |
| 3 | Append-only write to **bronze** (never drop events) |
| 4 | Trigger Job B (or micro-batch every N minutes) |

**Table: `bronze.scoreplay_webhooks`**

```text
event_id STRING              -- idempotency key if provided
event_type STRING            -- ingest | tag | transform | publish | archive | …
occurred_at TIMESTAMP
received_at TIMESTAMP
org_id / company_id STRING
media_id STRING              -- when present
payload STRING               -- VARIANT/JSON full body
headers_json STRING          -- optional redacted
source_ip STRING             -- optional
raw_path STRING              -- Autoloader file path if landed as files
```

**Rule:** Store **all** webhooks, including ones you ignore for L1 (e.g. archive-only). Filtering happens in silver, not at the door.

---

### Job B — `l1_preprocess_artifacts` (policy engine — safety)

Runs on new/changed `media_id` from webhooks (ingest/tag/publish).

| Step | Action |
|------|--------|
| 1 | Resolve media via ScorePlay API (`GET /media/{id}`) → silver asset projection |
| 2 | Ensure TwelveLabs URL ingest / analyze (or cached) for safety observations |
| 3 | Run **L1 policy pack** (deterministic): drugs, nudity, graphic violence, hate, clear PII abuse, etc. |
| 4 | Optional deeper L1: gambling promo hard-bans, medical/sensitive audio (from sample prompts) |
| 5 | Write result |

**Outputs:**

| Result | Destination |
|--------|-------------|
| Blatant violation | `gold.rejected_artifacts` (triage) + optional ScorePlay tag `rights.l1=reject` |
| Pass | `silver.eligible_artifacts` + `gold.l1_decisions` (audit) |

**Table: `gold.rejected_artifacts` (triage — read later)**

```text
reject_id STRING
media_id STRING
company_id STRING
rejected_at TIMESTAMP
l1_policy_id STRING
l1_policy_version STRING
verdict STRING                 -- AUTO_REJECT
rule_ids ARRAY<STRING>
reasons ARRAY<STRING>          -- human-readable
evidence ARRAY<STRUCT<...>>    -- TL labels, timecodes
severity STRING                -- critical | high
triage_status STRING           -- open | acknowledged | false_positive | escalated
triage_notes STRING
reviewed_by STRING
reviewed_at TIMESTAMP
webhook_event_id STRING
payload_snapshot STRING        -- optional slim JSON
```

**Table: `gold.l1_decisions` (all L1 outcomes, pass + reject)**

```text
decision_id STRING
media_id STRING
verdict STRING                 -- AUTO_REJECT | PASS_L1
rule_ids ARRAY<STRING>
reasons ARRAY<STRING>
evidence ARRAY<STRUCT<...>>
policy_id STRING
policy_version STRING
evaluated_at TIMESTAMP
job_run_id STRING
```

**Table: `silver.eligible_artifacts`**

```text
media_id STRING PRIMARY KEY
company_id STRING
event_id STRING
media_type STRING
title / description STRING
tags ARRAY<STRING>
people ARRAY<STRING>           -- from SP + TL
sponsors ARRAY<STRING>
venue STRING
competition STRING
tl_ready BOOLEAN
l1_passed_at TIMESTAMP
rights_facts STRUCT<...>       -- known entitlements only; unknowns null
last_enriched_at TIMESTAMP
```

---

### Job C — `enrich_eligible` (optional batch)

For `PASS_L1` only:

- Marengo index hygiene  
- Pegasus structured observations (sponsors, players, restricted zones)  
- Write `silver.observations`  
- Update search facets for later L2 retrieval  

---

### Job D — `l2_contextual_evaluate` (on demand or micro-batch)

**Trigger:** API from app / marketing prompt → Databricks Job or SQL + Python UDF / Model Serving.

**Inputs:**

- `PublishIntent` (territory, platform, usage, competition, publishAt, …)  
- Optional NL query (“Wemby scoring Saturday”) → retrieval plan  
- Candidate `media_id`s from eligible pool  

**Packs (L2):**

| Pack | Examples |
|------|----------|
| League | NBA / PL window, clean feed, embargo |
| Team / club | Club channel rules, BTS / tunnel |
| Player | Association / NIL / single-player commercial |
| Venue | Stadium naming, third-party marks (NFL @ Tottenham) |
| Country / region | FR vs US-TX vs GB geo, category bans |
| Advertiser / campaign | Sponsored exclusivity |

**Outputs:** `gold.l2_decisions` (+ optional receipt if you keep REROUTE UX).

```text
l2_decision_id STRING
request_id STRING              -- ties to user prompt
media_id STRING
intent STRUCT<...>
verdict STRING                 -- ALLOWED | BLOCKED | NEEDS_REVIEW
reasons ARRAY<STRUCT<...>>
missing_facts ARRAY<STRING>
policy_versions ARRAY<STRING>
evaluated_at TIMESTAMP
```

---

## 4. Unity Catalog layout (policy-engine track)

Catalog: `spurs2`. **Bundle + DDL:** [databricks/](./databricks/) (`databricks.yml`, jobs `seed` / `policy_engine_pipeline`, SQL under `sql/`).

| Schema | Tables |
|--------|--------|
| `bronze` | `scoreplay_webhooks`, `tl_api_raw` |
| `silver` | `assets`, `eligible_artifacts` (includes TL ids), `observations` |
| `gold` | `l1_decisions`, `rejected_artifacts`, `l2_requests`, `l2_decisions` |
| `rules` | `l1_policy_packs`, `l2_policy_packs`, `policy_activations` |

Supabase (optional later): thin API for marketing UI, `l2_requests`, review of `rejected_artifacts.triage_status`. **Heavy policy compute stays in Databricks jobs.**

---

## 5. L1 policy pack (go deeper)

Start DEMO / fictional; expand with counsel later.

| Category | Signals (TL / classifiers / metadata) | Default L1 |
|----------|----------------------------------------|------------|
| Nudity / sexual | Vision labels | AUTO_REJECT |
| Drugs / paraphernalia | Vision + caption | AUTO_REJECT or NEEDS_REVIEW→reject queue |
| Graphic violence | Vision | AUTO_REJECT |
| Hate / extremism | Vision + text | AUTO_REJECT |
| Clear CSAM / minors sexualized | Hard block + escalate | AUTO_REJECT + quarantine process |
| Severe medical gore | Vision | AUTO_REJECT |
| Deeper (pass L1, flag for L2) | Gambling promo, restricted zones, rival sponsor, dirty feed | Do **not** auto-reject; store observations for L2 |

**Triage table readers:** compliance ops UI / SQL: filter `triage_status = open`, false-positive → flip to eligible + note (append-only audit of the change).

---

## 6. L2 retrieval + policy (marketing prompt)

```text
Prompt
  → parse Intent + entities (player=Wemby, event=last game, when=Saturday)
  → SQL/vector over silver.eligible_artifacts
       WHERE people overlap Wemby
       AND event/game match
       AND l1 passed
  → for each candidate: l2_evaluate(intent, observations, rights_facts, packs)
  → return list sorted by: ALLOWED first, then NEEDS_REVIEW, never AUTO_REJECT
```

Factors you called out:

| Factor | Pack / fact |
|--------|-------------|
| Player association | player pack + `people[]` |
| Venue rights | venue pack |
| League | league pack + competition |
| Country | territory pack |
| Region | territory/region parameters (e.g. US-TX) |
| Platform / sponsored | platform + advertiser packs |

Missing entitlement → `NEEDS_REVIEW` (not silent ALLOWED).

---

## 7. Relation to current REROUTE app

| Current Studio | Fits this plan as… |
|----------------|--------------------|
| `decide` / `resolve` / receipt | **L2 UX** on eligible pool |
| Demo FR sponsored policy | One **L2** pack |
| Local `.data/` | Replace with UC gold + optional Supabase |
| ScorePlay search in UI | Should prefer **eligible** ids (filter rejects) |

**New work for your track:** webhook → bronze → Job B L1 → rejected triage; then L2 job callable from prompt/Studio.

---

## 8. Hackathon vs later

### P0 (policy track demo)

1. Webhook receiver → append `bronze.scoreplay_webhooks` (or file Autoloader if webhook proxy writes JSON).  
2. Notebook/Job: for sample media ids, run L1 rules (even if TL is cached/mock labels for drugs/nudity DEMO).  
3. Populate `gold.rejected_artifacts` + show triage SQL/table.  
4. L2: one notebook that takes intent JSON (“Wemby / Saturday / FR / Instagram / ORGANIC”) and scores 5 eligible clips.  
5. Pitch: “We don’t wait for the marketing ask to find porn/drugs — we pre-kill those; the ask only runs on a clean pool with player/venue/league/geo packs.”

### P1

- Real ScorePlay webhook signature verification  
- Continuous Job A/B on all ingest events  
- Wire Studio to call L2 job / SQL warehouse  
- False-positive triage UI  

### P2

- Multi-pack L2 (full stakeholder model)  
- Supabase for app; CDC to UC  
- ScorePlay writeback of L1 reject tags  

---

## 9. Open questions (confirm with ScorePlay / organizers)

1. Exact webhook payload schema + event types + signing secret?  
2. May L1 write reject tags back to ScorePlay in sandbox?  
3. Is off-platform TL/analyze approved for all inbound media (`MEDIA_PROCESSING_APPROVED`)?  
4. Which L1 categories are in-scope for the hackathon demo vs legal-sensitive (minors)? Prefer DEMO synthetic labels if needed.  
5. Region grain: country only or country+region (state)?  

---

## 10. One-sentence architecture

**Databricks ingests every ScorePlay webhook, auto-rejects blatant unsafe artifacts into a triage table, enriches the rest, and runs a second, intent-aware policy pass when marketing asks for a post — factoring player, venue, league, country/region, and campaign — without ever treating “not rejected” as “cleared to publish.”**

---

## 11. Policy pack runbook (Wave 6)

**Author → Validate → Version → Activate → Reprocess** (no Vercel redeploy required for L2 passport).

### Pack files (SoR in git → UC)

| Layer | Path |
|-------|------|
| L1 | [`databricks/src/policy/packs/l1-safety-demo.json`](./databricks/src/policy/packs/l1-safety-demo.json) |
| G/N/P/C/F | [`databricks/src/policy/packs/l2-passport-*.json`](./databricks/src/policy/packs/) |
| Schema | [`schemas/passport-rules.schema.json`](./schemas/passport-rules.schema.json) |
| Fixtures | [`databricks/tests/fixtures/passport/`](./databricks/tests/fixtures/passport/) |

1. **Author** — edit pack JSON (e.g. N-02 `max_duration_sec` 60 → 45); bump `version`.
2. **Validate** — `cd andres/databricks && python -m pytest tests/test_passport_engine.py -v`
3. **Version** — deploy bundle (`ensure_ddl` MERGEs packs into `rules.l*_policy_packs`).
4. **Activate** — append `rules.policy_activations` (see [`sql/10_activate_demo_packs.sql`](./databricks/sql/10_activate_demo_packs.sql) or [`scripts/bump-n02-example.sql`](./databricks/scripts/bump-n02-example.sql)).
5. **Reprocess** — `force=true` pipeline / `POST /api/l2/enqueue` with `mediaId`; Studio reads `GET /api/passport?mediaId=`.

Studio git JSON (`demo-spurs-fr-sponsored` / `demo-tottenham-pl`) still drives `/api/decide` dimensions; **Rights Passport** is the L2 / `/api/passport` path. Dual path until decide is bridged to passport intent.

**Disclaimer:** all irl.group G/N/P/C/F rules are sample / DEMO — not legal advice.
