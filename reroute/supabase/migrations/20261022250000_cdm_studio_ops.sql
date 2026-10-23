-- CDM Studio ops: receipts SoR, compliance mirrors, L2 request staging, triage
-- Apply after 20261022240000_media_passports.sql
-- DEMO: fictional policies; UC remains SoR for L1/L2 compute.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Receipts + reviews (app SoR; replaces .data/store.json when Supabase configured)
-- ---------------------------------------------------------------------------
create table if not exists public.receipts (
  id text primary key,
  source_asset_ids text[] not null default '{}',
  derivative_asset_id text,
  intent jsonb not null,
  decision jsonb not null,
  edit jsonb not null,
  human_review_status text not null
    check (human_review_status in ('PENDING', 'APPROVED', 'REJECTED')),
  writeback jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists receipts_created_at_idx
  on public.receipts (created_at desc);

create index if not exists receipts_review_status_idx
  on public.receipts (human_review_status);

comment on table public.receipts is
  'Rights receipts — Studio SoR (append-oriented). Lake may mirror later for BI.';

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  receipt_id text not null references public.receipts (id) on delete cascade,
  status text not null check (status in ('APPROVED', 'REJECTED')),
  reviewer text not null,
  at timestamptz not null default now()
);

create index if not exists reviews_receipt_id_idx
  on public.reviews (receipt_id, at desc);

comment on table public.reviews is
  'Human review audit trail for receipts (append-only).';

-- ---------------------------------------------------------------------------
-- Compliance mirrors (UC gold → Studio; Databricks upserts)
-- ---------------------------------------------------------------------------
create table if not exists public.compliance_rejected (
  media_id text primary key,
  company_id text,
  title text,
  media_type text,
  cdn_url text,
  verdict text not null default 'AUTO_REJECT',
  reason_codes text[] not null default '{}',
  reason_summary text,
  triage_status text not null default 'new'
    check (triage_status in ('new', 'acknowledged', 'appealed', 'closed', 'false_positive', 'escalated')),
  triage_notes text,
  latest_decision_id text,
  first_rejected_at timestamptz,
  last_rejected_at timestamptz,
  policy_pack_id text,
  policy_version text,
  evidence_json jsonb not null default '{}'::jsonb,
  job_run_id text,
  reviewed_by text,
  reviewed_at timestamptz,
  triage_dirty boolean not null default false,
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists compliance_rejected_triage_idx
  on public.compliance_rejected (triage_status, last_rejected_at desc nulls last);

comment on table public.compliance_rejected is
  'Mirror of UC gold.compliance_rejected / rejected_artifacts for Studio triage.';

create table if not exists public.l1_decisions (
  decision_id text primary key,
  media_id text not null,
  company_id text,
  decided_at timestamptz not null,
  verdict text not null check (verdict in ('AUTO_REJECT', 'PASS_L1')),
  policy_pack_id text,
  policy_version text,
  reason_codes text[] not null default '{}',
  reason_summary text,
  evidence_json jsonb not null default '{}'::jsonb,
  input_event_id text,
  job_run_id text,
  synced_at timestamptz not null default now()
);

create index if not exists l1_decisions_media_id_idx
  on public.l1_decisions (media_id, decided_at desc);

comment on table public.l1_decisions is
  'Mirror of UC gold.l1_decisions (append-oriented sync).';

create table if not exists public.compliance_summary (
  bucket text primary key,
  n_artifacts bigint not null default 0,
  as_of timestamptz,
  synced_at timestamptz not null default now()
);

comment on table public.compliance_summary is
  'Mirror of UC gold.compliance_summary rollup buckets.';

-- ---------------------------------------------------------------------------
-- L2 request staging (Studio decide → UC gold.l2_requests via pipeline pull)
-- ---------------------------------------------------------------------------
create table if not exists public.l2_requests (
  request_id text primary key,
  media_id text not null,
  company_id text,
  requested_at timestamptz not null default now(),
  channel text,
  territory text,
  window_start timestamptz,
  window_end timestamptz,
  intent_json jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'decided', 'failed', 'synced')),
  app_verdict text check (app_verdict is null or app_verdict in ('ALLOWED', 'BLOCKED', 'NEEDS_REVIEW')),
  receipt_id text references public.receipts (id),
  job_run_id text,
  source text not null default 'studio_decide',
  created_at timestamptz not null default now()
);

create index if not exists l2_requests_status_idx
  on public.l2_requests (status, requested_at desc);

create index if not exists l2_requests_media_id_idx
  on public.l2_requests (media_id, requested_at desc);

comment on table public.l2_requests is
  'Studio-queued L2 evaluations. Pipeline syncs queued rows → gold.l2_requests.';

create table if not exists public.l2_decisions (
  decision_id text primary key,
  request_id text,
  media_id text not null,
  company_id text,
  decided_at timestamptz not null,
  verdict text not null check (verdict in ('ALLOWED', 'BLOCKED', 'NEEDS_REVIEW')),
  policy_pack_id text,
  policy_version text,
  reason_codes text[] not null default '{}',
  reason_summary text,
  dimensions_json jsonb not null default '{}'::jsonb,
  passport_json jsonb,
  job_run_id text,
  synced_at timestamptz not null default now()
);

create index if not exists l2_decisions_media_id_idx
  on public.l2_decisions (media_id, decided_at desc);

create index if not exists l2_decisions_request_id_idx
  on public.l2_decisions (request_id)
  where request_id is not null;

comment on table public.l2_decisions is
  'Mirror of UC gold.l2_decisions for Studio lake badge / audit.';

-- ---------------------------------------------------------------------------
-- RLS: service-role only
-- ---------------------------------------------------------------------------
alter table public.receipts enable row level security;
alter table public.reviews enable row level security;
alter table public.compliance_rejected enable row level security;
alter table public.l1_decisions enable row level security;
alter table public.compliance_summary enable row level security;
alter table public.l2_requests enable row level security;
alter table public.l2_decisions enable row level security;
