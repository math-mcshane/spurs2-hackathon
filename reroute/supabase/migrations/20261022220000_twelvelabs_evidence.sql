-- TwelveLabs enrichment cache for REROUTE (OLTP)
-- Databricks job writes UC silver.observations; sync or app upsert lands here for cache-first decide.
-- Aligns with contracts.Evidence + CDM_PLATFORM_PLAN §4.2 / §4.4 (public schema for hackathon).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) Enrichment fields on inbound media projection (ScorePlay id = PK)
-- ---------------------------------------------------------------------------
alter table public.scoreplay_inbound_media
  add column if not exists tl_asset_id text,
  add column if not exists tl_index_id text,
  add column if not exists tl_video_id text,
  add column if not exists tl_status text
    check (tl_status is null or tl_status in ('pending', 'indexing', 'ready', 'failed', 'skipped')),
  add column if not exists tl_enriched_at timestamptz,
  add column if not exists duration_sec numeric;

comment on column public.scoreplay_inbound_media.tl_asset_id is
  'TwelveLabs asset id after URL ingest (or from indexed video).';
comment on column public.scoreplay_inbound_media.tl_status is
  'Mirrors UC silver.eligible_artifacts.tl_status when synced from Databricks / enrich worker.';
comment on column public.scoreplay_inbound_media.tl_video_id is
  'TwelveLabs indexed video id when present (user_metadata.custom_id = media_id).';

create index if not exists scoreplay_inbound_media_tl_status_idx
  on public.scoreplay_inbound_media (tl_status)
  where tl_status is not null;

-- ---------------------------------------------------------------------------
-- 2) Evidence / observations (Vision facts — never permissions)
-- ---------------------------------------------------------------------------
create table if not exists public.evidence (
  id uuid primary key default gen_random_uuid(),
  -- Stable id for idempotent sync from UC observation_id
  observation_id text unique,
  scoreplay_media_id text not null,
  start_sec numeric,
  end_sec numeric,
  observation text not null,
  source text not null check (source in ('TWELVELABS', 'SCOREPLAY', 'HUMAN')),
  label text,
  label_type text,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  origin text check (origin is null or origin in ('LIVE', 'CACHED', 'HUMAN')),
  evidence_json jsonb not null default '{}'::jsonb,
  job_run_id text,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists evidence_media_id_idx
  on public.evidence (scoreplay_media_id);

create index if not exists evidence_source_idx
  on public.evidence (source);

create index if not exists evidence_label_idx
  on public.evidence (label)
  where label is not null;

create index if not exists evidence_media_source_observed_idx
  on public.evidence (scoreplay_media_id, source, observed_at desc);

comment on table public.evidence is
  'Timecoded rights observations (TwelveLabs / ScorePlay tags / HUMAN). Facts only — never grant ALLOWED.';

-- ---------------------------------------------------------------------------
-- 3) Observation run audit (optional; one Pegasus call per media enrich)
-- ---------------------------------------------------------------------------
create table if not exists public.observation_runs (
  id uuid primary key default gen_random_uuid(),
  scoreplay_media_id text not null,
  provider text not null default 'twelvelabs',
  model_name text,
  tl_asset_id text,
  tl_index_id text,
  tl_video_id text,
  status text not null check (status in ('ready', 'failed', 'skipped')),
  cached boolean not null default false,
  error text,
  observation_count integer not null default 0,
  job_run_id text,
  request_meta jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists observation_runs_media_id_idx
  on public.observation_runs (scoreplay_media_id, finished_at desc);

comment on table public.observation_runs is
  'One row per enrich/analyze attempt — model versions, asset URL/id, cache flag.';

-- ---------------------------------------------------------------------------
-- RLS: service-role only (same pattern as webhook tables)
-- ---------------------------------------------------------------------------
alter table public.evidence enable row level security;
alter table public.observation_runs enable row level security;

-- No anon/authenticated policies: REROUTE + Databricks sync use secret/service key only.
