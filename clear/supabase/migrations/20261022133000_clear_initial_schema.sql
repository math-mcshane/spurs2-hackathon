create extension if not exists pgcrypto;

do $$ begin
  create type public.clear_verdict as enum ('CLEARED', 'REVIEW', 'BLOCKED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.review_state as enum ('OPEN', 'ASSIGNED', 'RESOLVED');
exception when duplicate_object then null; end $$;

create table if not exists public.creators (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  email text not null,
  social_handle text,
  identity_status text not null default 'UNVERIFIED',
  created_at timestamptz not null default now()
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  clear_id text not null unique,
  creator_id uuid references public.creators(id),
  title text not null,
  source_filename text,
  media_type text not null default 'video',
  captured_at timestamptz,
  duration_seconds numeric,
  scoreplay_collection_id text,
  scoreplay_media_id text,
  scoreplay_version_id text,
  scoreplay_file_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.ownership_attestations (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id),
  creator_id uuid not null references public.creators(id),
  statement_version text not null,
  statement_text text not null,
  accepted_at timestamptz not null,
  evidence jsonb not null default '{}'::jsonb
);

create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id),
  creator_id uuid not null references public.creators(id),
  template_version text not null,
  platforms text[] not null default '{}',
  territories text[] not null default '{}',
  organic_allowed boolean not null default true,
  paid_allowed boolean not null default false,
  modification_allowed boolean not null default false,
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  license_payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint license_term_valid check (expires_at > starts_at)
);

create table if not exists public.consent_events (
  id uuid primary key default gen_random_uuid(),
  consent_reference text not null unique,
  license_id uuid not null references public.licenses(id),
  creator_id uuid not null references public.creators(id),
  event_type text not null default 'LICENSE_ACCEPTED',
  payload_hash text not null,
  previous_event_hash text,
  event_payload jsonb not null,
  occurred_at timestamptz not null default now()
);

create table if not exists public.video_analyses (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id),
  provider text not null default 'twelvelabs',
  provider_reference text,
  model_version text,
  summary text,
  labels text[] not null default '{}',
  raw_result jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.evidence_findings (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.video_analyses(id),
  rule_id text not null,
  outcome text not null check (outcome in ('PASS', 'AMBIGUOUS', 'CONFLICT')),
  start_seconds numeric,
  end_seconds numeric,
  evidence_text text not null,
  confidence numeric check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  constraint evidence_time_valid check (end_seconds is null or start_seconds is null or end_seconds >= start_seconds)
);

create table if not exists public.publication_requests (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id),
  platform text not null,
  territory text not null,
  paid_use boolean not null default false,
  modification_required boolean not null default false,
  sponsor_name text,
  campaign_name text,
  publish_after timestamptz,
  requested_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.rights_decisions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id),
  publication_request_id uuid not null references public.publication_requests(id),
  verdict public.clear_verdict not null,
  reason_codes text[] not null default '{}',
  explanation text not null,
  rule_pack_id text not null,
  rule_pack_version text not null,
  rule_pack_status text not null default 'draft',
  confidence numeric check (confidence between 0 and 1),
  license_id uuid references public.licenses(id),
  analysis_id uuid references public.video_analyses(id),
  decided_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists public.review_tasks (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.rights_decisions(id),
  state public.review_state not null default 'OPEN',
  assigned_to uuid references auth.users(id),
  resolution text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.asset_matches (
  id uuid primary key default gen_random_uuid(),
  source_asset_id uuid not null references public.assets(id),
  candidate_asset_id uuid not null references public.assets(id),
  match_type text not null,
  similarity numeric not null check (similarity between 0 and 1),
  rights_safe boolean not null default false,
  reason text,
  created_at timestamptz not null default now(),
  unique (source_asset_id, candidate_asset_id, match_type)
);

create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references public.assets(id),
  adapter text not null,
  direction text not null check (direction in ('INGEST', 'WRITEBACK')),
  external_reference text,
  payload_hash text,
  status text not null,
  error_message text,
  occurred_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  actor_id uuid references auth.users(id),
  event_payload jsonb not null default '{}'::jsonb,
  event_hash text not null,
  previous_event_hash text,
  occurred_at timestamptz not null default now()
);

create index if not exists assets_creator_idx on public.assets (creator_id);
create index if not exists assets_scoreplay_media_idx on public.assets (scoreplay_media_id);
create index if not exists licenses_asset_active_idx on public.licenses (asset_id, expires_at) where revoked_at is null;
create index if not exists findings_analysis_rule_idx on public.evidence_findings (analysis_id, rule_id);
create index if not exists decisions_asset_date_idx on public.rights_decisions (asset_id, decided_at desc);
create index if not exists review_tasks_state_idx on public.review_tasks (state, created_at);
create index if not exists audit_entity_idx on public.audit_events (entity_type, entity_id, occurred_at);

alter table public.creators enable row level security;
alter table public.assets enable row level security;
alter table public.ownership_attestations enable row level security;
alter table public.licenses enable row level security;
alter table public.consent_events enable row level security;
alter table public.video_analyses enable row level security;
alter table public.evidence_findings enable row level security;
alter table public.publication_requests enable row level security;
alter table public.rights_decisions enable row level security;
alter table public.review_tasks enable row level security;
alter table public.asset_matches enable row level security;
alter table public.integration_events enable row level security;
alter table public.audit_events enable row level security;

create or replace function public.prevent_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'CLEAR audit and consent events are append-only';
end;
$$;

drop trigger if exists consent_events_append_only on public.consent_events;
create trigger consent_events_append_only before update or delete on public.consent_events
for each row execute function public.prevent_audit_mutation();

drop trigger if exists audit_events_append_only on public.audit_events;
create trigger audit_events_append_only before update or delete on public.audit_events
for each row execute function public.prevent_audit_mutation();

comment on schema public is 'CLEAR UGC licensing, evidence, rights decisions, and audit records.';
comment on table public.rights_decisions is 'Deterministic verdicts for a specific asset and publication request.';
comment on table public.evidence_findings is 'Timecoded AI evidence; findings inform rules but do not independently grant rights.';
comment on table public.consent_events is 'Append-only creator consent evidence with hash-chain fields.';

