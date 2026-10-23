-- REROUTE × PULSE workflow store: goal runs, versioned campaigns, rights evaluations, alternatives,
-- hash-chained audit events, writeback attempts and the TwelveLabs observation cache.
-- Stores ids, decisions and evidence text only — never event media (spec §9).
-- Server-only: every table has RLS on and no anon/authenticated privileges; the app uses the secret key.

create extension if not exists pgcrypto with schema extensions;

-- ---------- Append-only guard (pattern from CLEAR's audit tables) ----------

create or replace function public.reroute_prevent_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'REROUTE table % is append-only (% rejected)', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

-- ---------- Goal runs (one document per run, optimistic concurrency on version) ----------

create table public.reroute_goal_runs (
  id text primary key,
  version integer not null default 1 check (version >= 1),
  document jsonb not null,                      -- PULSE GoalRun (validated by the app that owns it)
  objective text not null,                      -- the business objective as written
  club text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reroute_goal_runs_document_id check (document ->> 'id' = id)
);
create index reroute_goal_runs_created_idx on public.reroute_goal_runs (created_at desc);

-- ---------- Campaigns (stable id) + append-only versions ----------

create table public.reroute_campaigns (
  id uuid primary key,
  goal_run_id text references public.reroute_goal_runs (id),
  opportunity_id text unique,                   -- board proposals (simulated signals), keyed by opportunity
  current_version integer not null check (current_version >= 1),
  status text not null default 'DRAFT',
  review_status text check (review_status in ('PENDING', 'APPROVED', 'REJECTED')),
  receipt_id text references public.reroute_receipts (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reroute_campaigns_goal_run_idx on public.reroute_campaigns (goal_run_id, created_at);

create table public.reroute_campaign_versions (
  campaign_id uuid not null references public.reroute_campaigns (id),
  version integer not null check (version >= 1),
  draft jsonb not null,
  actor text not null,
  created_at timestamptz not null default now(),
  primary key (campaign_id, version)
);

/**
 * Atomically creates the campaign (version 1) or appends the next version. The upsert row-locks the
 * campaign, so concurrent saves serialize and never reuse a version number.
 */
create or replace function public.reroute_save_campaign_version(
  p_campaign_id uuid,
  p_draft jsonb,
  p_actor text,
  p_goal_run_id text default null,
  p_opportunity_id text default null
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  next_version integer;
begin
  insert into public.reroute_campaigns as c (id, goal_run_id, opportunity_id, current_version)
  values (p_campaign_id, p_goal_run_id, p_opportunity_id, 1)
  on conflict (id) do update
    set current_version = c.current_version + 1,
        goal_run_id = coalesce(c.goal_run_id, excluded.goal_run_id),
        opportunity_id = coalesce(c.opportunity_id, excluded.opportunity_id),
        updated_at = now()
  returning c.current_version into next_version;

  insert into public.reroute_campaign_versions (campaign_id, version, draft, actor)
  values (p_campaign_id, next_version, p_draft, p_actor);
  return next_version;
end;
$$;

-- ---------- Receipts: link to campaign + MediaRefs used as evidence (additive) ----------

alter table public.reroute_receipts
  add column campaign_id uuid references public.reroute_campaigns (id),
  add column media jsonb not null default '[]'::jsonb;
create index reroute_receipts_campaign_idx on public.reroute_receipts (campaign_id, created_at desc);

-- ---------- Rights evaluations (append-only) ----------

create table public.reroute_evaluations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.reroute_campaigns (id),
  campaign_version integer,
  receipt_id text references public.reroute_receipts (id),
  kind text not null check (kind in ('ORIGINAL', 'ALTERNATIVE')),
  scoreplay_media_ids text[] not null default '{}',
  media jsonb not null default '[]'::jsonb,     -- MediaRef[]
  intent jsonb not null,                        -- PublishIntent
  decision jsonb not null,                      -- Decision
  verdict text not null check (verdict in ('ALLOWED', 'BLOCKED', 'NEEDS_REVIEW')),
  clearance text not null check (clearance in ('VERIFIED', 'DEMO', 'NONE')),
  policy_id text not null,
  policy_kind text check (policy_kind in ('VERIFIED', 'DEMO')),
  created_at timestamptz not null default now(),
  foreign key (campaign_id, campaign_version) references public.reroute_campaign_versions (campaign_id, version),
  -- Only an ALLOWED verdict under a verified (non-demo) policy can carry VERIFIED clearance.
  constraint reroute_evaluations_verified_clearance
    check (clearance <> 'VERIFIED' or (verdict = 'ALLOWED' and policy_kind = 'VERIFIED')),
  constraint reroute_evaluations_clearance_needs_allowed check (clearance = 'NONE' or verdict = 'ALLOWED')
);
create index reroute_evaluations_campaign_idx on public.reroute_evaluations (campaign_id, created_at);
create index reroute_evaluations_receipt_idx on public.reroute_evaluations (receipt_id);

-- ---------- "Find another way" results (append-only) ----------

create table public.reroute_alternatives (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.reroute_evaluations (id),
  blocker jsonb not null,                       -- Blocker
  candidates jsonb not null default '[]'::jsonb, -- independently re-checked candidates
  created_at timestamptz not null default now()
);
create index reroute_alternatives_evaluation_idx on public.reroute_alternatives (evaluation_id, created_at);

-- ---------- Audit events: append-only, sha256 hash chain computed by the database ----------

create table public.reroute_events (
  id bigint primary key,                        -- assigned in chain order by reroute_events_chain()
  subject_type text not null,
  subject_id text not null,
  type text not null,
  actor text not null,
  payload jsonb not null default '{}'::jsonb,
  prev_hash text,
  hash text not null unique,
  created_at timestamptz not null default now()
);
create index reroute_events_subject_idx on public.reroute_events (subject_type, subject_id, id);

create or replace function public.reroute_event_hash(
  p_prev_hash text,
  p_id bigint,
  p_subject_type text,
  p_subject_id text,
  p_type text,
  p_actor text,
  p_payload jsonb,
  p_created_at timestamptz
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_array(
          p_prev_hash, p_id, p_subject_type, p_subject_id, p_type, p_actor, p_payload,
          to_char(p_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.reroute_events_chain()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  last_id bigint;
  last_hash text;
begin
  -- Serialize appenders until commit so every event links to the one committed before it.
  perform pg_advisory_xact_lock(hashtext('public.reroute_events'));
  select e.id, e.hash into last_id, last_hash from public.reroute_events e order by e.id desc limit 1;
  new.id := coalesce(last_id, 0) + 1;
  new.prev_hash := last_hash;
  new.created_at := now();
  new.hash := public.reroute_event_hash(
    new.prev_hash, new.id, new.subject_type, new.subject_id, new.type, new.actor, new.payload, new.created_at
  );
  return new;
end;
$$;

create trigger reroute_events_chain before insert on public.reroute_events
for each row execute function public.reroute_events_chain();

/** First event whose stored link or hash does not match a recomputation; null when the chain is intact. */
create or replace function public.reroute_verify_events()
returns bigint
language plpgsql
stable
set search_path = ''
as $$
declare
  e record;
  expected_prev text := null;
begin
  for e in select * from public.reroute_events order by id loop
    if e.prev_hash is distinct from expected_prev
       or e.hash <> public.reroute_event_hash(
         e.prev_hash, e.id, e.subject_type, e.subject_id, e.type, e.actor, e.payload, e.created_at
       ) then
      return e.id;
    end if;
    expected_prev := e.hash;
  end loop;
  return null;
end;
$$;

-- ---------- ScorePlay writeback attempts (append-only; dry-run by default) ----------

create table public.reroute_writeback_attempts (
  id uuid primary key default gen_random_uuid(),
  receipt_id text not null references public.reroute_receipts (id),
  mode text not null check (mode in ('DRY_RUN', 'LIVE')),
  status text not null check (status in ('DRY_RUN', 'REFUSED', 'WRITTEN', 'VERIFIED', 'FAILED')),
  planned jsonb not null default '[]'::jsonb,   -- ScorePlayAction[] exactly as planned/sent
  detail text,
  actor text not null,
  created_at timestamptz not null default now()
);
create index reroute_writeback_attempts_receipt_idx on public.reroute_writeback_attempts (receipt_id, created_at);

-- ---------- TwelveLabs observation cache (derived data; overwritable) ----------

create table public.reroute_observation_cache (
  twelvelabs_video_id text not null,
  model_key text not null,
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  primary key (twelvelabs_video_id, model_key)
);

-- ---------- Append-only enforcement ----------

do $$
declare
  t text;
begin
  foreach t in array array[
    'reroute_campaign_versions', 'reroute_evaluations', 'reroute_alternatives', 'reroute_events',
    'reroute_writeback_attempts', 'reroute_reviews'
  ] loop
    execute format(
      'create trigger %1$s_append_only before update or delete on public.%1$I
         for each row execute function public.reroute_prevent_mutation()', t);
    execute format(
      'create trigger %1$s_no_truncate before truncate on public.%1$I
         for each statement execute function public.reroute_prevent_mutation()', t);
  end loop;
end;
$$;

-- ---------- Server-only access ----------

alter table public.reroute_goal_runs enable row level security;
alter table public.reroute_campaigns enable row level security;
alter table public.reroute_campaign_versions enable row level security;
alter table public.reroute_evaluations enable row level security;
alter table public.reroute_alternatives enable row level security;
alter table public.reroute_events enable row level security;
alter table public.reroute_writeback_attempts enable row level security;
alter table public.reroute_observation_cache enable row level security;

revoke all on
  public.reroute_goal_runs, public.reroute_campaigns, public.reroute_campaign_versions,
  public.reroute_evaluations, public.reroute_alternatives, public.reroute_events,
  public.reroute_writeback_attempts, public.reroute_observation_cache
from anon, authenticated;

revoke all on function
  public.reroute_prevent_mutation(),
  public.reroute_save_campaign_version(uuid, jsonb, text, text, text),
  public.reroute_event_hash(text, bigint, text, text, text, text, jsonb, timestamptz),
  public.reroute_events_chain(),
  public.reroute_verify_events()
from public, anon, authenticated;
grant execute on function
  public.reroute_save_campaign_version(uuid, jsonb, text, text, text),
  public.reroute_event_hash(text, bigint, text, text, text, text, jsonb, timestamptz),
  public.reroute_verify_events()
to service_role;
