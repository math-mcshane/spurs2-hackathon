# CDM platform plan — Supabase vs Databricks Unity Catalog

**Purpose:** Decide where each REROUTE entity lives, what stays in ScorePlay / TwelveLabs, and how systems sync.  
**App source of truth for shapes:** [`reroute/src/lib/contracts.ts`](../reroute/src/lib/contracts.ts)  
**Related:** [UNIFIED_DATA_MODEL.md](./UNIFIED_DATA_MODEL.md) · [REROUTE_TEAM_WORKFLOW.md](../REROUTE_TEAM_WORKFLOW.md) · **[POLICY_ENGINE_PIPELINE.md](./POLICY_ENGINE_PIPELINE.md)** (Databricks webhook → L1 auto-reject → L2 contextual rights)

---

## 1. Principles

| Principle | Meaning |
|-----------|---------|
| **One writer per fact** | Each field has a single system of record; others cache or project. |
| **Binaries stay in ScorePlay** | No cloning of media into Supabase/UC storage for SoR. |
| **Observations ≠ permissions** | TwelveLabs / AI never write entitlement or ALLOWED alone. |
| **App = OLTP; Lake = analytics + governed history** | Supabase serves the Studio; UC serves audit scale, BI, pack analytics. |
| **Append-only decisions** | Receipts / decisions / reviews are never silently updated in place. |
| **Demo ≠ production clearance** | Fictional policies labeled; UC tags `policy_fictional=true`. |

### Placement rule of thumb

| Put in **Supabase** when… | Put in **Unity Catalog** when… |
|---------------------------|--------------------------------|
| Low-latency Studio reads/writes | Heavy history, multi-club analytics |
| Row-level auth for producers/reviewers | Cross-match / season reporting |
| Session-scoped edit plans & live review | Policy version diffs, compliance KPIs |
| Operational queues (PENDING review) | Bronze/silver landings from webhooks |
| Hackathon single-tenant app DB | Future multi-org lakehouse |

**Neither replaces ScorePlay or TwelveLabs.**

---

## 2. Systems of record (full stack)

```text
┌─────────────────┐     ┌──────────────────┐
│ ScorePlay (DAM) │     │ TwelveLabs (AI)  │
│ media, tags,    │     │ index, search,   │
│ preview URLs    │     │ observations     │
└────────┬────────┘     └────────┬─────────┘
         │ cache/project         │ cache/project
         ▼                       ▼
┌────────────────────────────────────────────┐
│              REROUTE CDM                   │
│  Supabase (app OLTP)  │  Databricks UC     │
│  Studio + receipts    │  (lake / analytics)│
└────────────────────────────────────────────┘
```

| System | Owns | Does not own |
|--------|------|--------------|
| **ScorePlay** | Asset bytes, canonical media id, DAM tags, preview/stream URLs, writeback targets | Legal grants; REROUTE decisions |
| **TwelveLabs** | Video index, search hits, Pegasus observations (by TL video id; `custom_id` = ScorePlay id) | Permissions; long-term audit store |
| **Supabase** | App operational CDM: intents, edit plans, decisions, receipts, reviews, human evidence, job state | Master media binaries; season-scale warehouse |
| **Unity Catalog** | Governed analytics copy: bronze SP/TL events, silver projections, gold decision/receipt facts, policy versions over time | Live Studio latency path (unless served via Databricks Apps later) |
| **REROUTE app (code)** | Policy JSON evaluation engine, API orchestration | Durable store (today: `.data/`; target: Supabase) |

**Today (hackathon):** durable state is local `.data/store.json`. This plan is the **target CDM** when you graduate off the file store.

---

## 3. Entity → platform matrix

Aligned to `contracts.ts` (+ store extras).

| Entity / data | ScorePlay | TwelveLabs | **Supabase** | **Unity Catalog** | Notes |
|---------------|-----------|------------|--------------|-------------------|-------|
| Media binary / renditions | **SoR** | — | — | Optional bronze URL refs only | Never duplicate files as SoR |
| `Asset` projection (id, title, tags, facts, urls) | SoR | — | **Cache** (TTL / on-read) | **silver.assets** (batch sync) | Canonical id = ScorePlay media id |
| `RightsFacts` on asset | Metadata SoR | — | Cache columns / jsonb | silver | `undefined` → NEEDS_REVIEW |
| TL index / video id map | — | **SoR** | Cache `tl_video_id` | silver.tl_asset_map | `custom_id` = ScorePlay id |
| Search hits / candidates | — | Ephemeral SoR | Optional session cache | Optional bronze search logs | Don’t treat as entitlements |
| Observations / `Evidence` (TL) | — | Producer | **Persist** for decide path | silver.observations | Tag `origin` LIVE\|CACHED |
| Human evidence | — | — | **SoR** | gold / silver append | From `.data/observations` today |
| `PublishIntent` | — | — | **SoR** (per session/receipt) | gold with receipt | |
| `EditPlan` + segments | — | — | **SoR** | gold with receipt | Derived edits flagged |
| Policy JSON files | — | — | **Versioned rows** or still git for demo | **rules** schema, versioned | Git OK for hackathon |
| `Decision` / `EditDecision` | — | — | **SoR** (append) | **gold.decisions** | |
| `RightsReceipt` | Writeback mirror | — | **SoR** | **gold.receipts** | |
| Human review log | — | — | **SoR** | gold.reviews | APPROVED/REJECTED |
| Writeback events | Destination | — | **SoR** status | gold.writeback_events | |
| Render jobs / `.renders` | — | — | Job metadata SoR | Optional gold | Bytes on disk/object store, not SP SoR until upload |
| Access gate evaluations | — | — | Optional audit | gold.access_log | App-level, not SP ACL |
| Org / user / RLS | — | — | **SoR** (auth.users + profiles) | Optional dim | Studio auth |
| CLEAR consent / license (future) | Optional mirror | — | **SoR** | gold.entitlements | Feeds RightsFacts |

---

## 4. Supabase CDM (OLTP) — proposed schema

Schema: `reroute` (or `public` for hackathon). Postgres + RLS.

### 4.1 Identity

```sql
-- org / club tenant
create table reroute.orgs (
  id uuid primary key default gen_random_uuid(),
  club_code text unique,              -- SAS | TOT
  scoreplay_company_id text,
  created_at timestamptz not null default now()
);

create table reroute.profiles (
  user_id uuid primary key references auth.users,
  org_id uuid references reroute.orgs,
  role text not null check (role in ('producer','reviewer','admin')),
  display_name text
);
```

### 4.2 Media cache (not SoR)

```sql
create table reroute.assets (
  scoreplay_media_id text primary key,
  org_id uuid references reroute.orgs,
  title text not null,
  kind text not null check (kind in ('video','image','other')),
  thumbnail_url text,
  preview_url text,
  duration_sec numeric,
  tags text[] not null default '{}',
  facts jsonb not null default '{}',   -- RightsFacts
  metadata jsonb not null default '{}',
  origin text not null check (origin in ('LIVE','CACHED','HUMAN')),
  tl_video_id text,
  synced_at timestamptz not null default now()
);
```

### 4.3 Creative + intent

```sql
create table reroute.edit_plans (
  id text primary key,                -- app-generated
  org_id uuid references reroute.orgs,
  title text not null,
  derived boolean not null default false,
  derived_from text,
  segments jsonb not null,            -- Segment[]
  created_by uuid references auth.users,
  created_at timestamptz not null default now()
);

create table reroute.publish_intents (
  id uuid primary key default gen_random_uuid(),
  edit_plan_id text references reroute.edit_plans,
  territory text not null,
  platform text not null,
  usage text not null check (usage in ('ORGANIC','SPONSORED')),
  competition text not null,
  publish_at timestamptz not null,
  created_at timestamptz not null default now()
);
```

### 4.4 Evidence, decisions, receipts (append-oriented)

```sql
create table reroute.evidence (
  id uuid primary key default gen_random_uuid(),
  scoreplay_media_id text not null,
  start_sec numeric,
  end_sec numeric,
  observation text not null,
  source text not null check (source in ('TWELVELABS','SCOREPLAY','HUMAN')),
  label text,
  confidence numeric,
  origin text check (origin in ('LIVE','CACHED','HUMAN')),
  created_at timestamptz not null default now()
);

create table reroute.decisions (
  id uuid primary key default gen_random_uuid(),
  edit_plan_id text not null references reroute.edit_plans,
  intent_id uuid references reroute.publish_intents,
  verdict text not null check (verdict in ('ALLOWED','BLOCKED','NEEDS_REVIEW')),
  reasons jsonb not null,
  missing_facts text[] not null default '{}',
  evidence jsonb not null default '[]',
  policy_id text not null,
  policy_version text not null,
  policy_fictional boolean not null,
  segment_decisions jsonb not null,   -- SegmentDecision[]
  evaluated_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table reroute.receipts (
  id text primary key,
  org_id uuid references reroute.orgs,
  edit_plan_id text not null,
  decision_id uuid references reroute.decisions,
  source_asset_ids text[] not null,
  derivative_asset_id text,
  intent jsonb not null,
  decision jsonb not null,            -- denormalized Decision for portable receipt
  edit jsonb not null,
  human_review_status text not null check (human_review_status in ('PENDING','APPROVED','REJECTED')),
  writeback jsonb not null default '[]',
  created_at timestamptz not null
);

create table reroute.reviews (
  id uuid primary key default gen_random_uuid(),
  receipt_id text not null references reroute.receipts,
  status text not null check (status in ('APPROVED','REJECTED')),
  reviewer text not null,
  at timestamptz not null
);
```

### 4.5 Jobs & policies

```sql
create table reroute.render_jobs (
  id uuid primary key default gen_random_uuid(),
  receipt_id text references reroute.receipts,
  edit_plan_id text not null,
  status text not null,               -- queued|running|done|failed|blocked_policy
  output_path text,
  error text,
  created_at timestamptz not null default now()
);

create table reroute.policy_versions (
  policy_id text not null,
  version text not null,
  fictional boolean not null,
  disclaimer text not null,
  body jsonb not null,                -- full policy document
  primary key (policy_id, version)
);
```

### 4.6 RLS sketch

- Producers: CRUD edit_plans / intents in their `org_id`; read decisions/receipts.
- Reviewers: update review + receipt.human_review_status; no policy body edit unless admin.
- Service role: ScorePlay/TL sync workers only.

---

## 5. Databricks Unity Catalog CDM (lake)

Catalog suggestion: `spurs2` (or `reroute_prod`).

| Schema | Contents |
|--------|----------|
| `bronze` | Raw ScorePlay webhook/API payloads; TL API request/response logs; app event export |
| `silver` | Normalized `assets`, `observations`, `tl_asset_map`, `rights_facts` |
| `gold` | `decisions`, `receipts`, `reviews`, `writeback_events`, `access_log`, `render_jobs` |
| `rules` | `policy_versions` history (every published pack) |
| `dims` | `org`, `competition`, `territory`, `platform` |

### 5.1 Gold tables (analytics grain)

```text
gold.fact_decisions
  decision_sk, receipt_id, edit_plan_id, org_sk,
  verdict, policy_id, policy_version, policy_fictional,
  territory, platform, usage, competition, publish_at,
  evaluated_at, reason_count, missing_fact_count

gold.fact_segment_decisions
  decision_sk, scoreplay_media_id, start_sec, end_sec, verdict, rule_ids[]

gold.fact_receipts
  receipt_id, human_review_status, created_at, writeback_status

gold.dim_policy
  policy_id, version, fictional, effective_from, effective_to
```

### 5.2 What UC is for (REROUTE)

- Compliance ops dashboards: % BLOCKED by dimension, pack, club.
- Audit export for hackathon judges / future counsel (portable).
- Reprocessing: re-evaluate historical intents when policy_version bumps.
- Multi-club comparison (SAS vs TOT) without overloading Supabase.
- Optional: serve read-only SQL warehouse to BI — **not** the Studio hot path.

### 5.3 Ingest into UC

| Source | Pattern |
|--------|---------|
| ScorePlay | Webhooks → Autoloader bronze; or scheduled API pull |
| TwelveLabs | App logs observation payloads → bronze (or Supabase CDC) |
| Supabase | CDC (Supabase → Databricks partner connector / periodic dump of receipts+decisions) |
| Policy git/JSON | Job publishes each version into `rules.policy_versions` |

---

## 6. Sync patterns

```text
ScorePlay ──(read on demand)──► REROUTE API ──► Supabase.assets (upsert cache)
TwelveLabs ─(observe/search)──► REROUTE API ──► Supabase.evidence
Producer ───(decide/receipt)──► Supabase.decisions / receipts
Supabase ───(CDC / nightly)───► UC bronze/silver/gold
REROUTE ────(writeback)───────► ScorePlay tags (mirror of receipt summary)
```

| Sync | Latency | Direction |
|------|---------|-----------|
| Asset hydrate | Request-time | SP → App → Supabase |
| Evidence | Request-time | TL → App → Supabase |
| Receipt create | Sync write | App → Supabase |
| UC gold | Minutes–hours | Supabase → UC |
| ScorePlay writeback | On approve | App → SP |

**Conflict rule:** If ScorePlay metadata and Supabase cache disagree, **re-fetch ScorePlay**; never invent facts in UC to “win.”

---

## 7. Mandatory dimensions → storage

From `contracts.ts`: `territory · platform · usage · competition · people · sponsor · expiry`.

| Dimension | Intent / entitlement store | Observation store |
|-----------|---------------------------|-------------------|
| territory | PublishIntent (Supabase) + policy | — |
| platform | PublishIntent + policy | — |
| usage | PublishIntent + policy | TL evidence (sponsored packaging) |
| competition | Intent + RightsFacts + policy | TL competition cues |
| people | RightsFacts + policy | TL people labels |
| sponsor | RightsFacts + policy | TL sponsor labels |
| expiry | RightsFacts / entitlement dates | — |

**ALLOWED** only when every dimension has a PERMIT reason (engine invariant) — stored on `Decision.reasons[]` in Supabase and projected to UC gold.

---

## 8. Phased rollout

### Phase 0 — Hackathon (now)

| Store | Use |
|-------|-----|
| ScorePlay + TwelveLabs | Live/cached integrations |
| `.data/store.json` | Receipts, reviews, human evidence |
| Git JSON policies | `src/lib/rights/policies/*.json` |
| Supabase / UC | **Optional / out of P0 critical path** |

### Phase 1 — Replace file store

- Stand up Supabase project; migrate `store.ts` → Postgres tables above.
- Keep policies in git **or** `policy_versions` table.
- RLS for multi-user demo.

### Phase 2 — Lakehouse

- CDC Supabase → UC gold.
- Bronze ScorePlay webhooks.
- BI on verdict rates; policy version lineage.

### Phase 3 — Multi-stakeholder packs

- Split policy packs (league/team/player/territory/advertiser) as rows in Supabase + UC `rules`.
- CLEAR consent tables in Supabase feeding `RightsFacts`.

---

## 9. Explicit non-goals (avoid double SoR)

| Do not | Why |
|--------|-----|
| Store master MP4 in Supabase Storage as SoR | ScorePlay owns media |
| Treat UC as Studio database | Latency + auth model wrong |
| Write ALLOWED from TL into ScorePlay without Decision/Receipt | Breaks invariants |
| Mirror full TL embeddings into Postgres | Cost; keep in TL |
| Put secrets in UC tables | Use Databricks secrets / Supabase vault |

---

## 10. Decision summary

| Layer | Platform |
|-------|----------|
| **Media SoR** | ScorePlay |
| **Vision SoR** | TwelveLabs |
| **App CDM (operational)** | **Supabase** — intents, edits, evidence, decisions, receipts, reviews, jobs, users |
| **Analytics / governed history** | **Databricks Unity Catalog** — bronze landings, silver projections, gold facts, policy history |
| **Hackathon shortcut** | Local `.data/` until Supabase is wired |

**One sentence:** Supabase is the REROUTE product database; Unity Catalog is the compliance lakehouse; ScorePlay and TwelveLabs remain external systems of record for files and vision.
